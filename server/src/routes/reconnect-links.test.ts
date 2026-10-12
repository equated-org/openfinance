import { createHash, randomUUID } from "crypto";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import {
  user,
  accountConnections,
  financialAccounts,
  institutionRegistry,
  reconnectLinks,
  syncJobs,
} from "../schema";

const testUserId = `test-reconnect-${randomUUID().slice(0, 8)}`;
const otherUserId = `test-reconnect-other-${randomUUID().slice(0, 8)}`;
const plaidItemId = `item_${randomUUID().slice(0, 8)}`;
const plaidAccessToken = `access_${randomUUID()}`;
const quilttConnectionId = `conn_${randomUUID().slice(0, 8)}`;
const quilttProfileId = `p_${randomUUID().slice(0, 8)}`;

vi.mock("../lib/middleware", () => {
  const injectUser = vi.fn((c: any, next: any) => {
    c.set("user", {
      id: testUserId,
      name: "Test User",
      email: `${testUserId}@test.com`,
    });
    return next();
  });
  // accountRoutes uses requireAuth (read endpoints) and requireSession
  // (mutations); both inject the test user here.
  return { requireAuth: injectUser, requireSession: injectUser };
});

vi.mock("$lib/sync/plaid.service", () => ({
  plaidService: {
    createUpdateLinkToken: vi.fn().mockResolvedValue("link-sandbox-update"),
    connectAndPerformInitialSync: vi.fn(),
    itemRemove: vi.fn(),
  },
}));

vi.mock("$lib/sync/quiltt.service", () => ({
  quilttService: {
    createSession: vi.fn(async () => ({
      token: `quiltt-session-${randomUUID()}`,
      userId: "unused",
      expiresAt: "2026-01-01T00:00:00Z",
    })),
    connectAndPerformInitialSync: vi.fn(),
    getConnection: vi.fn(),
    revokeSession: vi.fn(),
    disconnectConnection: vi.fn(),
  },
}));

vi.mock("$lib/sync/mx.service", () => ({
  mxService: { deleteMember: vi.fn() },
}));

// Import after mocks so the routes pick up mocked modules
const { default: accountRoutes } = await import("./accounts.js");
const { default: reconnectLinkRoutes } = await import("./reconnect-links.js");
const { plaidService } = await import("$lib/sync/plaid.service");
const { quilttService } = await import("$lib/sync/quiltt.service");

const app = new Hono();
app.route("/api/accounts", accountRoutes);
app.route("/api/reconnect-link", reconnectLinkRoutes);

let registryId: number;
let plaidConnectionId: number;
let plaidAccountId: number;
let quilttConnectionDbId: number;
let quilttAccountId: number;
let mxAccountId: number;
let otherUsersAccountId: number;

/** Puts a connection in a state the way sync jobs leave it. */
async function setConnectionState(
  connectionId: number,
  provider: "plaid" | "quiltt",
  state: "needs_login" | "syncing" | "healthy",
) {
  await db.delete(syncJobs).where(eq(syncJobs.accountConnectionId, connectionId));
  await db.insert(syncJobs).values({
    userId: testUserId,
    accountConnectionId: connectionId,
    provider,
    jobType: "transactions",
    status:
      state === "needs_login" ? "error" : state === "syncing" ? "pending" : "success",
    errorCode: state === "needs_login" ? "ITEM_LOGIN_REQUIRED" : null,
    errorMessage: state === "needs_login" ? "Login required" : null,
  });
}

// What the real services do: insert a pending job and start the sync.
async function insertPendingJob(connectionId: number, provider: "plaid" | "quiltt") {
  const [job] = await db
    .insert(syncJobs)
    .values({
      userId: testUserId,
      accountConnectionId: connectionId,
      provider,
      jobType: "transactions",
      status: "pending",
    })
    .returning();
  return { syncJobId: job.id };
}

async function createLink(accountId: number) {
  const res = await app.request(`/api/accounts/${accountId}/reconnect-link`, {
    method: "POST",
  });
  const body = await res.json();
  const token = /#([A-Za-z0-9_-]+)$/.exec(body.url ?? "")?.[1];
  return { res, body, token: token! };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function getLink(token: string) {
  return app.request("/api/reconnect-link", { headers: auth(token) });
}

function startSession(token: string) {
  return app.request("/api/reconnect-link/session", {
    method: "POST",
    headers: auth(token),
  });
}

function complete(token: string, body: { connectionId?: string } = {}) {
  return app.request("/api/reconnect-link/complete", {
    method: "POST",
    headers: { ...auth(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function linkRow(token: string) {
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const [row] = await db
    .select()
    .from(reconnectLinks)
    .where(eq(reconnectLinks.tokenHash, tokenHash));
  return row;
}

async function expireLink(token: string, msAgo: number) {
  await db
    .update(reconnectLinks)
    .set({ expiresAt: new Date(Date.now() - msAgo) })
    .where(eq(reconnectLinks.tokenHash, createHash("sha256").update(token).digest("hex")));
}

beforeAll(async () => {
  await db.insert(user).values([
    {
      id: testUserId,
      name: "Test User",
      email: `${testUserId}@test.com`,
      emailVerified: false,
      quilttProfileId,
    },
    {
      id: otherUserId,
      name: "Other User",
      email: `${otherUserId}@test.com`,
      emailVerified: false,
    },
  ]);

  const [registry] = await db
    .insert(institutionRegistry)
    .values({
      name: "Reconnect Test Bank",
      url: "https://reconnecttest.com",
      countryCode: "US",
      lastSynced: new Date(),
    })
    .returning();
  registryId = registry.id;

  const [plaidConn, quilttConn, mxConn, otherConn] = await db
    .insert(accountConnections)
    .values([
      {
        userId: testUserId,
        provider: "plaid" as const,
        institutionRegistryId: registryId,
        plaidItemId,
        plaidAccessToken,
      },
      {
        userId: testUserId,
        provider: "quiltt" as const,
        institutionRegistryId: registryId,
        quilttConnectionId,
      },
      {
        userId: testUserId,
        provider: "mx" as const,
        mxMemberGuid: `MBR-${randomUUID().slice(0, 8)}`,
      },
      {
        userId: otherUserId,
        provider: "plaid" as const,
        plaidItemId: `item_${randomUUID().slice(0, 8)}`,
        plaidAccessToken: `access_${randomUUID()}`,
      },
    ])
    .returning();
  plaidConnectionId = plaidConn.id;
  quilttConnectionDbId = quilttConn.id;

  const account = (userId: string, connectionId: number, name: string) => ({
    userId,
    accountConnectionId: connectionId,
    providerAccountId: `acct_${randomUUID().slice(0, 8)}`,
    name,
    type: "depository",
    subtype: "checking",
    mask: "1234",
  });

  const [plaidAccount, quilttAccount, mxAccount, otherAccount] = await db
    .insert(financialAccounts)
    .values([
      account(testUserId, plaidConn.id, "Checking"),
      account(testUserId, quilttConn.id, "Savings"),
      account(testUserId, mxConn.id, "Brokerage"),
      account(otherUserId, otherConn.id, "Not Yours"),
    ])
    .returning();
  plaidAccountId = plaidAccount.id;
  quilttAccountId = quilttAccount.id;
  mxAccountId = mxAccount.id;
  otherUsersAccountId = otherAccount.id;

  vi.mocked(plaidService.connectAndPerformInitialSync).mockImplementation(
    () => insertPendingJob(plaidConnectionId, "plaid"),
  );
  vi.mocked(quilttService.connectAndPerformInitialSync).mockImplementation(
    () => insertPendingJob(quilttConnectionDbId, "quiltt"),
  );
});

afterAll(async () => {
  // Cascades to connections, accounts, sync jobs and reconnect links
  await db.delete(user).where(inArray(user.id, [testUserId, otherUserId]));
  await db
    .delete(institutionRegistry)
    .where(eq(institutionRegistry.id, registryId));
});

describe("POST /api/accounts/:id/reconnect-link", () => {
  it("creates a 24-hour link with the token in the fragment, storing only its hash", async () => {
    const { res, body, token } = await createLink(plaidAccountId);

    expect(res.status).toBe(201);
    expect(body.url).toMatch(/\/reconnect#[A-Za-z0-9_-]{43}$/);
    expect(body).toMatchObject({
      accountId: plaidAccountId,
      institutionName: "Reconnect Test Bank",
      provider: "plaid",
    });
    const ttl = new Date(body.expiresAt).getTime() - Date.now();
    expect(ttl).toBeGreaterThan(23.9 * 60 * 60 * 1000);
    expect(ttl).toBeLessThanOrEqual(24 * 60 * 60 * 1000);

    const row = await linkRow(token);
    expect(row).toMatchObject({
      userId: testUserId,
      financialAccountId: plaidAccountId,
    });
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("404s for an account the caller doesn't own", async () => {
    const { res } = await createLink(otherUsersAccountId);
    expect(res.status).toBe(404);
  });

  it("rejects providers the public page can't reconnect", async () => {
    const { res } = await createLink(mxAccountId);
    expect(res.status).toBe(422);
  });

  it("keeps expired links for a week so they still answer 'expired'", async () => {
    await setConnectionState(plaidConnectionId, "plaid", "needs_login");
    const { token: recent } = await createLink(plaidAccountId);
    const { token: old } = await createLink(plaidAccountId);
    await expireLink(recent, 2 * 60 * 60 * 1000);
    await expireLink(old, 8 * 24 * 60 * 60 * 1000);

    await createLink(quilttAccountId);

    expect((await getLink(recent)).status).toBe(410);
    expect((await getLink(old)).status).toBe(404);
  });
});

describe("public reconnect link", () => {
  it("describes the account without a session", async () => {
    await setConnectionState(plaidConnectionId, "plaid", "needs_login");
    const { token } = await createLink(plaidAccountId);

    const res = await getLink(token);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toMatchObject({
      provider: "plaid",
      institutionName: "Reconnect Test Bank",
      institutionUrl: "https://reconnecttest.com",
      institutionLogoUrl: null,
      accountName: "Checking",
      accountMask: "1234",
      state: "ready",
    });
  });

  it("404s without a valid token", async () => {
    expect((await app.request("/api/reconnect-link")).status).toBe(404);
    expect((await getLink("not-a-token")).status).toBe(404);
    expect((await getLink("A".repeat(43))).status).toBe(404);
  });

  it("follows the connection's state, as GET /api/accounts does", async () => {
    const { token } = await createLink(plaidAccountId);

    await setConnectionState(plaidConnectionId, "plaid", "syncing");
    expect((await (await getLink(token)).json()).state).toBe("syncing");

    await setConnectionState(plaidConnectionId, "plaid", "healthy");
    expect((await (await getLink(token)).json()).state).toBe("synced");

    // Nothing to reconnect, so no sign-in
    const res = await startSession(token);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "not_needed" });
  });

  it("reconnects a Plaid account and starts one re-sync", async () => {
    await setConnectionState(plaidConnectionId, "plaid", "needs_login");
    const { token } = await createLink(plaidAccountId);

    const sessionRes = await startSession(token);
    expect(await sessionRes.json()).toEqual({
      provider: "plaid",
      linkToken: "link-sandbox-update",
    });
    expect(plaidService.createUpdateLinkToken).toHaveBeenCalledWith(
      testUserId,
      plaidAccessToken,
    );

    vi.mocked(plaidService.connectAndPerformInitialSync).mockClear();
    const completeRes = await complete(token);
    expect((await completeRes.json()).state).toBe("syncing");
    expect(plaidService.connectAndPerformInitialSync).toHaveBeenCalledWith({
      userId: testUserId,
      institutionRegistryId: registryId,
      plaidItemId,
      plaidAccessToken,
    });

    // A repeated completion doesn't start a second sync
    expect((await (await complete(token)).json()).state).toBe("syncing");
    expect(plaidService.connectAndPerformInitialSync).toHaveBeenCalledTimes(1);
  });

  it("lets a sign-in that started in time finish for an hour after expiry", async () => {
    await setConnectionState(plaidConnectionId, "plaid", "needs_login");
    const { token } = await createLink(plaidAccountId);
    await expireLink(token, 10 * 60 * 1000);

    // Can't start a sign-in or offer one...
    expect((await startSession(token)).status).toBe(410);
    expect((await getLink(token)).status).toBe(410);

    // ...but can finish one and keep reporting its sync
    expect((await complete(token)).status).toBe(200);
    expect((await (await getLink(token)).json()).state).toBe("syncing");

    await expireLink(token, 2 * 60 * 60 * 1000);
    expect((await getLink(token)).status).toBe(410);
    expect((await complete(token)).status).toBe(410);
  });

  it("stays usable when the re-sync can't start", async () => {
    await setConnectionState(plaidConnectionId, "plaid", "needs_login");
    const { token } = await createLink(plaidAccountId);
    vi.mocked(plaidService.connectAndPerformInitialSync).mockRejectedValueOnce(
      new Error("Plaid is down"),
    );

    expect((await complete(token)).status).toBe(500);
    expect((await (await getLink(token)).json()).state).toBe("ready");
    expect((await startSession(token)).status).toBe(200);
  });

  it("reuses one Quiltt session per link and revokes it once reconnected", async () => {
    await setConnectionState(quilttConnectionDbId, "quiltt", "needs_login");
    const { body, token } = await createLink(quilttAccountId);
    expect(body.provider).toBe("quiltt");
    vi.mocked(quilttService.createSession).mockClear();

    const first = await (await startSession(token)).json();
    const second = await (await startSession(token)).json();
    expect(first).toMatchObject({
      provider: "quiltt",
      connectorId: process.env.QUILTT_CONNECTOR_ID ?? "",
      connectionId: quilttConnectionId,
    });
    expect(second.sessionToken).toBe(first.sessionToken);
    expect(quilttService.createSession).toHaveBeenCalledTimes(1);
    expect(quilttService.createSession).toHaveBeenCalledWith(quilttProfileId);

    const completeRes = await complete(token, { connectionId: quilttConnectionId });
    expect((await completeRes.json()).state).toBe("syncing");
    expect(quilttService.connectAndPerformInitialSync).toHaveBeenCalledWith({
      userId: testUserId,
      quilttConnectionId,
      quilttProfileId,
    });
    expect(quilttService.revokeSession).toHaveBeenCalledWith(first.sessionToken);
    expect((await linkRow(token)).quilttSessionToken).toBeNull();
  });

  it("follows Quiltt to the new connection a reconnect can create", async () => {
    await setConnectionState(quilttConnectionDbId, "quiltt", "needs_login");
    const { token } = await createLink(quilttAccountId);
    const newConnectionId = `conn_${randomUUID().slice(0, 8)}`;

    // Not in the owner's profile: refused
    vi.mocked(quilttService.getConnection).mockResolvedValueOnce(null as any);
    expect((await complete(token, { connectionId: newConnectionId })).status).toBe(500);

    vi.mocked(quilttService.getConnection).mockResolvedValueOnce({} as any);
    vi.mocked(quilttService.connectAndPerformInitialSync).mockClear();
    expect((await complete(token, { connectionId: newConnectionId })).status).toBe(200);

    expect(quilttService.getConnection).toHaveBeenCalledWith(
      quilttProfileId,
      newConnectionId,
    );
    expect(quilttService.connectAndPerformInitialSync).toHaveBeenCalledWith(
      expect.objectContaining({ quilttConnectionId: newConnectionId }),
    );
    const [conn] = await db
      .select({ quilttConnectionId: accountConnections.quilttConnectionId })
      .from(accountConnections)
      .where(eq(accountConnections.id, quilttConnectionDbId));
    expect(conn.quilttConnectionId).toBe(newConnectionId);
  });
});
