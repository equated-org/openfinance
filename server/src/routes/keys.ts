import { Hono } from "hono";
import { requireSession, type AuthEnv } from "../lib/middleware";
import { createApiKeyForUser } from "../lib/api-key.service";
import { db } from "../db";
import { apiKeys } from "../schema";
import { eq } from "drizzle-orm";

const keyRoutes = new Hono<AuthEnv>();

keyRoutes.use("*", requireSession);

// GET /api/keys — get the user's active key (single key per user)
keyRoutes.get("/", async (c) => {
  const user = c.get("user");

  const [key] = await db
    .select({
      id: apiKeys.id,
      key: apiKeys.key,
      prefix: apiKeys.prefix,
      name: apiKeys.name,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.userId, user.id))
    .limit(1);

  return c.json({
    key: key
      ? {
          ...key,
          key: key.key,
          createdAt: key.createdAt.toISOString(),
          lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
        }
      : null,
  });
});

// POST /api/keys/reset — delete existing key and create a new one
keyRoutes.post("/reset", async (c) => {
  const user = c.get("user");

  const { key, plaintext } = await createApiKeyForUser(user.id);

  return c.json({
    id: key.id,
    key: plaintext,
    prefix: key.prefix,
    name: key.name,
    createdAt: key.createdAt.toISOString(),
  });
});

export default keyRoutes;
