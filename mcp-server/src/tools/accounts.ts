import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OpenFinanceClient } from "../client.js";

export function registerAccountTools(
  server: McpServer,
  client: OpenFinanceClient,
) {
  server.tool(
    "get_accounts",
    "Get all connected financial accounts with balances and institution info",
    {},
    async () => {
      const { accounts } = await client.getAccounts();

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(accounts, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "create_reconnect_link",
    "Create a link that reconnects a disconnected bank account without signing in to OpenFinance. Use it when get_accounts shows a syncError, then give the URL to the account's owner: opening it walks them through their bank's sign-in (Plaid or Quiltt) and re-syncs the account. Links expire after 24 hours. MX accounts aren't supported.",
    {
      accountId: z
        .number()
        .int()
        .describe("ID of the account to reconnect, from get_accounts"),
    },
    async ({ accountId }) => {
      try {
        const link = await client.createReconnectLink(accountId);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(link, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: error instanceof Error ? error.message : String(error),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
