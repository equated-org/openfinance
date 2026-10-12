import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { requireSession, type AuthEnv } from "../lib/middleware.js";
import { db } from "../db.js";
import { oauthApplication } from "../schema.js";

const oauthRoutes = new Hono<AuthEnv>();

// GET /api/oauth/clients/:clientId — who is asking on the consent page. The
// name is whatever the client registered with, so the page also shows where
// the code would be sent, which is the part that can't be faked.
oauthRoutes.get("/clients/:clientId", requireSession, async (c) => {
  const [app] = await db
    .select({
      name: oauthApplication.name,
      redirectUrls: oauthApplication.redirectUrls,
    })
    .from(oauthApplication)
    .where(eq(oauthApplication.clientId, c.req.param("clientId")))
    .limit(1);

  const redirectHosts = [
    ...new Set(
      (app?.redirectUrls ?? "")
        .split(",")
        .map((url) => url.trim())
        .filter(Boolean)
        .map((url) => {
          try {
            return new URL(url).host;
          } catch {
            return url;
          }
        }),
    ),
  ];

  return c.json({ name: app?.name ?? null, redirectHosts });
});

export default oauthRoutes;
