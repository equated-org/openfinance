import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OpenFinanceClient } from "../client.js";

export function registerTransactionTools(
  server: McpServer,
  client: OpenFinanceClient,
) {
  server.tool(
    "get_transactions",
    "Search and filter financial transactions. Returns transactions sorted by date (newest first) by default. Use the `fields` parameter to reduce payload size by requesting only the fields you need. For spending analysis and aggregations, use the `query_transactions` tool instead — it lets you write SQL for efficient server-side computation. Transactions have no category field.",
    {
      startDate: z
        .string()
        .describe("Start date filter (YYYY-MM-DD)")
        .optional(),
      endDate: z.string().describe("End date filter (YYYY-MM-DD)").optional(),
      search: z
        .string()
        .describe("Search by transaction name or merchant")
        .optional(),
      merchants: z
        .array(z.string())
        .describe("Filter by exact merchant names")
        .optional(),
      accountId: z.number().int().describe("Filter by account ID").optional(),
      limit: z
        .number()
        .int()
        .positive()
        .max(500)
        .describe("Max results (default 100, max 500)")
        .optional(),
      cursor: z
        .string()
        .describe(
          "Next page: `<date>:<id>` of the last transaction you received (the response has no cursor field; build it yourself). Works with the default date sort only.",
        )
        .optional(),
      pending: z.boolean().describe("Filter pending transactions").optional(),
      status: z
        .array(z.enum(["active", "hidden", "deleted"]))
        .describe("Filter by status")
        .optional(),
      fields: z
        .array(z.string())
        .describe(
          "Return only these fields per transaction (e.g. ['name', 'amount', 'date', 'merchantName']). Omit to return all fields.",
        )
        .optional(),
      amountFilters: z
        .array(
          z.object({
            operator: z.enum([">", "<", ">=", "<=", "="]),
            amount: z.number(),
          }),
        )
        .describe(
          "Filter by amount using comparison operators (e.g. [{ operator: '>', amount: 100 }])",
        )
        .optional(),
    },
    async (params) => {
      const result = await client.getTransactions({
        startDate: params.startDate,
        endDate: params.endDate,
        searchText: params.search,
        merchants: params.merchants,
        accountId: params.accountId,
        limit: params.limit,
        cursor: params.cursor,
        pending: params.pending,
        status: params.status,
        fields: params.fields,
        amountFilters: params.amountFilters,
      });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result.transactions, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "query_transactions",
    `Run a validated SQL SELECT against the user's transactions. Reference only the unqualified \`txns\` relation, which has columns: id, name, amount (numeric), date (timestamp), authorized_date, merchant_name, pending, iso_currency_code, account_id, status, created_at, updated_at. Deleted transactions and hidden accounts are excluded. The query runs in a read-only transaction with a 5s timeout and a maximum of 1000 result rows (aggregations use all matching input rows). Errors are returned so you can fix the SQL and retry.

Before totaling, know what the rows mean:
- A positive amount is money out (purchases, bills, transfers out). A negative amount is money in (income, refunds, payments received). SUM(amount) alone subtracts income from spending, so filter on amount > 0 for spending.
- Accounts can be in different currencies. Group by iso_currency_code; never add amounts across currencies.
- A transfer between the user's own linked accounts appears twice: money out of one and money in on the other, as with a credit card payment. Leaving out rows that have an equal and opposite amount on another account within a few days removes most of them. Transfers to unlinked accounts or between currencies still look like spending, so check the largest rows and exclude those by name.
- There is no category column. Group by COALESCE(merchant_name, name), or map merchants to categories with CASE.
- txns has no account details. Use get_accounts to map account_id to account names, types and currencies.

Supported: WHERE, DISTINCT, GROUP BY, HAVING, ORDER BY, LIMIT/OFFSET, subqueries (including EXISTS), joins and UNION/UNION ALL over txns, aggregate FILTER (WHERE ...), COUNT(DISTINCT ...), arithmetic, comparisons, ||, LIKE/ILIKE, IN, BETWEEN, and NULL/boolean tests. Functions: COUNT, SUM, AVG, MIN, MAX, ABS, ROUND, CEIL, CEILING, FLOOR, LOWER, UPPER, LENGTH, TRIM, BTRIM, LTRIM, RTRIM, SUBSTRING, SUBSTR, REPLACE, DATE_TRUNC, DATE_PART, EXTRACT, TO_CHAR, CASE, COALESCE, NULLIF, GREATEST, LEAST, CURRENT_DATE, CURRENT_TIMESTAMP, and casts to built-in boolean, integer, numeric, floating-point, text, date, timestamp, and interval types. Rejected: caller-defined CTEs, window functions, other relations, regex operators, arrays (including ANY over an array), and unlisted functions such as NOW() (use CURRENT_TIMESTAMP) and STRING_AGG.

Examples:
- Spending this month, leaving out transfers between linked accounts:
  SELECT iso_currency_code, SUM(amount) AS spent FROM txns t WHERE amount > 0 AND date >= DATE_TRUNC('month', CURRENT_DATE) AND NOT EXISTS (SELECT 1 FROM txns o WHERE o.amount = -t.amount AND o.account_id <> t.account_id AND o.iso_currency_code = t.iso_currency_code AND o.date BETWEEN t.date - INTERVAL '3 days' AND t.date + INTERVAL '3 days') GROUP BY 1
- Money in and out by month:
  SELECT TO_CHAR(date, 'YYYY-MM') AS month, iso_currency_code, SUM(amount) FILTER (WHERE amount > 0) AS money_out, -SUM(amount) FILTER (WHERE amount < 0) AS money_in FROM txns GROUP BY 1, 2 ORDER BY 1, 2
- Top merchants in the last 90 days:
  SELECT COALESCE(merchant_name, name) AS merchant, iso_currency_code, SUM(amount) AS total, COUNT(*) AS n FROM txns WHERE amount > 0 AND date >= CURRENT_DATE - INTERVAL '90 days' GROUP BY 1, 2 ORDER BY total DESC LIMIT 10`,
    {
      sql: z
        .string()
        .min(1)
        .max(2000)
        .describe(
          "One SQL SELECT (max 2000 characters) referencing only `txns`. Do not include your own CTE, window functions, or transaction control statements.",
        ),
    },
    async (params) => {
      const result = await client.queryTransactions(params.sql);

      if ("error" in result) {
        return {
          content: [
            {
              type: "text" as const,
              text: `SQL error: ${result.error}`,
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              { rows: result.rows, rowCount: result.rowCount },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
