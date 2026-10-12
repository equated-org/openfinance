import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { appUrl } from "./origins.js";

// MCP clients and their OAuth sign-in can call from any origin. They use
// bearer tokens or PKCE, never the session cookie, so these paths answer every
// origin without credentials. Everything else is for the web app only.
const PUBLIC_PATHS = new Set(["/mcp", "/setup.md"]);
const PUBLIC_PATH_PREFIXES = ["/.well-known/oauth-", "/api/auth/mcp/"];

function isPublicProtocolPath(path: string): boolean {
  return (
    PUBLIC_PATHS.has(path) ||
    PUBLIC_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))
  );
}

const publicCors = cors({
  origin: "*",
  exposeHeaders: ["WWW-Authenticate", "Mcp-Session-Id"],
});
const appCors = cors({ origin: appUrl, credentials: true });

export const corsMiddleware = createMiddleware((c, next) =>
  isPublicProtocolPath(c.req.path) ? publicCors(c, next) : appCors(c, next),
);
