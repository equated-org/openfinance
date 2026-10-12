import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAccountTools } from "../../../mcp-server/src/tools/accounts";
import { registerTransactionTools } from "../../../mcp-server/src/tools/transactions";
import { createMcpServer } from "./server";

// What an agent sees of each tool: its description and its parameters'.
async function describeTools(server: McpServer) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "parity", version: "0" });
  await client.connect(clientSide);
  const { tools } = await client.listTools();
  await client.close();
  return Object.fromEntries(
    tools.map((tool) => [
      tool.name,
      {
        description: tool.description,
        parameters: Object.fromEntries(
          Object.entries(tool.inputSchema.properties ?? {}).map(
            ([name, schema]) => [
              name,
              (schema as { description?: string }).description ?? null,
            ],
          ),
        ),
      },
    ]),
  );
}

describe("hosted MCP tools", () => {
  // Agents should behave the same whichever server they use, so the hosted
  // tools and the legacy stdio package (mcp-server/) must describe the same
  // tools the same way. Change both together.
  it("match the legacy package's tools", async () => {
    const legacy = new McpServer({ name: "legacy", version: "0" });
    registerAccountTools(legacy as any, {} as any);
    registerTransactionTools(legacy as any, {} as any);

    const hosted = createMcpServer({ id: "parity", name: "", email: "" });

    expect(await describeTools(hosted)).toEqual(await describeTools(legacy));
  });
});
