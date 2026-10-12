import { randomUUID } from "crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import {
  user,
  accountConnections,
  financialAccounts,
  institutionRegistry,
  syncJobs,
} from "../schema";
import { financialAccountService } from "./financial-account.service";

describe("FinancialAccountService", () => {
  const testUserId = `test-user-${randomUUID().slice(0, 8)}`;

  let connectionId: number;
  let registryId: number;

  beforeAll(async () => {
    // Create test user
    await db.insert(user).values({
      id: testUserId,
      name: "Test User",
      email: `${testUserId}@test.com`,
      emailVerified: false,
    });

    // Create institution registry entry
    const [registry] = await db
      .insert(institutionRegistry)
      .values({
        name: "Test Bank",
        logo: "https://old-logo.png",
        url: "https://testbank.com",
        countryCode: "US",
        lastSynced: new Date(),
      })
      .returning();
    registryId = registry.id;

    // Create account connection
    const [conn] = await db
      .insert(accountConnections)
      .values({
        userId: testUserId,
        provider: "plaid",
        institutionRegistryId: registryId,
        plaidItemId: `item_${randomUUID().slice(0, 8)}`,
        plaidAccessToken: `access_${randomUUID()}`,
      })
      .returning();
    connectionId = conn.id;

    // Create financial accounts
    await db.insert(financialAccounts).values([
      {
        userId: testUserId,
        accountConnectionId: connectionId,
        providerAccountId: `acct_checking_${randomUUID().slice(0, 8)}`,
        name: "Checking",
        officialName: "Test Bank Checking",
        type: "depository",
        subtype: "checking",
        mask: "1234",
        currentBalance: "5000.00",
        availableBalance: "4800.00",
        isoCurrencyCode: "USD",
      },
      {
        userId: testUserId,
        accountConnectionId: connectionId,
        providerAccountId: `acct_savings_${randomUUID().slice(0, 8)}`,
        name: "Savings",
        type: "depository",
        subtype: "savings",
        mask: "5678",
        currentBalance: "10000.00",
        isoCurrencyCode: "USD",
      },
    ]);
  });

  afterAll(async () => {
    // Clean up in reverse FK order
    await db
      .delete(syncJobs)
      .where(eq(syncJobs.accountConnectionId, connectionId));
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
  });

  describe("getAccountsByUserId", () => {
    it("should return accounts with institution info and no sync error", async () => {
      const accounts =
        await financialAccountService.getAccountsByUserId(testUserId);

      expect(accounts).toHaveLength(2);

      const checking = accounts.find((a) => a.name === "Checking")!;
      expect(checking).toBeDefined();
      expect(checking.institutionName).toBe("Test Bank");
      expect(checking.institutionUrl).toBe("https://testbank.com");
      expect(checking.institutionLogoUrl).toBe("https://old-logo.png");
      expect(checking.currentBalance).toBe("5000.0000");
      expect(checking.provider).toBe("plaid");
      expect(checking.connectionId).toBe(connectionId);
      expect(checking.syncError).toBeNull();
    });

    // Plaid stores logos as base64, which would bloat every account row.
    it("should leave out a registry logo that isn't an image URL", async () => {
      await db
        .update(institutionRegistry)
        .set({ logo: "iVBORw0KGgoAAAANSUhEUgAAAAE=" })
        .where(eq(institutionRegistry.id, registryId));
      try {
        const accounts =
          await financialAccountService.getAccountsByUserId(testUserId);
        expect(accounts.map((a) => a.institutionLogoUrl)).toEqual([
          null,
          null,
        ]);
      } finally {
        await db
          .update(institutionRegistry)
          .set({ logo: "https://old-logo.png" })
          .where(eq(institutionRegistry.id, registryId));
      }
    });

    it("should return syncError when latest sync job has error status", async () => {
      // Clean up any prior sync jobs from other tests
      await db
        .delete(syncJobs)
        .where(eq(syncJobs.accountConnectionId, connectionId));

      // Insert an error sync job
      const completedAt = new Date("2025-01-15T10:00:00Z");
      await db.insert(syncJobs).values({
        userId: testUserId,
        accountConnectionId: connectionId,
        provider: "plaid",
        jobType: "accounts",
        status: "error",
        errorMessage: "the login details of this item have changed",
        errorCode: "ITEM_LOGIN_REQUIRED",
        completedAt,
      });

      const accounts =
        await financialAccountService.getAccountsByUserId(testUserId);

      // All accounts on this connection should have the sync error
      for (const account of accounts) {
        expect(account.syncError).not.toBeNull();
        expect(account.syncError!.message).toBe(
          "the login details of this item have changed",
        );
        expect(account.syncError!.lastFailedAt).toBe(completedAt.toISOString());
      }
    });

    // syncError drives the "Reconnect" button and the reconnect task, so a
    // transient failure must not raise one — re-linking would not fix an
    // upstream pull that is merely still in progress.
    it("should not return syncError for a non-disconnect error", async () => {
      await db
        .delete(syncJobs)
        .where(eq(syncJobs.accountConnectionId, connectionId));

      await db.insert(syncJobs).values({
        userId: testUserId,
        accountConnectionId: connectionId,
        provider: "plaid",
        jobType: "transactions",
        status: "error",
        errorMessage: "Your bank is still sending data.",
        errorCode: "UPSTREAM_NOT_READY",
        completedAt: new Date("2025-01-15T10:00:00Z"),
      });

      const accounts =
        await financialAccountService.getAccountsByUserId(testUserId);

      for (const account of accounts) {
        expect(account.syncError).toBeNull();
      }
    });

    it("should clear syncError when a newer successful sync job exists", async () => {
      // Insert a successful sync job after the error one
      await db.insert(syncJobs).values({
        userId: testUserId,
        accountConnectionId: connectionId,
        provider: "plaid",
        jobType: "accounts",
        status: "success",
        completedAt: new Date("2025-01-16T10:00:00Z"),
      });

      const accounts =
        await financialAccountService.getAccountsByUserId(testUserId);

      for (const account of accounts) {
        expect(account.syncError).toBeNull();
      }
    });

    it("should return empty array for unknown user", async () => {
      const accounts =
        await financialAccountService.getAccountsByUserId("nonexistent");
      expect(accounts).toEqual([]);
    });
  });

  describe("getAccountById", () => {
    it("should return a single account with full info", async () => {
      const allAccounts =
        await financialAccountService.getAccountsByUserId(testUserId);
      const target = allAccounts[0];

      const account = await financialAccountService.getAccountById(
        target.id,
        testUserId,
      );

      expect(account).toBeDefined();
      expect(account!.id).toBe(target.id);
      expect(account!.institutionUrl).toBe("https://testbank.com");
    });

    it("should return undefined for wrong userId", async () => {
      const allAccounts =
        await financialAccountService.getAccountsByUserId(testUserId);

      const account = await financialAccountService.getAccountById(
        allAccounts[0].id,
        "wrong-user",
      );
      expect(account).toBeUndefined();
    });

    it("should return undefined for nonexistent account", async () => {
      const account = await financialAccountService.getAccountById(
        999999,
        testUserId,
      );
      expect(account).toBeUndefined();
    });
  });

  describe("upsertAccount", () => {
    it("should insert a new account", async () => {
      const providerAccountId = `acct_new_${randomUUID().slice(0, 8)}`;
      const result = await financialAccountService.upsertAccount({
        userId: testUserId,
        accountConnectionId: connectionId,
        providerAccountId,
        name: "New Account",
        type: "credit",
        subtype: "credit_card",
        currentBalance: "500.00",
        isoCurrencyCode: "USD",
      });

      expect(result.name).toBe("New Account");
      expect(result.providerAccountId).toBe(providerAccountId);

      // Clean up
      await db
        .delete(financialAccounts)
        .where(eq(financialAccounts.id, result.id));
    });

    it("should update on conflict", async () => {
      const providerAccountId = `acct_upsert_${randomUUID().slice(0, 8)}`;

      // Insert first
      const first = await financialAccountService.upsertAccount({
        userId: testUserId,
        accountConnectionId: connectionId,
        providerAccountId,
        name: "Original",
        type: "depository",
        subtype: "checking",
        currentBalance: "100.00",
        isoCurrencyCode: "USD",
      });

      // Upsert with same key
      const second = await financialAccountService.upsertAccount({
        userId: testUserId,
        accountConnectionId: connectionId,
        providerAccountId,
        name: "Updated",
        type: "depository",
        subtype: "checking",
        currentBalance: "200.00",
        isoCurrencyCode: "USD",
      });

      expect(second.id).toBe(first.id);
      expect(second.name).toBe("Updated");
      expect(second.currentBalance).toBe("200.0000");

      // Clean up
      await db
        .delete(financialAccounts)
        .where(eq(financialAccounts.id, first.id));
    });
  });

  describe("getAccountsByConnectionId", () => {
    it("should return raw accounts for a connection", async () => {
      const accounts =
        await financialAccountService.getAccountsByConnectionId(connectionId);

      expect(accounts.length).toBeGreaterThanOrEqual(2);
      for (const account of accounts) {
        expect(account.accountConnectionId).toBe(connectionId);
      }
    });

    it("should return empty array for unknown connection", async () => {
      const accounts =
        await financialAccountService.getAccountsByConnectionId(999999);
      expect(accounts).toEqual([]);
    });
  });
});
