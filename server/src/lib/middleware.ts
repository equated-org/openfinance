import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import crypto from "node:crypto";
import { auth } from "../auth.js";
import { db } from "../db.js";
import { apiKeys, user as userTable } from "../schema.js";
import { eq } from "drizzle-orm";

type AuthUser = {
  id: string;
  name: string;
  email: string;
  image?: string | null;
};

export type AuthEnv = {
  Variables: {
    user: AuthUser;
    // How the request authenticated. API keys are read-only, so endpoints that
    // mutate account state or expose sensitive data must use `requireSession`.
    authMethod: "session" | "apiKey";
  };
};

async function authenticateApiKey(
  authHeader: string,
): Promise<AuthUser | null> {
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token.startsWith("sk-")) return null;

  const keyHash = crypto.createHash("sha256").update(token).digest("hex");

  const [row] = await db
    .select({
      keyId: apiKeys.id,
      userId: apiKeys.userId,
    })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);

  if (!row) return null;

  // Update last_used_at (fire-and-forget)
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, row.keyId))
    .then(
      () => {},
      () => {},
    );

  // Look up the user
  const [u] = await db
    .select({
      id: userTable.id,
      name: userTable.name,
      email: userTable.email,
      image: userTable.image,
      firstMcpLinkedAt: userTable.firstMcpLinkedAt,
    })
    .from(userTable)
    .where(eq(userTable.id, row.userId))
    .limit(1);

  // Set firstMcpLinkedAt if not already set (fire-and-forget)
  if (u && !u.firstMcpLinkedAt) {
    db.update(userTable)
      .set({ firstMcpLinkedAt: new Date() })
      .where(eq(userTable.id, u.id))
      .then(
        () => {},
        () => {},
      );
  }

  if (!u) return null;
  return u;
}

async function getSessionUser(c: Context): Promise<AuthUser | null> {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers,
  });
  return session?.user ?? null;
}

function presentsApiKey(c: Context): boolean {
  return c.req.header("Authorization")?.startsWith("Bearer sk-") ?? false;
}

// Authenticate via session OR API key. API keys are read-only, so this may only
// guard endpoints that read data (accounts list, transactions). Anything that
// mutates account state or exposes sensitive data must use `requireSession`.
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer sk-")) {
    const apiUser = await authenticateApiKey(authHeader);
    if (!apiUser) return c.json({ error: "Invalid API key" }, 401);
    c.set("user", apiUser);
    c.set("authMethod", "apiKey");
    return next();
  }

  const sessionUser = await getSessionUser(c);
  if (!sessionUser) return c.json({ error: "Unauthorized" }, 401);
  c.set("user", sessionUser);
  c.set("authMethod", "session");
  await next();
});

// Require a logged-in session. API keys are rejected with 403 so they cannot
// reach account-mutating or sensitive endpoints — they are limited to reading
// financial data through `requireAuth` routes.
export const requireSession = createMiddleware<AuthEnv>(async (c, next) => {
  if (presentsApiKey(c)) {
    return c.json(
      { error: "API keys are read-only and cannot access this endpoint" },
      403,
    );
  }

  const sessionUser = await getSessionUser(c);
  if (!sessionUser) return c.json({ error: "Unauthorized" }, 401);
  c.set("user", sessionUser);
  c.set("authMethod", "session");
  await next();
});
