import { randomUUID } from "crypto";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { client, db } from "../db";
import {
  user,
  accountConnections,
  financialAccounts,
  institutionRegistry,
  transactions,
} from "../schema";
import { transactionService } from "./transaction.service";

describe("TransactionService", () => {
  const testUserId = `test-user-${randomUUID().slice(0, 8)}`;
  const otherUserId = `other-user-${randomUUID().slice(0, 8)}`;
  const userIds = [testUserId, otherUserId];

  let accountId: number;
  let connectionId: number;
  let registryId: number;
  let hiddenAccountId: number;

  beforeAll(async () => {
    await db.insert(user).values({
      id: testUserId,
      name: "Test User",
      email: `${testUserId}@test.com`,
      emailVerified: false,
    });

    const [registry] = await db
      .insert(institutionRegistry)
      .values({
        name: "Test Bank",
        logo: "https://logo.png",
        url: "https://testbank.com",
        countryCode: "US",
        lastSynced: new Date(),
      })
      .returning();
    registryId = registry.id;

    const [conn] = await db
      .insert(accountConnections)
      .values({
        userId: testUserId,
        provider: "plaid",
        institutionRegistryId: registryId,
        plaidItemId: `item_${randomUUID().slice(0, 8)}`,
        plaidAccessToken: `access_${randomUUID()}`,
      })
      .returning();
    connectionId = conn.id;

    const [acct] = await db
      .insert(financialAccounts)
      .values({
        userId: testUserId,
        accountConnectionId: connectionId,
        providerAccountId: `acct_${randomUUID().slice(0, 8)}`,
        name: "Checking",
        type: "depository",
        subtype: "checking",
        mask: "1234",
        currentBalance: "5000.00",
        isoCurrencyCode: "USD",
      })
      .returning();
    accountId = acct.id;

    await db.insert(transactions).values([
      {
        userId: testUserId,
        accountId,
        providerTransactionId: `txn_1_${randomUUID().slice(0, 8)}`,
        name: "Starbucks Coffee",
        amount: "5.50",
        isoCurrencyCode: "USD",
        date: new Date("2025-01-10"),
        merchantName: "Starbucks",
        status: "active",
      },
      {
        userId: testUserId,
        accountId,
        providerTransactionId: `txn_2_${randomUUID().slice(0, 8)}`,
        name: "Amazon Purchase",
        amount: "120.00",
        isoCurrencyCode: "USD",
        date: new Date("2025-01-15"),
        merchantName: "Amazon",
        status: "active",
      },
      {
        userId: testUserId,
        accountId,
        providerTransactionId: `txn_3_${randomUUID().slice(0, 8)}`,
        name: "Grocery Store",
        amount: "45.00",
        isoCurrencyCode: "USD",
        date: new Date("2025-02-01"),
        merchantName: "Whole Foods",
        status: "active",
      },
      {
        userId: testUserId,
        accountId,
        providerTransactionId: `txn_4_${randomUUID().slice(0, 8)}`,
        name: "Deleted Transaction",
        amount: "10.00",
        isoCurrencyCode: "USD",
        date: new Date("2025-01-20"),
        merchantName: "Ghost Store",
        status: "deleted",
      },
    ]);

    await db.insert(user).values({
      id: otherUserId,
      name: "Other User",
      email: `${otherUserId}@test.com`,
      emailVerified: false,
    });
    for (const [ownerId, status, merchant] of [
      [testUserId, "hidden", "Hidden Account Store"],
      [otherUserId, "active", "Other User Secret Store"],
    ] as const) {
      const [connection] = await db
        .insert(accountConnections)
        .values({
          userId: ownerId,
          provider: "plaid",
          institutionRegistryId: registryId,
          plaidItemId: `item_${randomUUID()}`,
          plaidAccessToken: `access_${randomUUID()}`,
        })
        .returning();
      const [account] = await db
        .insert(financialAccounts)
        .values({
          userId: ownerId,
          accountConnectionId: connection.id,
          providerAccountId: `acct_${randomUUID()}`,
          name: merchant,
          type: "depository",
          status,
        })
        .returning();
      if (status === "hidden") hiddenAccountId = account.id;
      await db.insert(transactions).values({
        userId: ownerId,
        accountId: account.id,
        providerTransactionId: `txn_${randomUUID()}`,
        name: merchant,
        merchantName: merchant,
        amount: "9999.00",
        date: new Date("2025-01-10"),
        raw: { private: "Never expose raw provider data" },
      });
    }
  });

  afterAll(async () => {
    await db.delete(transactions).where(inArray(transactions.userId, userIds));
    await db
      .delete(financialAccounts)
      .where(inArray(financialAccounts.userId, userIds));
    await db
      .delete(accountConnections)
      .where(inArray(accountConnections.userId, userIds));
    await db.delete(user).where(inArray(user.id, userIds));
    await db
      .delete(institutionRegistry)
      .where(eq(institutionRegistry.id, registryId));
  });

  it("returns all active transactions, excluding deleted", async () => {
    const results =
      await transactionService.getTransactionsByUserId(testUserId);

    expect(results).toHaveLength(3);
    expect(results.every((t) => t.status !== "deleted")).toBe(true);
  });

  it("filters by date range", async () => {
    const results = await transactionService.getTransactionsByUserId(
      testUserId,
      { startDate: "2025-01-10", endDate: "2025-01-20" },
    );

    expect(results).toHaveLength(2);
    for (const t of results) {
      expect(t.date >= "2025-01-10").toBe(true);
      expect(t.date <= "2025-01-20").toBe(true);
    }
  });

  it("filters by searchText (merchant name)", async () => {
    const results = await transactionService.getTransactionsByUserId(
      testUserId,
      { searchText: "Starbucks" },
    );

    expect(results).toHaveLength(1);
    expect(results[0].merchantName).toBe("Starbucks");
  });

  it("filters by amountFilters", async () => {
    const results = await transactionService.getTransactionsByUserId(
      testUserId,
      { amountFilters: [{ operator: ">=", amount: 45 }] },
    );

    expect(results).toHaveLength(2);
    for (const t of results) {
      expect(t.amount).toBeGreaterThanOrEqual(45);
    }
  });

  describe("queryTransactions", () => {
    function successful(
      result: Awaited<ReturnType<typeof transactionService.queryTransactions>>,
    ) {
      expect(result).not.toHaveProperty("error");
      if ("error" in result) throw new Error(result.error);
      return result;
    }

    it("runs an aggregation query", async () => {
      const result = await transactionService.queryTransactions(
        testUserId,
        "SELECT merchant_name, SUM(amount) as total FROM txns GROUP BY 1 ORDER BY total DESC",
      );

      expect(result).not.toHaveProperty("error");
      expect(result).toHaveProperty("rows");

      const { rows } = result as { rows: Record<string, unknown>[] };
      expect(rows).toHaveLength(3);
      expect(
        Number(rows.find((r) => r.merchant_name === "Amazon")?.total),
      ).toBe(120);
      expect(
        Number(rows.find((r) => r.merchant_name === "Whole Foods")?.total),
      ).toBe(45);
      expect(
        Number(rows.find((r) => r.merchant_name === "Starbucks")?.total),
      ).toBe(5.5);
    });

    it("filters with WHERE clause", async () => {
      const result = await transactionService.queryTransactions(
        testUserId,
        "SELECT * FROM txns WHERE merchant_name ILIKE '%starbucks%'",
      );

      expect(result).not.toHaveProperty("error");
      const { rows, rowCount } = result as {
        rows: Record<string, unknown>[];
        rowCount: number;
      };
      expect(rowCount).toBe(1);
      expect(rows[0].merchant_name).toBe("Starbucks");
      expect(Number(rows[0].amount)).toBe(5.5);
    });

    it("excludes deleted transactions", async () => {
      const result = await transactionService.queryTransactions(
        testUserId,
        "SELECT * FROM txns WHERE merchant_name = 'Ghost Store'",
      );

      expect(result).not.toHaveProperty("error");
      const { rowCount } = result as { rowCount: number };
      expect(rowCount).toBe(0);
    });

    it("returns error for invalid SQL", async () => {
      const result = await transactionService.queryTransactions(
        testUserId,
        "SELECT * FROM nonexistent_table",
      );

      expect(result).toHaveProperty("error");
    });

    it("blocks mutation queries", async () => {
      const result = await transactionService.queryTransactions(
        testUserId,
        "DELETE FROM txns",
      );

      expect(result).toHaveProperty("error");
    });

    it("scopes SELECT * to the caller and excludes hidden accounts and private columns", async () => {
      const result = successful(
        await transactionService.queryTransactions(
          testUserId,
          "SELECT * FROM txns",
        ),
      );
      expect(result.rowCount).toBe(3);
      for (const row of result.rows) {
        expect(row.account_id).toBe(accountId);
        expect(row.account_id).not.toBe(hiddenAccountId);
        expect(row).not.toHaveProperty("user_id");
        expect(row).not.toHaveProperty("raw");
        expect(row).not.toHaveProperty("provider_transaction_id");
      }
      const other = successful(
        await transactionService.queryTransactions(
          otherUserId,
          "SELECT merchant_name FROM txns",
        ),
      );
      expect(other.rows).toEqual([
        { merchant_name: "Other User Secret Store" },
      ]);
    });

    it("keeps nested SELECTs, self joins, and UNION branches scoped", async () => {
      const result = successful(
        await transactionService.queryTransactions(
          testUserId,
          `
        SELECT a.merchant_name FROM txns a
        JOIN (SELECT id FROM txns) b ON a.id = b.id
        WHERE EXISTS (SELECT 1 FROM txns c WHERE c.id = a.id)
        UNION SELECT merchant_name FROM txns
        ORDER BY merchant_name
      `,
        ),
      );
      expect(result.rows).toEqual([
        { merchant_name: "Amazon" },
        { merchant_name: "Starbucks" },
        { merchant_name: "Whole Foods" },
      ]);
    });

    it("keeps documented date and merchant analyses working", async () => {
      const monthly = successful(
        await transactionService.queryTransactions(
          testUserId,
          "SELECT TO_CHAR(date, 'YYYY-MM') AS month, SUM(amount) AS total, COUNT(*) AS count FROM txns GROUP BY 1 ORDER BY 1",
        ),
      );
      expect(
        monthly.rows.map((row) => ({
          month: row.month,
          total: Number(row.total),
          count: Number(row.count),
        })),
      ).toEqual([
        { month: "2025-01", total: 125.5, count: 2 },
        { month: "2025-02", total: 45, count: 1 },
      ]);
      const merchant = successful(
        await transactionService.queryTransactions(
          testUserId,
          "SELECT COALESCE(merchant_name, name) AS merchant, SUM(amount) AS total FROM txns GROUP BY 1 ORDER BY total DESC LIMIT 1",
        ),
      );
      expect(merchant.rowCount).toBe(1);
      expect(merchant.rows[0].merchant).toBe("Amazon");
    });

    it("does not resolve approved function names to application-schema functions", async () => {
      await client.unsafe(
        "CREATE FUNCTION public.abs(numeric) RETURNS numeric LANGUAGE sql IMMUTABLE AS 'SELECT 9999::numeric'",
      );
      try {
        const result = successful(
          await transactionService.queryTransactions(
            testUserId,
            "SELECT ABS(amount) AS amount FROM txns ORDER BY amount DESC",
          ),
        );
        expect(result.rows.map((row) => Number(row.amount))).toEqual([
          120, 45, 5.5,
        ]);
      } finally {
        await client.unsafe("DROP FUNCTION public.abs(numeric)");
      }
    });

    it("supports approved expressions, casts, and SQL date/string syntax", async () => {
      const result = successful(
        await transactionService.queryTransactions(
          testUserId,
          `
        SELECT DISTINCT EXTRACT(MONTH FROM date) AS month,
          SUBSTRING(name FROM 1 FOR 3) AS prefix, TRIM(name) AS trimmed,
          amount::numeric(12,2) AS amount, amount::text AS amount_text,
          CASE WHEN pending THEN 0 ELSE amount END AS actual,
          NULLIF(amount, 0) AS nonzero, GREATEST(amount, 1) AS positive,
          CURRENT_DATE AS today, CURRENT_TIMESTAMP(2) AS now
        FROM txns WHERE amount BETWEEN 1 AND 120 AND pending IS NOT TRUE
        ORDER BY amount DESC
      `,
        ),
      );
      expect(result.rowCount).toBe(3);
      expect(Number(result.rows[0].amount)).toBe(120);
      expect(result.rows[0].prefix).toBe("Ama");
      expect(result.rows[0].trimmed).toBe("Amazon Purchase");
    });

    it.each([
      "SELECT * FROM transactions",
      "SELECT * FROM public.transactions",
      'SELECT email FROM public."user"',
      "SELECT plaid_access_token FROM account_connections",
      "SELECT * FROM pg_catalog.pg_authid",
      "SELECT * FROM information_schema.tables",
      "SELECT * FROM public.txns",
      "SELECT (SELECT plaid_access_token FROM account_connections LIMIT 1) FROM txns",
      "SELECT * FROM txns WHERE EXISTS (SELECT 1 FROM transactions WHERE user_id != $1)",
      "SELECT a.name FROM txns a JOIN transactions b ON true",
      "SELECT name FROM txns UNION ALL SELECT name FROM transactions",
      "SELECT * FROM (WITH stolen AS (SELECT * FROM transactions) SELECT * FROM stolen) s, txns",
      "WITH txns AS (SELECT * FROM transactions) SELECT * FROM txns",
      "WITH x AS (DELETE FROM transactions RETURNING *) SELECT * FROM txns",
      "SELECT * FROM txns; SELECT * FROM transactions",
      "SELECT * FROM txns; SET statement_timeout = 0",
      "SELECT * FROM txns INTO stolen",
      "SELECT * FROM txns FOR SHARE",
      "SELECT query_to_xml('SELECT * FROM transactions', true, false, '') FROM txns",
      "SELECT pg_read_file('/etc/passwd') FROM txns",
      "SELECT set_config('transaction_read_only', 'off', false) FROM txns",
      "SELECT public.sum(amount) FROM txns",
      "SELECT * FROM txns, generate_series(1, 1000000)",
      "SELECT amount::regclass FROM txns",
      "SELECT amount OPERATOR(pg_catalog.+) 1 FROM txns",
      'SELECT name COLLATE "C" FROM txns',
      "SELECT $1 FROM txns",
      "SELECT CURRENT_USER FROM txns",
      "SELECT SUM(amount) OVER () FROM txns",
      "SELECT * FROM txns FETCH FIRST 1 ROW WITH TIES",
      " ",
    ])(
      "rejects unsafe SQL before beginning a database transaction: %s",
      async (sql) => {
        const begin = vi.spyOn(client, "begin");
        try {
          const result = await transactionService.queryTransactions(
            testUserId,
            sql,
          );
          expect(result).toHaveProperty("error");
          expect(begin).not.toHaveBeenCalled();
        } finally {
          begin.mockRestore();
        }
      },
    );

    it("enforces the SQL length limit even for direct service calls", async () => {
      const begin = vi.spyOn(client, "begin");
      try {
        expect(
          await transactionService.queryTransactions(
            testUserId,
            "x".repeat(2001),
          ),
        ).toHaveProperty("error");
        expect(begin).not.toHaveBeenCalled();
      } finally {
        begin.mockRestore();
      }
    });

    it("accepts quoted txns, comments, and strings containing forbidden-looking SQL", async () => {
      const result = successful(
        await transactionService.queryTransactions(
          testUserId,
          "/* transactions */ SELECT 'SELECT * FROM transactions; pg_read_file' AS literal, t.amount FROM \"txns\" t ORDER BY amount DESC LIMIT 1; -- harmless",
        ),
      );
      expect(result.rowCount).toBe(1);
      expect(result.rows[0].literal).toBe(
        "SELECT * FROM transactions; pg_read_file",
      );
      expect(Number(result.rows[0].amount)).toBe(120);
    });

    it("preserves quotes, backslashes, and SQL-looking text as literal data", async () => {
      const literal = "backslash\\'; SELECT * FROM transactions; --";
      const sql = `SELECT '${literal.replaceAll("'", "''")}' AS literal FROM txns LIMIT 1`;
      const result = successful(
        await transactionService.queryTransactions(testUserId, sql),
      );
      expect(result.rows).toEqual([{ literal }]);
    });

    it("caps final results without capping aggregation input and preserves LIMIT/OFFSET", async () => {
      // 3^7 = 2187 rows without inserting thousands of fixture transactions.
      const source =
        "txns a CROSS JOIN txns b CROSS JOIN txns c CROSS JOIN txns d CROSS JOIN txns e CROSS JOIN txns f CROSS JOIN txns g";
      for (const limit of [
        "",
        " LIMIT ALL",
        " LIMIT 2000",
        " LIMIT NULL",
        " LIMIT (SELECT COUNT(*) * 1000 FROM txns)",
      ]) {
        const result = successful(
          await transactionService.queryTransactions(
            testUserId,
            `SELECT a.id FROM ${source}${limit}`,
          ),
        );
        expect(result.rowCount).toBe(1000);
        expect(result.rows).toHaveLength(1000);
      }
      const aggregate = successful(
        await transactionService.queryTransactions(
          testUserId,
          `SELECT COUNT(*) AS total FROM ${source}`,
        ),
      );
      expect(Number(aggregate.rows[0].total)).toBe(2187);
      const small = successful(
        await transactionService.queryTransactions(
          testUserId,
          "SELECT amount FROM txns ORDER BY amount DESC LIMIT 1 OFFSET 1",
        ),
      );
      expect(small.rowCount).toBe(1);
      expect(Number(small.rows[0].amount)).toBe(45);
      const zero = successful(
        await transactionService.queryTransactions(
          testUserId,
          "SELECT * FROM txns LIMIT 0",
        ),
      );
      expect(zero.rowCount).toBe(0);
    });

    it("restores connection settings and remains usable after execution errors", async () => {
      const before = await client.unsafe(
        "SELECT current_setting('search_path') AS path, current_setting('statement_timeout') AS timeout, current_setting('transaction_read_only') AS read_only",
      );
      const result = await transactionService.queryTransactions(
        testUserId,
        "SELECT missing_column FROM txns",
      );
      expect(result).toEqual({ error: "Query execution failed" });
      expect(
        await transactionService.queryTransactions(
          testUserId,
          "SELECT 1 / 0 FROM txns",
        ),
      ).toEqual({ error: "Query execution failed" });
      const after = await client.unsafe(
        "SELECT current_setting('search_path') AS path, current_setting('statement_timeout') AS timeout, current_setting('transaction_read_only') AS read_only",
      );
      expect(Array.from(after)).toEqual(Array.from(before));
      expect(
        successful(
          await transactionService.queryTransactions(
            testUserId,
            "SELECT COUNT(*) AS total FROM txns",
          ),
        ).rowCount,
      ).toBe(1);
    });

    it("cancels expensive SELECTs at the five-second timeout and recovers", async () => {
      const source = Array.from({ length: 20 }, (_, i) => `txns t${i}`).join(
        " CROSS JOIN ",
      );
      const started = performance.now();
      const result = await transactionService.queryTransactions(
        testUserId,
        `SELECT COUNT(*) FROM ${source}`,
      );
      expect(result).toEqual({ error: "Query execution failed" });
      expect(performance.now() - started).toBeGreaterThanOrEqual(4500);
      expect(
        successful(
          await transactionService.queryTransactions(
            testUserId,
            "SELECT * FROM txns",
          ),
        ).rowCount,
      ).toBe(3);
    }, 12000);

    it("sanitizes unexpected database failures", async () => {
      const begin = vi
        .spyOn(client, "begin")
        .mockRejectedValueOnce(
          new Error("private database connection details"),
        );
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        expect(
          await transactionService.queryTransactions(
            testUserId,
            "SELECT * FROM txns",
          ),
        ).toEqual({ error: "Query execution failed" });
      } finally {
        begin.mockRestore();
        log.mockRestore();
      }
    });
  });
});
