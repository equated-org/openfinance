import { Hono } from "hono";
import { auth } from "../auth.js";

const authRoutes = new Hono();

/**
 * Sends every MCP authorize request through the consent page.
 *
 * better-auth's mcp() plugin only asks for consent when the request carries
 * `prompt=consent`, compared strictly. Otherwise it issues a code straight
 * away, so a dynamically registered client could get one for a signed-in user
 * without them approving it (better-auth#4736). This has to be a `set`, not an
 * append: a duplicated `prompt=consent&prompt=consent` parses to an array that
 * fails the plugin's check and skips consent. The value is saved with the rest
 * of the request in the `oidc_login_prompt` cookie, so it survives the replay
 * after sign-in.
 */
export function withForcedMcpConsent(req: Request): Request {
  if (req.method !== "GET") return req;
  const url = new URL(req.url);
  if (!url.pathname.endsWith("/mcp/authorize")) return req;
  url.searchParams.set("prompt", "consent");
  return new Request(url, req);
}

authRoutes.on(["GET", "POST"], "/**", (c) => {
  return auth.handler(withForcedMcpConsent(c.req.raw));
});

export default authRoutes;
