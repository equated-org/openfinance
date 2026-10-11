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
    `Run a validated SQL SELECT against the user's transactions. Reference only the unqualified \`txns\` relation, which has columns: id, name, amount (numeric), date, authorized_date, merchant_name, pending, iso_currency_code, account_id, status, created_at, updated_at. Deleted transactions and hidden accounts are excluded. Subqueries, joins, and UNION/UNION ALL are supported when all sources are txns. Caller-defined CTEs, window functions, other relations, and unapproved functions/types/operators are rejected. The query runs in a read-only transaction with a 5s timeout and a maximum of 1000 result rows (aggregations use all matching input rows). Errors are returned so you can self-correct SQL syntax.

Approved functions: COUNT, SUM, AVG, MIN, MAX, ABS, ROUND, CEIL, CEILING, FLOOR, LOWER, UPPER, LENGTH, TRIM, BTRIM, LTRIM, RTRIM, SUBSTRING, SUBSTR, REPLACE, DATE_TRUNC, DATE_PART, EXTRACT, TO_CHAR. Also supports CASE, COALESCE, NULLIF, GREATEST, LEAST, CURRENT_DATE, CURRENT_TIMESTAMP, and casts to built-in boolean, integer, numeric, floating-point, text, date, timestamp, and interval types.

Example queries:
- SELECT SUM(amount), COUNT(*) FROM txns WHERE merchant_name ILIKE '%starbucks%'
- SELECT TO_CHAR(date, 'YYYY-MM') as month, SUM(amount), COUNT(*) FROM txns GROUP BY 1 ORDER BY 1
- SELECT COALESCE(merchant_name, name) as merchant, SUM(amount) as total FROM txns GROUP BY 1 ORDER BY total DESC LIMIT 10`,
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
