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

vi.mock("../lib/middleware", () => ({
  requireAuth: vi.fn((c: any, next: any) => {
    c.set("user", {
      id: testUserId,
      name: "Test User",
      email: `${testUserId}@test.com`,
    });
    return next();
  }),
}));

vi.mock("$lib/sync/plaid.service", () => ({
  plaidService: {
    createUpdateLinkToken: vi.fn().mockResolvedValue("link-sandbox-update"),
    connectAndPerformInitialSync: vi.fn(),
    itemRemove: vi.fn(),
  },
}));

vi.mock("$lib/sync/quiltt.service", () => ({
  quilttService: {
    createSession: vi.fn().mockResolvedValue({
      token: "quiltt-session-token",
      userId: "unused",
      expiresAt: "2026-01-01T00:00:00Z",
    }),
    connectAndPerformInitialSync: vi.fn(),
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
app.route("/api/reconnect-links", reconnectLinkRoutes);

let registryId: number;
let plaidConnectionId: number;
let plaidAccountId: number;
let quilttConnectionDbId: number;
let quilttAccountId: number;
let mxAccountId: number;
let otherUsersAccountId: number;

// The real services insert a pending job and start the sync workflow.
async function insertPendingJob(
  connectionId: number,
  provider: "plaid" | "quiltt",
) {
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
  const token = /\/reconnect\/([A-Za-z0-9_-]+)$/.exec(body.url ?? "")?.[1];
  return { res, body, token: token! };
}

function getLink(token: string) {
  return app.request(`/api/reconnect-links/${token}`);
}

function postLink(token: string, action: "session" | "complete") {
  return app.request(`/api/reconnect-links/${token}/${action}`, {
    method: "POST",
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
  it("creates a link that expires in 24 hours and stores only the token's hash", async () => {
    const { res, body, token } = await createLink(plaidAccountId);

    expect(res.status).toBe(201);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
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
      usedAt: null,
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
});

describe("public reconnect link", () => {
  it("describes the account without requiring a session", async () => {
    const { token } = await createLink(plaidAccountId);

    const res = await getLink(token);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toMatchObject({
      provider: "plaid",
      institutionName: "Reconnect Test Bank",
      institutionUrl: "https://reconnecttest.com",
      accountName: "Checking",
      accountMask: "1234",
      state: "ready",
      message: null,
    });
  });

  it("404s for unknown and malformed tokens", async () => {
    expect((await getLink("A".repeat(43))).status).toBe(404);
    expect((await getLink("not-a-token")).status).toBe(404);
    expect((await postLink("not-a-token", "session")).status).toBe(404);
  });

  it("410s once the link has expired", async () => {
    const { token } = await createLink(plaidAccountId);
    await db
      .update(reconnectLinks)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(reconnectLinks.id, (await linkRow(token)).id));

    expect((await getLink(token)).status).toBe(410);
    expect((await postLink(token, "session")).status).toBe(410);
    expect((await postLink(token, "complete")).status).toBe(410);
  });

  it("reconnects a Plaid account, then reports the sync's progress", async () => {
    const { token } = await createLink(plaidAccountId);

    const sessionRes = await postLink(token, "session");
    expect(sessionRes.status).toBe(200);
    expect(await sessionRes.json()).toEqual({
      provider: "plaid",
      linkToken: "link-sandbox-update",
    });
    expect(plaidService.createUpdateLinkToken).toHaveBeenCalledWith(
      testUserId,
      plaidAccessToken,
    );

    vi.mocked(plaidService.connectAndPerformInitialSync).mockClear();
    const completeRes = await postLink(token, "complete");
    expect(completeRes.status).toBe(200);
    expect((await completeRes.json()).state).toBe("syncing");
    expect(plaidService.connectAndPerformInitialSync).toHaveBeenCalledWith({
      userId: testUserId,
      institutionRegistryId: registryId,
      plaidItemId,
      plaidAccessToken,
    });

    // A repeated completion doesn't start a second sync
    const repeatRes = await postLink(token, "complete");
    expect((await repeatRes.json()).state).toBe("syncing");
    expect(plaidService.connectAndPerformInitialSync).toHaveBeenCalledTimes(1);

    // Nor can the link open the provider flow again
    const reopenRes = await postLink(token, "session");
    expect(reopenRes.status).toBe(409);
    expect(await reopenRes.json()).toEqual({ error: "already_used" });

    const { syncJobId } = await linkRow(token);
    await db
      .update(syncJobs)
      .set({ status: "success", completedAt: new Date() })
      .where(eq(syncJobs.id, syncJobId!));

    expect(await (await getLink(token)).json()).toMatchObject({
      state: "synced",
      message: null,
    });
  });

  it("counts a sync that's still waiting on the bank as reconnected", async () => {
    const { token } = await createLink(plaidAccountId);
    await postLink(token, "complete");

    const { syncJobId } = await linkRow(token);
    await db
      .update(syncJobs)
      .set({
        status: "error",
        errorCode: "UPSTREAM_NOT_READY",
        errorMessage: "Your bank is still sending data.",
      })
      .where(eq(syncJobs.id, syncJobId!));

    const body = await (await getLink(token)).json();
    expect(body.state).toBe("synced");
    expect(body.message).toEqual(expect.any(String));
  });

  it("lets the link retry when the bank still needs a login", async () => {
    const { token } = await createLink(plaidAccountId);
    await postLink(token, "complete");

    const { syncJobId } = await linkRow(token);
    await db
      .update(syncJobs)
      .set({
        status: "error",
        errorCode: "ITEM_LOGIN_REQUIRED",
        errorMessage: "Your bank connection needs to be reauthorized.",
      })
      .where(eq(syncJobs.id, syncJobId!));

    expect(await (await getLink(token)).json()).toMatchObject({
      state: "failed",
      message: "Your bank connection needs to be reauthorized.",
    });

    expect((await postLink(token, "session")).status).toBe(200);
    expect((await (await getLink(token)).json()).state).toBe("ready");
  });

  it("keeps the link usable when the re-sync can't start", async () => {
    const { token } = await createLink(plaidAccountId);
    vi.mocked(plaidService.connectAndPerformInitialSync).mockRejectedValueOnce(
      new Error("Plaid is down"),
    );

    expect((await postLink(token, "complete")).status).toBe(500);
    expect((await linkRow(token)).usedAt).toBeNull();
    expect((await postLink(token, "session")).status).toBe(200);
  });

  it("reconnects a Quiltt account through Quiltt's reconnect flow", async () => {
    const { body, token } = await createLink(quilttAccountId);
    expect(body.provider).toBe("quiltt");

    const sessionRes = await postLink(token, "session");
    expect(await sessionRes.json()).toEqual({
      provider: "quiltt",
      sessionToken: "quiltt-session-token",
      connectorId: process.env.QUILTT_CONNECTOR_ID ?? "",
      connectionId: quilttConnectionId,
    });
    expect(quilttService.createSession).toHaveBeenCalledWith(quilttProfileId);

    const completeRes = await postLink(token, "complete");
    expect((await completeRes.json()).state).toBe("syncing");
    expect(quilttService.connectAndPerformInitialSync).toHaveBeenCalledWith({
      userId: testUserId,
      quilttConnectionId,
      quilttProfileId,
      institutionRegistryId: registryId,
    });
  });
});
