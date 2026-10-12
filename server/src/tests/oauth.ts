import { randomUUID, randomBytes, createHmac } from "node:crypto";
import type { Hono } from "hono";
import { expect } from "vitest";
import { auth } from "../auth";
import { db } from "../db";
import { session } from "../schema";
import { appUrl, serverUrl } from "../lib/origins";

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

// A signed-in user's authorize request lands on the consent page. Returns the
// consent code it carries.
export async function requestConsent(
  app: Hono,
  authorizeUrl: string,
  cookie: string,
): Promise<string> {
  const res = await app.request(authorizeUrl, { headers: { Cookie: cookie } });
  expect(res.status).toBe(302);
  const location = new URL(res.headers.get("Location")!);
  expect(`${location.origin}${location.pathname}`).toBe(
    `${appUrl}/oauth/consent`,
  );
  return location.searchParams.get("consent_code")!;
}

// Allow or Decline on the consent page. Returns where the connector is sent.
export async function decideConsent(
  app: Hono,
  consentCode: string,
  accept: boolean,
  cookie: string,
): Promise<URL> {
  const res = await app.request(`${serverUrl}/api/auth/oauth2/consent`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: appUrl,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ accept, consent_code: consentCode }),
  });
  expect(res.status).toBe(200);
  return new URL((await res.json()).redirectURI);
}
