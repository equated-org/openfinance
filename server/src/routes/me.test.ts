import { randomUUID } from "crypto";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import {
  user,
  session,
  account,
  accountConnections,
  financialAccounts,
  institutionRegistry,
  transactions,
  apiKeys,
  notifications,
  syncJobs,
} from "../schema";

const testUserId = `test-me-${randomUUID().slice(0, 8)}`;
const testAccessToken = `access_${randomUUID()}`;

// Mock auth middleware to inject our test user
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

vi.mock("$lib/billing", () => ({
  billingService: {
    getUserPlan: vi
      .fn()
      .mockResolvedValue({ stripeSubscriptionId: "sub_test123" }),
    cancelSubscription: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("$lib/sync/plaid.service", () => ({
  plaidService: { itemRemove: vi.fn().mockResolvedValue(true) },
}));

vi.mock("$lib/sync/mx.service", () => ({
  mxService: { deleteMember: vi.fn().mockResolvedValue(true) },
}));

// Import after mocks so the route picks up mocked modules
const { default: meRoutes } = await import("./me.js");
const { billingService } = await import("$lib/billing");
const { plaidService } = await import("$lib/sync/plaid.service");

const app = new Hono();
app.route("/api/me", meRoutes);

describe("DELETE /api/me/delete-account", () => {
  let registryId: number;

  beforeAll(async () => {
    // 1. user
    await db.insert(user).values({
      id: testUserId,
      name: "Test User",
      email: `${testUserId}@test.com`,
      emailVerified: false,
    });

    // 2. session (auth table, no cascade)
    await db.insert(session).values({
      id: `sess_${randomUUID()}`,
      userId: testUserId,
      token: `tok_${randomUUID()}`,
      expiresAt: new Date(Date.now() + 86400000),
    });

    // 3. account (auth table, no cascade)
    await db.insert(account).values({
      id: `acct_${randomUUID()}`,
      userId: testUserId,
      accountId: "google_123",
      providerId: "google",
    });

    // 4. institutionRegistry (shared, no user FK)
    const [registry] = await db
      .insert(institutionRegistry)
      .values({
        name: "Delete Test Bank",
        logo: "https://logo.png",
        url: "https://deletetest.com",
        countryCode: "US",
        lastSynced: new Date(),
      })
      .returning();
    registryId = registry.id;

    // 5. accountConnections (plaid provider)
    const [conn] = await db
      .insert(accountConnections)
      .values({
        userId: testUserId,
        provider: "plaid",
        institutionRegistryId: registryId,
        plaidItemId: `item_${randomUUID().slice(0, 8)}`,
        plaidAccessToken: testAccessToken,
      })
      .returning();

    // 6. financialAccounts
    const [acct] = await db
      .insert(financialAccounts)
      .values({
        userId: testUserId,
        accountConnectionId: conn.id,
        providerAccountId: `acct_${randomUUID().slice(0, 8)}`,
        name: "Checking",
        type: "depository",
        subtype: "checking",
        mask: "1234",
        currentBalance: "5000.00",
        isoCurrencyCode: "USD",
      })
      .returning();

    // 7. transactions
    await db.insert(transactions).values({
      userId: testUserId,
      accountId: acct.id,
      providerTransactionId: `txn_${randomUUID().slice(0, 8)}`,
      name: "Coffee Shop",
      amount: "4.50",
      isoCurrencyCode: "USD",
      date: new Date("2025-01-10"),
      merchantName: "Blue Bottle",
      status: "active",
    });

    // 8. apiKeys
    await db.insert(apiKeys).values({
      userId: testUserId,
      keyHash: `hash_${randomUUID()}`,
      name: "Test Key",
      prefix: "ofk_test",
    });

    // 9. notifications
    await db.insert(notifications).values({
      userId: testUserId,
      channel: "in_app",
      title: "Test notification",
      metadata: {
        type: "account_disconnected",
        connectionId: conn.id,
        institutionName: "Delete Test Bank",
        institutionUrl: "https://deletetest.com",
      },
    });

    // 10. syncJobs
    await db.insert(syncJobs).values({
      userId: testUserId,
      accountConnectionId: conn.id,
      provider: "plaid",
      jobType: "transactions",
      status: "success",
    });
  });

  afterAll(async () => {
    // Safety cleanup in case tests fail mid-run
    await db.delete(transactions).where(eq(transactions.userId, testUserId));
    await db
      .delete(financialAccounts)
      .where(eq(financialAccounts.userId, testUserId));
    await db.delete(syncJobs).where(eq(syncJobs.userId, testUserId));
    await db.delete(notifications).where(eq(notifications.userId, testUserId));
    await db.delete(apiKeys).where(eq(apiKeys.userId, testUserId));
    await db
      .delete(accountConnections)
      .where(eq(accountConnections.userId, testUserId));
    await db.delete(session).where(eq(session.userId, testUserId));
    await db.delete(account).where(eq(account.userId, testUserId));
    await db.delete(user).where(eq(user.id, testUserId));
    await db
      .delete(institutionRegistry)
      .where(eq(institutionRegistry.id, registryId));
  });

  it("deletes user and all related data", async () => {
    const res = await app.request("/api/me/delete-account", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({ success: true });

    // Verify all rows are gone
    const [users] = await Promise.all([
      db.select().from(user).where(eq(user.id, testUserId)),
    ]);
    expect(users).toHaveLength(0);

    const [sessions] = await Promise.all([
      db.select().from(session).where(eq(session.userId, testUserId)),
    ]);
    expect(sessions).toHaveLength(0);

    const [accounts] = await Promise.all([
      db.select().from(account).where(eq(account.userId, testUserId)),
    ]);
    expect(accounts).toHaveLength(0);

    const [conns, finAccts, txns, keys, notifs, jobs] = await Promise.all([
      db
        .select()
        .from(accountConnections)
        .where(eq(accountConnections.userId, testUserId)),
      db
        .select()
        .from(financialAccounts)
        .where(eq(financialAccounts.userId, testUserId)),
      db.select().from(transactions).where(eq(transactions.userId, testUserId)),
      db.select().from(apiKeys).where(eq(apiKeys.userId, testUserId)),
      db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, testUserId)),
      db.select().from(syncJobs).where(eq(syncJobs.userId, testUserId)),
    ]);

    expect(conns).toHaveLength(0);
    expect(finAccts).toHaveLength(0);
    expect(txns).toHaveLength(0);
    expect(keys).toHaveLength(0);
    expect(notifs).toHaveLength(0);
    expect(jobs).toHaveLength(0);

    // Verify external service calls
    expect(billingService.cancelSubscription).toHaveBeenCalledWith(
      "sub_test123",
    );
    expect(plaidService.itemRemove).toHaveBeenCalledWith(testAccessToken);
  });

  it("succeeds even if provider cleanup fails", async () => {
    const failUserId = `test-me-fail-${randomUUID().slice(0, 8)}`;

    // Override the auth mock for this test
    const { requireAuth } = await import("../lib/middleware");
    (requireAuth as any).mockImplementation((c: any, next: any) => {
      c.set("user", {
        id: failUserId,
        name: "Fail User",
        email: `${failUserId}@test.com`,
      });
      return next();
    });

    // Seed minimal data
    await db.insert(user).values({
      id: failUserId,
      name: "Fail User",
      email: `${failUserId}@test.com`,
      emailVerified: false,
    });

    const [registry] = await db
      .insert(institutionRegistry)
      .values({
        name: "Fail Test Bank",
        logo: "https://logo.png",
        url: "https://failtest.com",
        countryCode: "US",
        lastSynced: new Date(),
      })
      .returning();

    await db.insert(accountConnections).values({
      userId: failUserId,
      provider: "plaid",
      institutionRegistryId: registry.id,
      plaidItemId: `item_fail_${randomUUID().slice(0, 8)}`,
      plaidAccessToken: `access_fail_${randomUUID()}`,
    });

    // Make plaid throw
    (plaidService.itemRemove as any).mockRejectedValueOnce(
      new Error("Plaid API error"),
    );

    const res = await app.request("/api/me/delete-account", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual({ success: true });

    // User should still be deleted despite provider error
    const remaining = await db
      .select()
      .from(user)
      .where(eq(user.id, failUserId));
    expect(remaining).toHaveLength(0);

    // Cleanup shared registry
    await db
      .delete(institutionRegistry)
      .where(eq(institutionRegistry.id, registry.id));

    // Restore mock for other tests
    (requireAuth as any).mockImplementation((c: any, next: any) => {
      c.set("user", {
        id: testUserId,
        name: "Test User",
        email: `${testUserId}@test.com`,
      });
      return next();
    });
  });
});
