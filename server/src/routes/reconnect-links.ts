import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import {
  reconnectLinkService,
  type ResolvedReconnectLink,
} from "$lib/reconnect-link.service";

type LinkEnv = { Variables: { link: ResolvedReconnectLink } };

// No auth middleware: these back the public reconnect page, and the token in
// the path is the credential. Each link reconnects one account and expires
// 24 hours after it's created.
const reconnectLinkRoutes = new Hono<LinkEnv>();

const resolveLink = createMiddleware<LinkEnv>(async (c, next) => {
  c.header("Cache-Control", "no-store");

  const link = await reconnectLinkService.findByToken(
    c.req.param("token") ?? "",
  );
  if (!link) return c.json({ error: "not_found" }, 404);
  if (reconnectLinkService.isExpired(link)) {
    return c.json({ error: "expired" }, 410);
  }

  c.set("link", link);
  await next();
});

// GET /api/reconnect-links/:token
reconnectLinkRoutes.get("/:token", resolveLink, async (c) => {
  return c.json(await reconnectLinkService.getStatus(c.get("link")));
});

// POST /api/reconnect-links/:token/session
// Returns what the page needs to open Plaid Link (update mode) or Quiltt's
// reconnect flow. Provider tokens are short-lived, so they're created here
// rather than when the link is.
reconnectLinkRoutes.post("/:token/session", resolveLink, async (c) => {
  const result = await reconnectLinkService.startSession(c.get("link"));
  if (!result.ok) return c.json({ error: result.error }, 409);
  return c.json(result.session);
});

// POST /api/reconnect-links/:token/complete
// Called after the provider flow succeeds. Starts the re-sync and returns the
// link's status, which the page polls until the sync finishes.
reconnectLinkRoutes.post("/:token/complete", resolveLink, async (c) => {
  return c.json(await reconnectLinkService.complete(c.get("link")));
});

export default reconnectLinkRoutes;
