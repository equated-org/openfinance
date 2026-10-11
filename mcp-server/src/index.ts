#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { OpenFinanceClient } from "./client.js";
import { registerAccountTools } from "./tools/accounts.js";
import { registerTransactionTools } from "./tools/transactions.js";

const VERSION = "0.1.9";

function parseArgs() {
  const args = process.argv.slice(2);
  let transport: "stdio" | "http" = "stdio";
  let port = 8080;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--transport" && args[i + 1]) {
      transport = args[i + 1] as "stdio" | "http";
      i++;
    } else if (args[i] === "--port" && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return { transport, port };
}

async function main() {
  const apiKey = process.env.OPENFINANCE_API_KEY;
  const baseUrl = process.env.OPENFINANCE_URL || "https://api.openfinance.sh";

  if (!apiKey) {
    console.error(
      "Error: OPENFINANCE_API_KEY environment variable is required",
    );
    process.exit(1);
  }

  const { transport, port } = parseArgs();

  const client = new OpenFinanceClient({ baseUrl, apiKey });

  const server = new McpServer({
    name: "openfinance",
    version: VERSION,
  });

  registerAccountTools(server, client);
  registerTransactionTools(server, client);

  if (transport === "stdio") {
    const stdioTransport = new StdioServerTransport();
    await server.connect(stdioTransport);
    console.error("OpenFinance MCP server running on stdio");
  } else {
    const { StreamableHTTPServerTransport } =
      await import("@modelcontextprotocol/sdk/server/streamableHttp.js");
    const { createServer } = await import("node:http");

    const httpTransport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(httpTransport);

    const httpServer = createServer(async (req, res) => {
      await httpTransport.handleRequest(req, res);
    });

    httpServer.listen(port, () => {
      console.error(
        `OpenFinance MCP server running on http://localhost:${port}`,
      );
    });
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
