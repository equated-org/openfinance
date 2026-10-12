import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ApiTransaction } from "@openfinance/shared";
import type { AuthUser } from "../lib/middleware.js";
import { financialAccountService } from "../lib/financial-account.service.js";
import { reconnectLinkService } from "../lib/reconnect-link.service.js";
import { transactionService } from "../lib/transaction.service.js";
import { MAX_QUERY_LENGTH } from "../lib/transaction-query.js";

// The tools match the legacy stdio package (mcp-server/), which calls the REST
// API, so names, parameters, and output stay the same for both.
export function createMcpServer(user: AuthUser) {
  const server = new McpServer({ name: "openfinance", version: "1.0.0" });

  server.registerTool(
    "get_accounts",
    {
      title: "Get accounts",
      description:
        "Get all connected financial accounts with balances and institution info",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () =>
      run("get_accounts", async () =>
        json(await financialAccountService.getAccountsByUserId(user.id)),
      ),
  );

  server.registerTool(
    "create_reconnect_link",
    {
      title: "Create reconnect link",
      description:
        "Create a link that reconnects a disconnected bank account without signing in to OpenFinance. Use it when get_accounts shows a syncError, then give the URL to the account's owner: opening it walks them through their bank's sign-in (Plaid or Quiltt) and re-syncs the account. Links expire after 24 hours. MX accounts aren't supported.",
      inputSchema: {
        accountId: z
          .number()
          .int()
          .describe("ID of the account to reconnect, from get_accounts"),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ accountId }) =>
      run("create_reconnect_link", async () => {
        const result = await reconnectLinkService.create(user.id, accountId);
        if (!result.ok) {
          return error(
            result.error === "not_found"
              ? "Account not found"
              : "Reconnect links only support Plaid and Quiltt accounts",
          );
        }
        return json(result.link);
      }),
  );

  server.registerTool(
    "get_transactions",
    {
      title: "Get transactions",
      description:
        "Search and filter financial transactions. Returns transactions sorted by date (newest first) by default. Use the `fields` parameter to reduce payload size by requesting only the fields you need. For spending analysis and aggregations, use the `query_transactions` tool instead — it lets you write SQL for efficient server-side computation. Transactions have no category field.",
      inputSchema: {
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
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (params) =>
      run("get_transactions", async () => {
        let transactions = await transactionService.getTransactionsByUserId(
          user.id,
          {
            startDate: params.startDate,
            endDate: params.endDate,
            searchText: params.search,
            merchants: params.merchants,
            amountFilters: params.amountFilters,
            accountId: params.accountId,
            limit: params.limit,
            cursor: params.cursor,
            pending: params.pending,
            status: params.status,
          },
        );

        if (params.fields?.length) {
          const allowedFields = new Set(params.fields);
          transactions = transactions.map(
            (t) =>
              Object.fromEntries(
                Object.entries(t).filter(([key]) => allowedFields.has(key)),
              ) as ApiTransaction,
          );
        }

        return json(transactions);
      }),
  );

  server.registerTool(
    "query_transactions",
    {
      title: "Query transactions",
      description: `Run a validated SQL SELECT against the user's transactions. Reference only the unqualified \`txns\` relation, which has columns: id, name, amount (numeric), date (timestamp), authorized_date, merchant_name, pending, iso_currency_code, account_id, status, created_at, updated_at. Deleted transactions and hidden accounts are excluded. The query runs in a read-only transaction with a 5s timeout and a maximum of 1000 result rows (aggregations use all matching input rows). Errors are returned so you can fix the SQL and retry.

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
      inputSchema: {
        sql: z
          .string()
          .min(1)
          .max(MAX_QUERY_LENGTH)
          .describe(
            `One SQL SELECT (max ${MAX_QUERY_LENGTH} characters) referencing only \`txns\`. Do not include your own CTE, window functions, or transaction control statements.`,
          ),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ sql }) =>
      run("query_transactions", async () => {
        const result = await transactionService.queryTransactions(user.id, sql);
        if ("error" in result) return error(`SQL error: ${result.error}`);
        return json({ rows: result.rows, rowCount: result.rowCount });
      }),
  );

  return server;
}

function json(value: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

function error(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

// The SDK would send a thrown error's message to the client, which for a
// failed query includes the SQL. Log it here and send a generic message, the
// way the REST routes answer a 500.
async function run(
  tool: string,
  handler: () => Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return await handler();
  } catch (err) {
    console.error(`[mcp] ${tool} failed`, err);
    return error(`${tool} failed. Try again later.`);
  }
}
