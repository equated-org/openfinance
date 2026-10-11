import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  reconnectLinkService,
  type ResolvedReconnectLink,
} from "$lib/reconnect-link.service";

type LinkEnv = { Variables: { link: ResolvedReconnectLink } };

// No auth middleware: these back the public reconnect page. The link's token
// is the credential. It comes as a bearer token rather than in the path, so it
// stays out of request logs.
const reconnectLinkRoutes = new Hono<LinkEnv>();

reconnectLinkRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");

  const token = c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
  const link = await reconnectLinkService.findByToken(token ?? "");
  if (!link) return c.json({ error: "not_found" }, 404);

  c.set("link", link);
  await next();
});

// GET /api/reconnect-link
reconnectLinkRoutes.get("/", async (c) => {
  const link = c.get("link");
  const status = await reconnectLinkService.getStatus(link);

  // An expired link can't offer a new sign-in, but keeps reporting a sync
  // it started for a while.
  const expired =
    !reconnectLinkService.canFinish(link) ||
    (!reconnectLinkService.canStart(link) && status.state === "ready");
  if (expired) return c.json({ error: "expired" }, 410);

  return c.json(status);
});

// POST /api/reconnect-link/session
// Returns what the page needs to open Plaid Link (update mode) or Quiltt's
// reconnect flow. Provider tokens are short-lived, so they're created here
// rather than when the link is.
reconnectLinkRoutes.post("/session", async (c) => {
  const link = c.get("link");
  if (!reconnectLinkService.canStart(link)) {
    return c.json({ error: "expired" }, 410);
  }

  const result = await reconnectLinkService.startSession(link);
  if (!result.ok) return c.json({ error: result.error }, 409);
  return c.json(result.session);
});

// POST /api/reconnect-link/complete
// Called after the provider flow succeeds. Starts the re-sync in the
// background and returns the link's status.
reconnectLinkRoutes.post(
  "/complete",
  zValidator("json", z.object({ connectionId: z.string().optional() })),
  async (c) => {
    const link = c.get("link");
    if (!reconnectLinkService.canFinish(link)) {
      return c.json({ error: "expired" }, 410);
    }

    const { connectionId } = c.req.valid("json");
    return c.json(
      await reconnectLinkService.complete(link, {
        quilttConnectionId: connectionId,
      }),
    );
  },
);

export default reconnectLinkRoutes;
