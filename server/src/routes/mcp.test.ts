import { randomUUID } from "crypto";
import crypto from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import {
  user,
  apiKeys,
  accountConnections,
  financialAccounts,
  institutionRegistry,
  transactions,
} from "../schema";

// Sessions and OAuth tokens are controlled here; API keys use the real db.
const { getSession, getMcpSession } = vi.hoisted(() => ({
  getSession: vi.fn(),
  getMcpSession: vi.fn(),
}));
vi.mock("../auth.js", () => ({
  auth: { api: { getSession, getMcpSession } },
}));

const { default: mcpRoutes } = await import("./mcp.js");

const app = new Hono();
app.route("/mcp", mcpRoutes);

const ownerId = `test-mcp-${randomUUID().slice(0, 8)}`;
const otherId = `test-mcp-other-${randomUUID().slice(0, 8)}`;
const apiKey = `sk-${randomUUID()}`;
let registryId: number;
let ownerAccountId: number;
let otherAccountId: number;

function rpc(
  method: string,
  params: Record<string, unknown> = {},
  headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` },
) {
  return app.request("/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
}

async function callTool(name: string, args: Record<string, unknown> = {}) {
  const res = await rpc("tools/call", { name, arguments: args });
  expect(res.status).toBe(200);
  const { result } = await res.json();
  return result as {
    content: { type: string; text: string }[];
    isError?: boolean;
  };
}

async function seedAccount(userId: string, name: string, amounts: string[]) {
  const [conn] = await db
    .insert(accountConnections)
    .values({
      userId,
      provider: "plaid",
      institutionRegistryId: registryId,
      plaidItemId: `item_${randomUUID().slice(0, 8)}`,
      plaidAccessToken: `access_${randomUUID()}`,
    })
    .returning();
  const [account] = await db
    .insert(financialAccounts)
    .values({
      userId,
      accountConnectionId: conn.id,
      providerAccountId: `acct_${randomUUID().slice(0, 8)}`,
      name,
      type: "depository",
      subtype: "checking",
      mask: "1234",
      currentBalance: "100.00",
      isoCurrencyCode: "USD",
    })
    .returning();
  await db.insert(transactions).values(
    amounts.map((amount, i) => ({
      userId,
      accountId: account.id,
      providerTransactionId: `txn_${randomUUID().slice(0, 8)}`,
      name: `${name} purchase ${i}`,
      merchantName: `${name} Store`,
      amount,
      isoCurrencyCode: "USD",
      date: new Date(`2026-09-0${i + 1}T12:00:00Z`),
      pending: false,
    })),
  );
  return account.id;
}

describe("hosted MCP endpoint", () => {
  beforeAll(async () => {
    await db.insert(user).values([
      { id: ownerId, name: "Owner", email: `${ownerId}@test.com` },
      { id: otherId, name: "Other", email: `${otherId}@test.com` },
    ]);
    await db.insert(apiKeys).values({
      userId: ownerId,
      keyHash: crypto.createHash("sha256").update(apiKey).digest("hex"),
      key: apiKey,
      prefix: apiKey.slice(0, 8),
    });
    const [registry] = await db
      .insert(institutionRegistry)
      .values({
        name: "MCP Test Bank",
        logo: "https://logo.png",
        url: "https://mcptest.example",
        countryCode: "US",
        lastSynced: new Date(),
      })
      .returning();
    registryId = registry.id;
    ownerAccountId = await seedAccount(ownerId, "Owner Checking", [
      "10.00",
      "32.50",
    ]);
    otherAccountId = await seedAccount(otherId, "Other Checking", ["999.00"]);
  });

  afterAll(async () => {
    const ids = [ownerId, otherId];
    await db.delete(transactions).where(inArray(transactions.userId, ids));
    await db
      .delete(financialAccounts)
      .where(inArray(financialAccounts.userId, ids));
    await db
      .delete(accountConnections)
      .where(inArray(accountConnections.userId, ids));
    await db.delete(apiKeys).where(inArray(apiKeys.userId, ids));
    await db.delete(user).where(inArray(user.id, ids));
    await db
      .delete(institutionRegistry)
      .where(eq(institutionRegistry.id, registryId));
  });

  beforeEach(() => {
    getSession.mockReset();
    getMcpSession.mockReset();
  });

  it("answers GET with 405 before checking auth", async () => {
    const res = await app.request("/mcp");
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });

  it("challenges a request with no credentials", async () => {
    const res = await rpc("tools/list", {}, {});
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toBe(
      'Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource"',
    );
    expect((await res.json()).error.message).toBe("Unauthorized");
  });

  it("rejects an unknown API key", async () => {
    const res = await rpc(
      "tools/list",
      {},
      { Authorization: "Bearer sk-not-a-real-key" },
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("resource_metadata");
  });

  it("doesn't accept a session cookie", async () => {
    getSession.mockResolvedValue({ user: { id: ownerId } });
    const res = await rpc("tools/list", {}, { Cookie: "session=anything" });
    expect(res.status).toBe(401);
    expect(getSession).not.toHaveBeenCalled();
  });

  it("initializes and lists the same tools as the legacy package", async () => {
    const init = await rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    expect(init.status).toBe(200);
    expect((await init.json()).result.serverInfo.name).toBe("openfinance");

    const res = await rpc("tools/list");
    const { result } = await res.json();
    expect(result.tools.map((t: { name: string }) => t.name).sort()).toEqual([
      "create_reconnect_link",
      "get_accounts",
      "get_transactions",
      "query_transactions",
    ]);
  });

  it("returns only the caller's accounts", async () => {
    const result = await callTool("get_accounts");
    const accounts = JSON.parse(result.content[0].text);
    expect(accounts.map((a: { name: string }) => a.name)).toEqual([
      "Owner Checking",
    ]);
  });

  it("filters transactions and trims them to the requested fields", async () => {
    const result = await callTool("get_transactions", {
      fields: ["name", "amount"],
      amountFilters: [{ operator: ">", amount: 20 }],
    });
    expect(JSON.parse(result.content[0].text)).toEqual([
      { name: "Owner Checking purchase 1", amount: 32.5 },
    ]);
  });

  it("runs SQL over the caller's transactions only", async () => {
    const result = await callTool("query_transactions", {
      sql: "SELECT SUM(amount) AS total, COUNT(*) AS count FROM txns",
    });
    expect(JSON.parse(result.content[0].text)).toEqual({
      rows: [{ total: "42.5000", count: "2" }],
      rowCount: 1,
    });
  });

  it("returns SQL validation errors so the caller can fix the query", async () => {
    const result = await callTool("query_transactions", {
      sql: "SELECT * FROM transactions",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/^SQL error: /);
  });

  it("won't create a reconnect link for someone else's account", async () => {
    const result = await callTool("create_reconnect_link", {
      accountId: otherAccountId,
    });
    expect(result).toEqual({
      content: [{ type: "text", text: "Account not found" }],
      isError: true,
    });
  });

  it("creates a reconnect link for the caller's account", async () => {
    const result = await callTool("create_reconnect_link", {
      accountId: ownerAccountId,
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text).url).toContain("/reconnect#");
  });

  describe("OAuth access tokens", () => {
    const bearer = { Authorization: "Bearer oauthAccessTokenFromConnector" };

    it("accepts a live token as its user and records the first AI link", async () => {
      await db
        .update(user)
        .set({ firstMcpLinkedAt: null })
        .where(eq(user.id, otherId));
      getMcpSession.mockResolvedValue({
        userId: otherId,
        accessTokenExpiresAt: new Date(Date.now() + 60_000),
      });

      const res = await rpc(
        "tools/call",
        { name: "get_accounts", arguments: {} },
        bearer,
      );
      expect(res.status).toBe(200);
      const { result } = await res.json();
      expect(
        JSON.parse(result.content[0].text).map((a: { name: string }) => a.name),
      ).toEqual(["Other Checking"]);

      await vi.waitFor(async () => {
        const [row] = await db
          .select({ firstMcpLinkedAt: user.firstMcpLinkedAt })
          .from(user)
          .where(eq(user.id, otherId));
        expect(row.firstMcpLinkedAt).not.toBeNull();
      });
    });

    it("rejects an expired token", async () => {
      getMcpSession.mockResolvedValue({
        userId: otherId,
        accessTokenExpiresAt: new Date(Date.now() - 1000),
      });
      const res = await rpc("tools/list", {}, bearer);
      expect(res.status).toBe(401);
      expect(res.headers.get("WWW-Authenticate")).toContain(
        "resource_metadata",
      );
    });

    it("rejects an unknown token", async () => {
      getMcpSession.mockResolvedValue(null);
      const res = await rpc("tools/list", {}, bearer);
      expect(res.status).toBe(401);
    });
  });
});
