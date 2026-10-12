import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { requireMcpAuth, type AuthEnv } from "../lib/middleware.js";
import { createMcpServer } from "../mcp/server.js";

const mcpRoutes = new Hono<AuthEnv>();

// The transport is stateless, so there's no GET stream. Answer 405 before auth
// so clients read it as "no stream", not as a failed sign-in.
mcpRoutes.get("/", (c) => c.body(null, 405, { Allow: "POST" }));

// Each request gets its own server for the signed-in user, and answers come
// back as plain JSON rather than an event stream.
mcpRoutes.all("/", requireMcpAuth, async (c) => {
  const server = createMcpServer(c.get("user").id);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});

export default mcpRoutes;
