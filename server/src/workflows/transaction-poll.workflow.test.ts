import { randomUUID } from "crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { db } from "../db";
import {
  user,
  accountConnections,
  financialAccounts,
  institutionRegistry,
  syncJobs,
} from "../schema";
import { TransactionPollWorkflow } from "./transaction-poll.workflow";

describe("TransactionPollWorkflow.fetchActiveConnections", () => {
  const testUserId = `test-poll-${randomUUID().slice(0, 8)}`;
  let disconnectedConnId: number;
  let transientErrorConnId: number;
  let staleConnId: number;
  let registryId: number;

  beforeAll(async () => {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new Error("DATABASE_URL is not set");

    DBOS.setConfig({
      name: "transaction-poll-test",
      systemDatabaseUrl: dbUrl,
    });
    await DBOS.launch();

    await db.insert(user).values({
      id: testUserId,
      name: "Test User",
      email: `${testUserId}@test.com`,
      emailVerified: false,
    });

    const [registry] = await db
      .insert(institutionRegistry)
      .values({
        name: "Test Bank",
        logo: "https://logo.png",
        url: "https://testbank.com",
        countryCode: "US",
        lastSynced: new Date(),
      })
      .returning();
    registryId = registry.id;

    // Connection 1: will have a disconnect error (should be skipped)
    const [conn1] = await db
      .insert(accountConnections)
      .values({
        userId: testUserId,
        provider: "plaid",
        institutionRegistryId: registryId,
        plaidItemId: `item_${randomUUID().slice(0, 8)}`,
        plaidAccessToken: `access_${randomUUID()}`,
        status: "active",
      })
      .returning();
    disconnectedConnId = conn1.id;

    // Connection 2: will have a transient error (should be retried)
    const [conn2] = await db
      .insert(accountConnections)
      .values({
        userId: testUserId,
        provider: "plaid",
        institutionRegistryId: registryId,
        plaidItemId: `item_${randomUUID().slice(0, 8)}`,
        plaidAccessToken: `access_${randomUUID()}`,
        status: "active",
      })
      .returning();
    transientErrorConnId = conn2.id;

    // Connection 3: will be stale (should still be polled)
    const [conn3] = await db
      .insert(accountConnections)
      .values({
        userId: testUserId,
        provider: "plaid",
        institutionRegistryId: registryId,
        plaidItemId: `item_${randomUUID().slice(0, 8)}`,
        plaidAccessToken: `access_${randomUUID()}`,
        status: "active",
      })
      .returning();
    staleConnId = conn3.id;

    await db.insert(financialAccounts).values([
      {
        userId: testUserId,
        accountConnectionId: disconnectedConnId,
        providerAccountId: `acct_${randomUUID().slice(0, 8)}`,
        name: "Checking 1",
        type: "depository",
        subtype: "checking",
        mask: "1111",
        currentBalance: "1000.00",
        isoCurrencyCode: "USD",
      },
      {
        userId: testUserId,
        accountConnectionId: transientErrorConnId,
        providerAccountId: `acct_${randomUUID().slice(0, 8)}`,
        name: "Checking 2",
        type: "depository",
        subtype: "checking",
        mask: "2222",
        currentBalance: "2000.00",
        isoCurrencyCode: "USD",
      },
    ]);

    // Connection 1: disconnect error → should be skipped
    await db.insert(syncJobs).values({
      userId: testUserId,
      accountConnectionId: disconnectedConnId,
      provider: "plaid",
      jobType: "transactions",
      status: "error",
      errorMessage: "ITEM_LOGIN_REQUIRED",
      errorCode: "ITEM_LOGIN_REQUIRED",
    });

    // Connection 2: transient error (null errorCode) → should be retried
    await db.insert(syncJobs).values({
      userId: testUserId,
      accountConnectionId: transientErrorConnId,
      provider: "plaid",
      jobType: "transactions",
      status: "error",
      errorMessage: "Network timeout",
      errorCode: null,
    });

    // Connection 3: stale data → prompts the user, but stays in the rotation
    // because the institution can recover on its own.
    await db.insert(syncJobs).values({
      userId: testUserId,
      accountConnectionId: staleConnId,
      provider: "plaid",
      jobType: "transactions",
      status: "error",
      errorMessage: "Your bank hasn't sent new transactions in a while.",
      errorCode: "STALE_DATA",
    });
  });

  afterAll(async () => {
    await db.delete(syncJobs).where(eq(syncJobs.userId, testUserId));
    await db
      .delete(financialAccounts)
      .where(eq(financialAccounts.userId, testUserId));
    await db
      .delete(accountConnections)
      .where(eq(accountConnections.userId, testUserId));
    await db.delete(user).where(eq(user.id, testUserId));
    await db
      .delete(institutionRegistry)
      .where(eq(institutionRegistry.id, registryId));
    await DBOS.shutdown();
  });

  it("skips disconnect errors but retries transient errors", async () => {
    const connections = await TransactionPollWorkflow.fetchActiveConnections();
    const ids = connections.map((c) => c.id);

    // Disconnect error (ITEM_LOGIN_REQUIRED) → skipped
    expect(ids).not.toContain(disconnectedConnId);
    // Transient error (null errorCode) → retried
    expect(ids).toContain(transientErrorConnId);
    // Stale → still retried; only the user-facing prompt differs
    expect(ids).toContain(staleConnId);
  });

  it("skips scheduled polls while DISABLE_SCHEDULED_JOBS is set", async () => {
    process.env.DISABLE_SCHEDULED_JOBS = "true";
    try {
      const result = await TransactionPollWorkflow.pollTransactions(new Date());
      expect(result).toEqual({ connectionsProcessed: 0, errors: [] });
    } finally {
      delete process.env.DISABLE_SCHEDULED_JOBS;
    }
  });
});
