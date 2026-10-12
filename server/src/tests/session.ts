import { randomUUID, randomBytes, createHmac } from "node:crypto";
import { auth } from "../auth";
import { db } from "../db";
import { session } from "../schema";

// A signed-in browser for tests: a session row plus the signed cookie
// better-auth reads it from.
export async function createSessionCookie(userId: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await db.insert(session).values({
    id: randomUUID(),
    token,
    userId,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  const ctx = await auth.$context;
  const signature = createHmac("sha256", ctx.secret)
    .update(token)
    .digest("base64");
  return `${ctx.authCookies.sessionToken.name}=${encodeURIComponent(
    `${token}.${signature}`,
  )}`;
}
