/**
 * Runs a Plaid sync on the real DBOS runtime, because what this checks can't be
 * mocked: DBOS stores every step's result and error, so an access token that
 * reaches workflow state gets written out on every sync.
 */
import { randomUUID } from "crypto";
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterAll,
} from "vitest";
import { eq, sql } from "drizzle-orm";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { db } from "../db";
import { user, accountConnections, syncJobs } from "../schema";
import { SyncFailure } from "../lib/sync/disconnect-codes";
import { PlaidTransactionSyncWorkflow } from "./plaid-transaction-sync.workflow";

const plaid = vi.hoisted(() => ({
  accountsGet: vi.fn(),
  transactionsSync: vi.fn(),
  itemGet: vi.fn(),
}));

vi.mock("../lib/sync/plaid.client", () => ({
  plaidClient: plaid,
  PLAID_COUNTRY_CODES: [],
}));
vi.mock("../lib/notification.service", () => ({
  notificationService: {
    sendAccountDisconnectEmail: vi.fn(),
    logTransactionSync: vi.fn(),
  },
}));

describe("a Plaid sync on DBOS", () => {
  const accessToken = `access-${randomUUID()}`;
  const userId = `test-sync-${randomUUID().slice(0, 8)}`;
  let connectionId: number;

  beforeAll(async () => {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new Error("DATABASE_URL is not set");

    DBOS.setConfig({ name: "sync-job-test", systemDatabaseUrl: dbUrl });
    await DBOS.launch();

    await db.insert(user).values({
      id: userId,
      name: "Test User",
      email: `${userId}@test.com`,
      emailVerified: false,
    });
    const [connection] = await db
      .insert(accountConnections)
      .values({
        userId,
        provider: "plaid",
        plaidItemId: `item_${randomUUID().slice(0, 8)}`,
        plaidAccessToken: accessToken,
        transactionCursor: "cursor-1",
        status: "active",
      })
      .returning();
    connectionId = connection.id;
  });

  beforeEach(() => {
    plaid.accountsGet.mockResolvedValue({ data: { accounts: [] } });
    plaid.transactionsSync.mockResolvedValue({
      data: {
        added: [],
        modified: [],
        removed: [],
        has_more: false,
        next_cursor: "cursor-2",
        transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
      },
    });
    plaid.itemGet.mockResolvedValue({
      data: {
        item: { error: null, created_at: "2026-01-01T00:00:00Z" },
        status: {
          transactions: {
            last_successful_update: new Date().toISOString(),
            last_failed_update: null,
          },
        },
      },
    });
  });

  afterAll(async () => {
    await db.delete(syncJobs).where(eq(syncJobs.userId, userId));
    await db
      .delete(accountConnections)
      .where(eq(accountConnections.userId, userId));
    await db.delete(user).where(eq(user.id, userId));
    await DBOS.shutdown();
  });

  /** Runs one sync through DBOS and returns how its job ended. */
  async function sync() {
    const [job] = await db
      .insert(syncJobs)
      .values({
        userId,
        accountConnectionId: connectionId,
        provider: "plaid",
        jobType: "transactions",
        status: "pending",
      })
      .returning();

    const handle = await DBOS.startWorkflow(PlaidTransactionSyncWorkflow).run({
      connectionId,
      userId,
      syncJobId: job.id,
    });
    await handle.getResult();

    const [finished] = await db
      .select()
      .from(syncJobs)
      .where(eq(syncJobs.id, job.id));
    return finished;
  }

  it("keeps the access token out of what DBOS stores", async () => {
    expect(await sync()).toMatchObject({ status: "success" });

    const [stored] = await db.execute<{ steps: number; matches: number }>(sql`
      select count(*)::int as steps,
             (count(*) filter (where output like ${`%${accessToken}%`}
                                  or error like ${`%${accessToken}%`}))::int as matches
      from dbos.operation_outputs
    `);

    expect(stored.steps).toBeGreaterThan(0);
    expect(stored.matches).toBe(0);
  });

  it("carries a failed step's code through to the job", async () => {
    plaid.transactionsSync.mockRejectedValue(
      new SyncFailure("the login details changed", "ITEM_LOGIN_REQUIRED"),
    );

    expect(await sync()).toMatchObject({
      status: "error",
      errorCode: "ITEM_LOGIN_REQUIRED",
      errorMessage: "the login details changed",
    });
  });

  it("carries a failure thrown by its freshness check through to the job", async () => {
    plaid.itemGet.mockResolvedValue({
      data: {
        item: { error: { error_code: "USER_PERMISSION_REVOKED" } },
        status: {},
      },
    });

    expect(await sync()).toMatchObject({
      status: "error",
      errorCode: "USER_PERMISSION_REVOKED",
    });
  });
});
