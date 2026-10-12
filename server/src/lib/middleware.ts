import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import crypto from "node:crypto";
import { auth } from "../auth.js";
import { db } from "../db.js";
import { apiKeys, user as userTable } from "../schema.js";
import { eq } from "drizzle-orm";
import { serverUrl } from "./origins.js";

export type AuthUser = {
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
    // OAuth access tokens come from MCP connectors and only work at /mcp.
    authMethod: "session" | "apiKey" | "oauth";
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

  return loadTokenUser(row.userId);
}

// better-auth's getMcpSession only looks the token up; it doesn't check that
// it's still valid, so the expiry is checked here.
async function authenticateOAuthToken(c: Context): Promise<AuthUser | null> {
  const token = await auth.api.getMcpSession({ headers: c.req.raw.headers });
  if (!token?.userId || !token.accessTokenExpiresAt) return null;
  if (new Date(token.accessTokenExpiresAt) <= new Date()) return null;
  return loadTokenUser(token.userId);
}

// The user an API key or OAuth token acts for. A token's first use also marks
// the account's first AI connection for onboarding.
async function loadTokenUser(userId: string): Promise<AuthUser | null> {
  const [u] = await db
    .select({
      id: userTable.id,
      name: userTable.name,
      email: userTable.email,
      image: userTable.image,
      firstMcpLinkedAt: userTable.firstMcpLinkedAt,
    })
    .from(userTable)
    .where(eq(userTable.id, userId))
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

// The hosted MCP endpoint takes an API key or an OAuth access token from an MCP
// connector's sign-in. Session cookies aren't accepted, so a web page the user
// visits can't call the tools. Failures get a 401 whose WWW-Authenticate
// challenge tells MCP clients where to find the OAuth server.
export const requireMcpAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer sk-")) {
    const apiUser = await authenticateApiKey(authHeader);
    if (!apiUser) return mcpUnauthorized(c);
    c.set("user", apiUser);
    c.set("authMethod", "apiKey");
    return next();
  }

  if (authHeader?.startsWith("Bearer ")) {
    const oauthUser = await authenticateOAuthToken(c);
    if (!oauthUser) return mcpUnauthorized(c);
    c.set("user", oauthUser);
    c.set("authMethod", "oauth");
    return next();
  }

  return mcpUnauthorized(c);
});

function mcpUnauthorized(c: Context) {
  return c.json(
    {
      jsonrpc: "2.0",
      error: { code: -32000, message: "Unauthorized" },
      id: null,
    },
    401,
    {
      "WWW-Authenticate": `Bearer resource_metadata="${serverUrl}/.well-known/oauth-protected-resource"`,
    },
  );
}
