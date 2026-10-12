import { randomUUID } from "node:crypto";
import crypto from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  UnauthorizedError,
  type OAuthClientProvider,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { db } from "../db";
import {
  user,
  session,
  apiKeys,
  oauthAccessToken,
  oauthApplication,
} from "../schema";
import authRoutes from "./auth";
import mcpRoutes from "./mcp";
import oauthMetadataRoutes from "./oauth-metadata";
import { createSessionCookie } from "../tests/session";

// Connects with the MCP SDK's own client, the code Claude Code and many other
// clients are built on, instead of hand-written requests. Its OAuth support
// does discovery, registration, PKCE, and refresh the way they do.
const app = new Hono();
app.route("/api/auth", authRoutes);
app.route("/.well-known", oauthMetadataRoutes);
app.route("/mcp", mcpRoutes);

const SERVER = "http://localhost:3000";
const APP = "http://localhost:6100";
const MCP_URL = new URL(`${SERVER}/mcp`);
const REDIRECT_URI = "http://127.0.0.1:43123/callback";
const TOOLS = [
  "create_reconnect_link",
  "get_accounts",
  "get_transactions",
  "query_transactions",
];

// The client's requests go straight to the app instead of the network.
const inProcessFetch = async (url: string | URL, init?: RequestInit) =>
  app.request(url.toString(), init);

const userId = `test-sdk-${randomUUID().slice(0, 8)}`;
const apiKey = `sk-${randomUUID()}`;
let sessionCookie: string;

// Stores what a real client would, and plays the user's browser: signed in,
// the authorize request lands on the consent page, where it clicks Allow.
class BrowserProvider implements OAuthClientProvider {
  private client?: OAuthClientInformationMixed;
  private savedTokens?: OAuthTokens;
  private verifier = "";
  code: string | null = null;

  get redirectUrl() {
    return REDIRECT_URI;
  }
  get clientMetadata() {
    return {
      client_name: "SDK Test Client",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }
  clientInformation() {
    return this.client;
  }
  saveClientInformation(info: OAuthClientInformationMixed) {
    this.client = info;
  }
  tokens() {
    return this.savedTokens;
  }
  saveTokens(tokens: OAuthTokens) {
    this.savedTokens = tokens;
  }
  saveCodeVerifier(verifier: string) {
    this.verifier = verifier;
  }
  codeVerifier() {
    return this.verifier;
  }
  async redirectToAuthorization(url: URL) {
    const authorize = await app.request(url.toString(), {
      headers: { Cookie: sessionCookie },
    });
    const consent = new URL(authorize.headers.get("Location")!);
    expect(`${consent.origin}${consent.pathname}`).toBe(`${APP}/oauth/consent`);

    const decision = await app.request(`${SERVER}/api/auth/oauth2/consent`, {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        Origin: APP,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        accept: true,
        consent_code: consent.searchParams.get("consent_code"),
      }),
    });
    const redirect = new URL((await decision.json()).redirectURI);
    this.code = redirect.searchParams.get("code");
  }
}

async function connect(transport: StreamableHTTPClientTransport) {
  const client = new Client({ name: "sdk-test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

describe("MCP SDK client against /mcp", () => {
  beforeAll(async () => {
    await db
      .insert(user)
      .values({ id: userId, name: "SDK User", email: `${userId}@test.com` });
    await db.insert(apiKeys).values({
      userId,
      keyHash: crypto.createHash("sha256").update(apiKey).digest("hex"),
      key: apiKey,
      prefix: apiKey.slice(0, 8),
    });
    sessionCookie = await createSessionCookie(userId);
  });

  afterAll(async () => {
    await db.delete(oauthApplication).where(eq(oauthApplication.userId, userId));
    await db
      .delete(oauthApplication)
      .where(eq(oauthApplication.name, "SDK Test Client"));
    await db.delete(apiKeys).where(eq(apiKeys.userId, userId));
    await db.delete(session).where(eq(session.userId, userId));
    await db.delete(user).where(eq(user.id, userId));
  });

  it("connects with an API key and calls a tool", async () => {
    const client = await connect(
      new StreamableHTTPClientTransport(MCP_URL, {
        fetch: inProcessFetch,
        requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
      }),
    );
    expect(client.getServerVersion()?.name).toBe("openfinance");
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS);

    const result = await client.callTool({
      name: "get_accounts",
      arguments: {},
    });
    expect(result.content).toEqual([{ type: "text", text: "[]" }]);
    await client.close();
  });

  it("signs in with OAuth like a connector, then refreshes on its own", async () => {
    const provider = new BrowserProvider();

    // The first attempt gets the 401 challenge. The SDK finds the OAuth server,
    // registers, and sends the user to authorize; the code comes back after
    // consent, as it would to a real client's redirect URL.
    const first = new StreamableHTTPClientTransport(MCP_URL, {
      fetch: inProcessFetch,
      authProvider: provider,
    });
    await expect(connect(first)).rejects.toThrow(UnauthorizedError);
    expect(provider.code).toBeTruthy();
    await first.finishAuth(provider.code!);

    const client = await connect(
      new StreamableHTTPClientTransport(MCP_URL, {
        fetch: inProcessFetch,
        authProvider: provider,
      }),
    );
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS);

    // Once the access token expires, the SDK refreshes it and retries.
    const expired = provider.tokens()!.access_token;
    await db
      .update(oauthAccessToken)
      .set({ accessTokenExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(oauthAccessToken.accessToken, expired));
    const result = await client.callTool({
      name: "get_accounts",
      arguments: {},
    });
    expect(result.content).toEqual([{ type: "text", text: "[]" }]);
    expect(provider.tokens()!.access_token).not.toBe(expired);
    await client.close();
  });
});
