import { randomUUID, createHash, randomBytes } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { user, session, oauthAccessToken, oauthApplication } from "../schema";
import authRoutes from "./auth";
import mcpRoutes from "./mcp";
import oauthMetadataRoutes from "./oauth-metadata";
import oauthRoutes from "./oauth";
import { appUrl as APP, serverUrl as SERVER } from "../lib/origins";
import {
  createSessionCookie,
  decideConsent,
  requestConsent,
} from "../tests/oauth";

// The whole connector sign-in against the real better-auth instance: discovery,
// client registration, authorize, consent, token exchange, then /mcp.
const app = new Hono();
app.route("/api/auth", authRoutes);
app.route("/api/oauth", oauthRoutes);
app.route("/.well-known", oauthMetadataRoutes);
app.route("/mcp", mcpRoutes);

const REDIRECT_URI = "http://127.0.0.1:43123/callback";

const userId = `test-oauth-${randomUUID().slice(0, 8)}`;
let sessionCookie: string;
let clientId: string;

const codeVerifier = randomBytes(32).toString("base64url");
const codeChallenge = createHash("sha256")
  .update(codeVerifier)
  .digest("base64url");

function authorizeUrl(extra: Record<string, string> = {}) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    scope: "openid offline_access",
    state: "state-123",
    ...extra,
  });
  return `${SERVER}/api/auth/mcp/authorize?${params}`;
}

function tokenRequest(fields: Record<string, string>) {
  return app.request(`${SERVER}/api/auth/mcp/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, ...fields }).toString(),
  });
}

function listTools(accessToken: string) {
  return app.request(`${SERVER}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
}

function consentCode(extra: Record<string, string> = {}) {
  return requestConsent(app, authorizeUrl(extra), sessionCookie);
}

function decide(code: string, accept: boolean) {
  return decideConsent(app, code, accept, sessionCookie);
}

describe("MCP OAuth sign-in", () => {
  beforeAll(async () => {
    await db
      .insert(user)
      .values({ id: userId, name: "OAuth User", email: `${userId}@test.com` });

    sessionCookie = await createSessionCookie(userId);

    const res = await app.request(`${SERVER}/api/auth/mcp/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Test Connector",
        redirect_uris: [REDIRECT_URI],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    });
    expect(res.ok).toBe(true);
    clientId = (await res.json()).client_id;
  });

  afterAll(async () => {
    await db.delete(oauthApplication).where(eq(oauthApplication.clientId, clientId));
    await db.delete(session).where(eq(session.userId, userId));
    await db.delete(user).where(eq(user.id, userId));
  });

  it("publishes discovery documents that point at this server", async () => {
    const resource = await (
      await app.request(`${SERVER}/.well-known/oauth-protected-resource`)
    ).json();
    expect(resource.resource).toBe(`${SERVER}/mcp`);
    expect(resource.authorization_servers).toEqual([SERVER]);

    const server = await (
      await app.request(`${SERVER}/.well-known/oauth-authorization-server`)
    ).json();
    expect(server).toMatchObject({
      issuer: SERVER,
      authorization_endpoint: `${SERVER}/api/auth/mcp/authorize`,
      token_endpoint: `${SERVER}/api/auth/mcp/token`,
      registration_endpoint: `${SERVER}/api/auth/mcp/register`,
      code_challenge_methods_supported: ["S256"],
    });
  });

  it("sends a signed-out user to the app's login page with the request", async () => {
    const res = await app.request(authorizeUrl());
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("Location")!);
    expect(`${location.origin}${location.pathname}`).toBe(`${APP}/login`);
    expect(location.searchParams.get("client_id")).toBe(clientId);
  });

  it("asks for consent even when the client didn't request it", async () => {
    expect(await consentCode()).toBeTruthy();
    expect(await consentCode({ prompt: "none" })).toBeTruthy();

    // Repeated prompt params parse to an array, which skipped consent upstream.
    const repeated = await app.request(
      `${authorizeUrl()}&prompt=consent&prompt=consent`,
      { headers: { Cookie: sessionCookie } },
    );
    expect(new URL(repeated.headers.get("Location")!).pathname).toBe(
      "/oauth/consent",
    );
  });

  it("tells the consent page who is asking", async () => {
    const res = await app.request(`${SERVER}/api/oauth/clients/${clientId}`, {
      headers: { Cookie: sessionCookie },
    });
    expect(await res.json()).toEqual({
      name: "Test Connector",
      redirectHosts: ["127.0.0.1:43123"],
    });
  });

  it("issues tokens after approval that work at /mcp and refresh", async () => {
    const redirect = await decide(await consentCode(), true);
    expect(`${redirect.origin}${redirect.pathname}`).toBe(REDIRECT_URI);
    expect(redirect.searchParams.get("state")).toBe("state-123");

    const exchanged = await tokenRequest({
      grant_type: "authorization_code",
      code: redirect.searchParams.get("code")!,
      redirect_uri: REDIRECT_URI,
      code_verifier: codeVerifier,
    });
    expect(exchanged.status).toBe(200);
    const tokens = await exchanged.json();
    expect(tokens.expires_in).toBe(3600);

    const listed = await listTools(tokens.access_token);
    expect(listed.status).toBe(200);
    expect((await listed.json()).result.tools).toHaveLength(4);

    const refreshed = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    });
    expect(refreshed.status).toBe(200);
    const renewed = await refreshed.json();
    expect((await listTools(renewed.access_token)).status).toBe(200);

    // An access token stops working once it expires.
    await db
      .update(oauthAccessToken)
      .set({ accessTokenExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(oauthAccessToken.accessToken, renewed.access_token));
    expect((await listTools(renewed.access_token)).status).toBe(401);
  });

  it("rejects a code exchange without the PKCE verifier", async () => {
    const approved = await decide(await consentCode(), true);
    const code = approved.searchParams.get("code")!;
    const res = await tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: randomBytes(32).toString("base64url"),
    });
    expect(res.status).toBe(401);
  });

  it("returns access_denied when the user declines", async () => {
    const declined = await decide(await consentCode(), false);
    expect(declined.searchParams.get("error")).toBe("access_denied");
  });
});
