#!/usr/bin/env node

// The local stdio server from npm. The tools live on the API's hosted MCP
// server, so this forwards MCP messages between stdio and /mcp, signed in with
// the API key. Configs that use this package keep the same variables.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  isJSONRPCRequest,
  isJSONRPCResultResponse,
} from "@modelcontextprotocol/sdk/types.js";

const apiKey = process.env.OPENFINANCE_API_KEY;
const baseUrl = (
  process.env.OPENFINANCE_URL || "https://api.openfinance.sh"
).replace(/\/+$/, "");

if (!apiKey) {
  console.error("Error: OPENFINANCE_API_KEY environment variable is required");
  process.exit(1);
}

const local = new StdioServerTransport();
const remote = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
  requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
});

// After initialize, the server expects the negotiated protocol version on
// every request, so it's read from the initialize answer.
const initializeIds = new Set<string | number>();

local.onmessage = (message) => {
  if (isJSONRPCRequest(message) && message.method === "initialize") {
    initializeIds.add(message.id);
  }
  remote.send(message).catch((error) => {
    // Answer a request that failed so the client doesn't wait forever.
    if (isJSONRPCRequest(message)) {
      void local.send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32603, message: describe(error) },
      });
    }
  });
};

remote.onmessage = (message) => {
  if (isJSONRPCResultResponse(message) && initializeIds.delete(message.id)) {
    remote.setProtocolVersion(String(message.result.protocolVersion));
  }
  void local.send(message);
};

let closing = false;
function close() {
  if (closing) return;
  closing = true;
  void remote.close();
  void local.close();
}
local.onclose = close;
remote.onclose = close;
local.onerror = (error) => console.error("[openfinance] stdio error", error);
remote.onerror = (error) => console.error("[openfinance] server error", error);

function describe(error: unknown): string {
  if (error instanceof StreamableHTTPError && error.code === 401) {
    return "OpenFinance didn't accept the API key. Check OPENFINANCE_API_KEY.";
  }
  return error instanceof Error ? error.message : String(error);
}

await remote.start();
await local.start();
