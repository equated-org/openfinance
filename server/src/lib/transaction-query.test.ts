import { describe, expect, it, vi } from "vitest";
import { parse } from "pgsql-parser";
import {
  MAX_QUERY_ROWS,
  prepareTransactionQuery,
  TransactionQueryError,
} from "./transaction-query";

describe("prepareTransactionQuery", () => {
  it.each([
    "SELECT SUM(amount), COUNT(*) FROM txns WHERE merchant_name ILIKE '%starbucks%'",
    "SELECT TO_CHAR(date, 'YYYY-MM') AS month, SUM(amount) FROM txns GROUP BY 1 ORDER BY 1",
    "SELECT COALESCE(merchant_name, name) AS merchant, SUM(amount) AS total FROM txns GROUP BY 1 ORDER BY total DESC LIMIT 10",
    "SELECT a.id FROM txns a JOIN (SELECT id FROM txns) b USING (id) WHERE a.id IN (SELECT id FROM txns) UNION ALL SELECT id FROM txns",
    "SELECT * FROM txns WHERE EXISTS (SELECT 1 FROM txns) AND amount > ALL (SELECT amount FROM txns)",
    "SELECT COUNT(DISTINCT (name, amount)) FILTER (WHERE amount > 0) FROM txns",
    "SELECT DISTINCT amount FROM txns WHERE amount NOT BETWEEN 1 AND 2 AND pending IS NOT TRUE",
    "SELECT CASE WHEN pending THEN 0 ELSE amount END, NULLIF(amount, 0), GREATEST(amount, 1), LEAST(amount, 5) FROM txns",
    "SELECT EXTRACT(MONTH FROM date), SUBSTRING(name FROM 1 FOR 3), TRIM(name), amount::numeric(12,2), CURRENT_DATE, CURRENT_TIMESTAMP(2) FROM txns",
    'SELECT t.* FROM "txns" t; -- a trailing comment',
    "SELECT 'transactions; DROP TABLE txns', 'pg_read_file' FROM txns",
    "SELECT amount FROM txns WHERE amount != 1 AND name NOT LIKE 'A%' ORDER BY amount DESC NULLS LAST",
  ])("accepts supported analysis: %s", async (sql) => {
    const prepared = await prepareTransactionQuery(sql);
    const ast = await parse(prepared);
    expect(ast.stmts).toHaveLength(1);
    expect(ast.stmts[0].stmt.SelectStmt.limitOption).toBe("LIMIT_OPTION_COUNT");
  });

  it.each([
    "SELECT * FROM transactions",
    "SELECT * FROM public.txns",
    "SELECT * FROM pg_catalog.pg_authid",
    "SELECT * FROM txns UNION SELECT id, name, amount, date, authorized_date, merchant_name, pending, iso_currency_code, account_id, status, created_at, updated_at FROM transactions",
    'SELECT (SELECT email FROM public."user" LIMIT 1) FROM txns',
    "SELECT * FROM txns WHERE EXISTS (SELECT 1 FROM financial_accounts)",
    "SELECT * FROM txns a JOIN account_connections b ON true",
    "WITH txns AS (SELECT * FROM transactions) SELECT * FROM txns",
    "SELECT * FROM (WITH x AS (DELETE FROM transactions RETURNING *) SELECT * FROM x) a, txns",
    "SELECT * INTO stolen FROM txns",
    "SELECT * FROM txns FOR UPDATE",
    "SELECT * FROM txns; SELECT * FROM transactions",
    "SELECT * FROM txns; SET statement_timeout = 0",
    "SELECT pg_read_file('/etc/passwd') FROM txns",
    "SELECT query_to_xml('SELECT * FROM transactions', true, false, '') FROM txns",
    "SELECT set_config('search_path', 'public', false) FROM txns",
    "SELECT pg_sleep(1) FROM txns",
    "SELECT public.sum(amount) FROM txns",
    "SELECT * FROM txns, generate_series(1,1000)",
    "SELECT amount::regclass FROM txns",
    "SELECT amount::public.money_type FROM txns",
    "SELECT amount::numeric[] FROM txns",
    "SELECT amount OPERATOR(pg_catalog.+) 1 FROM txns",
    'SELECT name COLLATE "C" FROM txns',
    "SELECT * FROM txns WHERE name ~ '.*'",
    "SELECT * FROM txns ORDER BY amount USING >",
    "SELECT SUM(amount) OVER () FROM txns",
    "SELECT * FROM txns FETCH FIRST 1 ROW WITH TIES",
    "SELECT CURRENT_USER FROM txns",
    "SELECT $1 FROM txns",
    "SELECT * FROM txns INTERSECT SELECT * FROM txns",
    "SELECT * FROM (VALUES (1)) v, txns",
    "SELECT 1",
    'SELECT * FROM "TXNS"',
    "DELETE FROM txns",
    "EXPLAIN SELECT * FROM txns",
    "",
    " ",
    "SELECT * FROM txns /* unterminated",
  ])("rejects bypass or unsupported syntax: %s", async (sql) => {
    await expect(prepareTransactionQuery(sql)).rejects.toBeInstanceOf(
      TransactionQueryError,
    );
  });

  it("qualifies functions and canonicalizes approved built-in cast types", async () => {
    const sql = await prepareTransactionQuery(
      "SELECT SUM(amount), amount::text FROM txns GROUP BY amount",
    );
    const ast = await parse(sql);
    const targets = ast.stmts[0].stmt.SelectStmt.targetList;
    expect(targets[0].ResTarget.val.FuncCall.funcname).toEqual([
      { String: { sval: "pg_catalog" } },
      { String: { sval: "sum" } },
    ]);
    expect(targets[1].ResTarget.val.TypeCast.typeName.names.at(-1)).toEqual({
      String: { sval: "text" },
    });
  });

  it("rejects oversized SQL", async () => {
    await expect(
      prepareTransactionQuery("x".repeat(2001)),
    ).rejects.toBeInstanceOf(TransactionQueryError);
  });

  it("caps only the final SELECT, preserving smaller limits and offsets", async () => {
    const sql = await prepareTransactionQuery(
      "SELECT * FROM (SELECT * FROM txns LIMIT 2000) a ORDER BY id LIMIT 5 OFFSET 2",
    );
    const ast = await parse(sql);
    const select = ast.stmts[0].stmt.SelectStmt;
    expect(select.limitCount.MinMaxExpr.args).toEqual([
      expect.objectContaining({
        A_Const: expect.objectContaining({ ival: { ival: 5 } }),
      }),
      expect.objectContaining({
        A_Const: expect.objectContaining({ ival: { ival: MAX_QUERY_ROWS } }),
      }),
    ]);
    expect(select.limitOffset.A_Const.ival.ival).toBe(2);
    expect(
      select.fromClause[0].RangeSubselect.subquery.SelectStmt.limitCount.A_Const
        .ival.ival,
    ).toBe(2000);
  });

  it("fails closed on new parser nodes and fields", async () => {
    const parser = await import("pgsql-parser");
    const ast = await parser.parse("SELECT * FROM txns");
    const spy = vi.spyOn(parser, "parse");
    try {
      spy.mockResolvedValueOnce({
        ...ast,
        stmts: [
          {
            stmt: {
              SelectStmt: {
                ...ast.stmts[0].stmt.SelectStmt,
                futureClause: { dangerous: true },
              },
            },
          },
        ],
      });
      await expect(
        prepareTransactionQuery("SELECT * FROM txns"),
      ).rejects.toThrow("SelectStmt.futureClause");
      spy.mockResolvedValueOnce({
        ...ast,
        stmts: [
          {
            stmt: {
              SelectStmt: {
                ...ast.stmts[0].stmt.SelectStmt,
                whereClause: { FutureExpr: {} },
              },
            },
          },
        ],
      });
      await expect(
        prepareTransactionQuery("SELECT * FROM txns"),
      ).rejects.toThrow("FutureExpr");
    } finally {
      spy.mockRestore();
    }
  });

  it("validates serialized SQL before allowing it to execute", async () => {
    const parser = await import("pgsql-parser");
    const spy = vi
      .spyOn(parser, "deparse")
      .mockResolvedValueOnce("SELECT * FROM transactions");
    try {
      await expect(
        prepareTransactionQuery("SELECT * FROM txns"),
      ).rejects.toThrow("only read the unqualified txns");
    } finally {
      spy.mockRestore();
    }
  });
});
