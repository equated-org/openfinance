#!/usr/bin/env tsx

// Checks a deployed MCP endpoint the way clients use it: the OAuth challenge
// and discovery documents that connectors sign in through, then the MCP SDK
// client with an API key. Exits non-zero if anything fails.
//
//   OPENFINANCE_API_KEY=sk-... npx tsx src/scripts/mcp-smoke.ts [mcp-url]
//
// The URL defaults to production.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const mcpUrl = new URL(process.argv[2] ?? "https://api.openfinance.sh/mcp");
const apiKey = process.env.OPENFINANCE_API_KEY;
const TOOLS = [
  "create_reconnect_link",
  "get_accounts",
  "get_transactions",
  "query_transactions",
];

if (!apiKey) {
  console.error("Set OPENFINANCE_API_KEY to an API key from the Connect tab.");
  process.exit(1);
}

let failed = false;

async function check(name: string, run: () => Promise<string | void>) {
  try {
    const detail = await run();
    console.log(`✓ ${name}${detail ? ` (${detail})` : ""}`);
  } catch (error) {
    failed = true;
    console.log(`✗ ${name}: ${error instanceof Error ? error.message : error}`);
  }
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

await check("signed-out requests get the OAuth challenge", async () => {
  const res = await fetch(mcpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  expect(res.status === 401, `expected 401, got ${res.status}`);
  const challenge = res.headers.get("WWW-Authenticate") ?? "";
  const metadataUrl = challenge.match(/resource_metadata="([^"]+)"/)?.[1];
  expect(metadataUrl, `no resource_metadata in "${challenge}"`);

  const resource = await (await fetch(metadataUrl)).json();
  expect(
    resource.resource === mcpUrl.href,
    `resource is ${resource.resource}, not ${mcpUrl.href}`,
  );

  const issuer = resource.authorization_servers?.[0];
  const server = await (
    await fetch(new URL("/.well-known/oauth-authorization-server", issuer))
  ).json();
  expect(server.registration_endpoint, "no registration endpoint");
  expect(
    server.code_challenge_methods_supported?.includes("S256"),
    "PKCE S256 isn't supported",
  );
  return `sign-in at ${server.authorization_endpoint}`;
});

await check("the MCP SDK client connects with the API key", async () => {
  const client = new Client({ name: "openfinance-smoke", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(mcpUrl, {
      requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
    }),
  );
  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(
      JSON.stringify(names) === JSON.stringify(TOOLS),
      `tools are ${names.join(", ")}`,
    );

    const result = await client.callTool({
      name: "get_accounts",
      arguments: {},
    });
    expect(!result.isError, `get_accounts failed: ${JSON.stringify(result)}`);
    const [content] = result.content as { type: string; text: string }[];
    return `${JSON.parse(content.text).length} accounts`;
  } finally {
    await client.close();
  }
});

process.exit(failed ? 1 : 0);
