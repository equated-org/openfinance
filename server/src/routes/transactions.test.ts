import { randomUUID } from "crypto";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import {
  user,
  accountConnections,
  financialAccounts,
  institutionRegistry,
  transactions,
} from "../schema";

const testUserId = `test-route-${randomUUID().slice(0, 8)}`;

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

// Import after mock so the route picks up the mocked middleware
const { default: transactionRoutes } = await import("./transactions.js");

const app = new Hono();
app.route("/api/transactions", transactionRoutes);

describe("Transaction routes", () => {
  let registryId: number;

  beforeAll(async () => {
    await db.insert(user).values({
      id: testUserId,
      name: "Test User",
      email: `${testUserId}@test.com`,
      emailVerified: false,
    });

    const [registry] = await db
      .insert(institutionRegistry)
      .values({
        name: "Route Test Bank",
        logo: "https://logo.png",
        url: "https://routetest.com",
        countryCode: "US",
        lastSynced: new Date(),
      })
      .returning();
    registryId = registry.id;

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

    await db.insert(transactions).values([
      {
        userId: testUserId,
        accountId: acct.id,
        providerTransactionId: `txn_r1_${randomUUID().slice(0, 8)}`,
        name: "Coffee Shop",
        amount: "4.50",
        isoCurrencyCode: "USD",
        date: new Date("2025-01-10"),
        merchantName: "Blue Bottle",
        status: "active",
      },
      {
        userId: testUserId,
        accountId: acct.id,
        providerTransactionId: `txn_r2_${randomUUID().slice(0, 8)}`,
        name: "Grocery Run",
        amount: "85.00",
        isoCurrencyCode: "USD",
        date: new Date("2025-01-12"),
        merchantName: "Trader Joes",
        status: "active",
      },
    ]);
  });

  afterAll(async () => {
    await db.delete(transactions).where(eq(transactions.userId, testUserId));
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

  it("GET / returns all standard fields when no fields param", async () => {
    const res = await app.request("/api/transactions");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.transactions).toHaveLength(2);

    const txn = body.transactions[0];
    expect(txn).toHaveProperty("id");
    expect(txn).toHaveProperty("name");
    expect(txn).toHaveProperty("amount");
    expect(txn).toHaveProperty("date");
    expect(txn).toHaveProperty("merchantName");
    expect(txn).toHaveProperty("accountId");
  });

  it("GET /?fields=name,amount returns only requested fields", async () => {
    const res = await app.request("/api/transactions?fields=name,amount");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.transactions).toHaveLength(2);

    for (const txn of body.transactions) {
      const keys = Object.keys(txn);
      expect(keys).toEqual(expect.arrayContaining(["name", "amount"]));
      expect(keys).toHaveLength(2);
    }
  });

  it("GET /?amountFilters=... parses valid JSON", async () => {
    const res = await app.request(
      `/api/transactions?amountFilters=${encodeURIComponent(
        '[{"operator":">=","amount":50}]',
      )}`,
    );
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0].name).toBe("Grocery Run");
  });

  it("GET / returns 400 (not 500) for invalid amountFilters JSON", async () => {
    const res = await app.request(
      "/api/transactions?amountFilters=not-json",
    );
    expect(res.status).toBe(400);
  });

  it("GET / returns 400 (not 500) for invalid sort JSON", async () => {
    const res = await app.request("/api/transactions?sort=%7Bbroken");
    expect(res.status).toBe(400);
  });

  it("POST /query runs SQL and returns rows", async () => {
    const res = await app.request("/api/transactions/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sql: "SELECT merchant_name, SUM(amount) as total FROM txns GROUP BY 1 ORDER BY total DESC",
      }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.rowCount).toBe(2);
    expect(body.rows[0].merchant_name).toBe("Trader Joes");
    expect(Number(body.rows[0].total)).toBe(85);
  });

  it("POST /query returns 400 for invalid SQL", async () => {
    const res = await app.request("/api/transactions/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "NOT VALID SQL AT ALL" }),
    });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body).toHaveProperty("error");
  });

  it.each([
    "SELECT * FROM transactions",
    "SELECT * FROM txns WHERE EXISTS (SELECT 1 FROM public.transactions)",
    "SELECT pg_read_file('/etc/passwd') FROM txns",
    "WITH txns AS (SELECT * FROM transactions) SELECT * FROM txns",
    "SELECT * FROM txns; SELECT * FROM transactions",
    " ",
  ])("POST /query rejects unsafe or oversized SQL: %s", async (sql) => {
    const res = await app.request("/api/transactions/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).not.toHaveProperty("rows");
    expect(body).toHaveProperty("error");
  });

  it("POST /query rejects SQL longer than 2000 characters", async () => {
    const res = await app.request("/api/transactions/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sql: "x".repeat(2001) }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).not.toHaveProperty("rows");
  });
});
