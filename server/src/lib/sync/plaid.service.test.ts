/**
 * Tests for PlaidService.syncTransactions — specifically the polling
 * behavior during initial sync to wait for HISTORICAL_UPDATE_COMPLETE.
 *
 * When a user first connects a bank account, Plaid's transaction sync has
 * two phases: INITIAL_UPDATE_COMPLETE (recent transactions only) and
 * HISTORICAL_UPDATE_COMPLETE (all historical transactions). The service
 * polls with exponential backoff during the initial sync until historical
 * data is ready or retries are exhausted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockTransactionsSync = vi.fn();
const mockItemGet = vi.fn();
const mockAccountsGet = vi.fn();

vi.mock("./plaid.client", () => ({
  plaidClient: {
    transactionsSync: mockTransactionsSync,
    itemGet: mockItemGet,
    accountsGet: mockAccountsGet,
  },
}));

const mockDbChain = () => {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.from = vi.fn().mockReturnValue(chain);
  chain.where = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.values = vi.fn().mockReturnValue(chain);
  chain.onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.set = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockResolvedValue([]);
  return chain;
};

const dbMock = mockDbChain();

vi.mock("../../db", () => ({ db: dbMock }));
vi.mock("../../schema", () => ({
  financialAccounts: {
    accountConnectionId: "accountConnectionId",
    id: "id",
    providerAccountId: "providerAccountId",
    userId: "userId",
  },
  accountConnections: { id: "id", userId: "userId" },
  syncJobs: {},
  institutionRegistry: {},
  transactions: {
    accountId: "accountId",
    providerTransactionId: "providerTransactionId",
  },
  user: {},
}));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  sql: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
}));
vi.mock("@dbos-inc/dbos-sdk", () => ({ DBOS: {} }));
vi.mock("../../workflows/plaid-transaction-sync.workflow", () => ({
  TransactionSyncWorkflow: {},
}));

// Import after mocks are set up (module is cached, singleton is shared)
const { plaidService } = await import("./plaid.service");

/** Build a mock Plaid transactionsSync response */
function makeSyncResponse(overrides: {
  added?: Array<Record<string, unknown>>;
  modified?: Array<Record<string, unknown>>;
  removed?: Array<Record<string, unknown>>;
  has_more?: boolean;
  next_cursor?: string;
  transactions_update_status?: string;
}) {
  return {
    data: {
      added: overrides.added ?? [],
      modified: overrides.modified ?? [],
      removed: overrides.removed ?? [],
      has_more: overrides.has_more ?? false,
      next_cursor: overrides.next_cursor ?? "",
      transactions_update_status:
        overrides.transactions_update_status ?? "HISTORICAL_UPDATE_COMPLETE",
    },
  };
}

/** Build a minimal Plaid account object */
function makeAccount(accountId: string) {
  return {
    account_id: accountId,
    name: "Visa Credit",
    official_name: null,
    type: "credit",
    subtype: "credit card",
    mask: "0310",
    balances: { current: 195.95, available: 9804.05, iso_currency_code: "USD" },
  };
}

/** Account rows for connection 1, as `where` resolves them */
function accountRows(...providerAccountIds: string[]) {
  return providerAccountIds.map((providerAccountId, i) => ({
    id: i + 1,
    providerAccountId,
    userId: "user-1",
  }));
}

/**
 * `where` ends some chains (awaited directly) and continues the connection
 * lookup (`.limit(1)`), so it returns something that is both.
 */
function whereResult(rows: unknown[]) {
  return Object.assign(Promise.resolve(rows), {
    limit: () => Promise.resolve(rows),
  });
}

/** Build a minimal Plaid transaction object */
function makeTx(id: string, accountId = "plaid-acct-1") {
  return {
    transaction_id: id,
    account_id: accountId,
    amount: 42.0,
    iso_currency_code: "USD",
    date: "2025-01-15",
    authorized_date: null,
    pending: false,
    name: `Transaction ${id}`,
    merchant_name: "Test Merchant",
  };
}

describe("PlaidService.syncTransactions", () => {
  beforeEach(() => {
    mockTransactionsSync.mockReset();
    mockAccountsGet.mockReset();
    mockAccountsGet.mockResolvedValue({
      data: { accounts: [makeAccount("plaid-acct-1")] },
    });

    // Re-wire the db mock chain for each test
    dbMock.select = vi.fn().mockReturnValue(dbMock);
    dbMock.from = vi.fn().mockReturnValue(dbMock);
    dbMock.where = vi.fn(() => whereResult(accountRows("plaid-acct-1")));
    dbMock.insert = vi.fn().mockReturnValue(dbMock);
    dbMock.values = vi.fn().mockReturnValue(dbMock);
    dbMock.onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
    dbMock.update = vi.fn().mockReturnValue(dbMock);
    dbMock.set = vi.fn().mockReturnValue(dbMock);
  });

  // An Item with no /transactions/sync-eligible accounts (brokerages: the
  // endpoint covers credit, depository and some loan accounts only) returns an
  // empty delta AND an empty next_cursor — the same shape a NOT_READY Item
  // returns. Readiness must come from the status, never the cursor, or these
  // Items would wait ~4 minutes on every poll forever.
  it("does not wait for a ready Item that returns an empty cursor", async () => {
    mockTransactionsSync.mockResolvedValueOnce(
      makeSyncResponse({
        next_cursor: "",
        transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
      }),
    );

    const result = await plaidService.syncTransactions({
      connectionId: 1,
      accessToken: "access-token",
      cursor: null,
      waitForInitialPull: true,
    });

    expect(mockTransactionsSync).toHaveBeenCalledTimes(1);
    expect(result.added).toBe(0);
    expect(result.updateStatus).toBe("HISTORICAL_UPDATE_COMPLETE");
  });

  // An unreadable status must never produce an infinite wait.
  it("does not wait when the update status is unknown", async () => {
    mockTransactionsSync.mockResolvedValueOnce(
      makeSyncResponse({
        next_cursor: "",
        transactions_update_status: "TRANSACTIONS_UPDATE_STATUS_UNKNOWN",
      }),
    );

    const result = await plaidService.syncTransactions({
      connectionId: 1,
      accessToken: "access-token",
      cursor: null,
      waitForInitialPull: true,
    });

    expect(mockTransactionsSync).toHaveBeenCalledTimes(1);
    expect(result.updateStatus).toBe("TRANSACTIONS_UPDATE_STATUS_UNKNOWN");
  });

  // The scheduled poll runs connections serially, so it must never block on
  // Plaid's upstream pull even when the Item reports NOT_READY.
  it("does not wait during a scheduled poll even when NOT_READY", async () => {
    mockTransactionsSync.mockResolvedValueOnce(
      makeSyncResponse({ transactions_update_status: "NOT_READY" }),
    );

    const result = await plaidService.syncTransactions({
      connectionId: 1,
      accessToken: "access-token",
      cursor: null,
    });

    expect(mockTransactionsSync).toHaveBeenCalledTimes(1);
    expect(result.updateStatus).toBe("NOT_READY");
  });

  // Happy path: Plaid has data ready immediately, no polling needed
  it("syncs transactions on first call when data is ready", async () => {
    mockTransactionsSync.mockResolvedValueOnce(
      makeSyncResponse({
        added: [makeTx("tx-1"), makeTx("tx-2")],
        next_cursor: "cursor-1",
        transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
      }),
    );

    const result = await plaidService.syncTransactions({
      connectionId: 1,
      accessToken: "access-token",
      cursor: null,
    });

    expect(result.added).toBe(2);
    expect(result.nextCursor).toBe("cursor-1");
    expect(mockTransactionsSync).toHaveBeenCalledTimes(1);
  });

  // Core scenario: initial sync returns NOT_READY, service waits and retries,
  // second attempt returns transactions with HISTORICAL_UPDATE_COMPLETE
  it("polls with backoff when NOT_READY, then syncs when data arrives", async () => {
    vi.useFakeTimers();

    mockTransactionsSync
      .mockResolvedValueOnce(
        makeSyncResponse({
          next_cursor: "cursor-0",
          transactions_update_status: "NOT_READY",
        }),
      )
      .mockResolvedValueOnce(
        makeSyncResponse({
          added: [makeTx("tx-1"), makeTx("tx-2"), makeTx("tx-3")],
          next_cursor: "cursor-1",
          transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
        }),
      );

    const resultPromise = plaidService.syncTransactions({
      connectionId: 1,
      accessToken: "access-token",
      cursor: null,
      waitForInitialPull: true,
    });

    // Advance past the first backoff delay (5s)
    await vi.advanceTimersByTimeAsync(5000);

    const result = await resultPromise;

    expect(mockTransactionsSync).toHaveBeenCalledTimes(2);
    expect(result.added).toBe(3);
    expect(result.nextCursor).toBe("cursor-1");

    vi.useRealTimers();
  });

  // Edge case: Plaid never becomes ready within the retry window (~245s).
  // Service should give up after 10 retries and return 0 results.
  it("exhausts all retries when data never becomes ready", async () => {
    vi.useFakeTimers();

    // 11 calls total: 1 initial + 10 retries, all NOT_READY
    for (let i = 0; i < 11; i++) {
      mockTransactionsSync.mockResolvedValueOnce(
        makeSyncResponse({
          next_cursor: `cursor-${i}`,
          transactions_update_status: "NOT_READY",
        }),
      );
    }

    const resultPromise = plaidService.syncTransactions({
      connectionId: 1,
      accessToken: "access-token",
      cursor: null,
      waitForInitialPull: true,
    });

    // Advance through all backoff delays: 5s + 10s + 20s + 30s×7
    for (const delay of [
      5000, 10000, 20000, 30000, 30000, 30000, 30000, 30000, 30000, 30000,
    ]) {
      await vi.advanceTimersByTimeAsync(delay);
    }

    const result = await resultPromise;

    expect(mockTransactionsSync).toHaveBeenCalledTimes(11);
    expect(result.added).toBe(0);

    vi.useRealTimers();
  });

  // Timeout still saves initial data: even if retries are exhausted,
  // transactions from earlier responses are persisted and cursor is updated.
  it("saves initial data and cursor even when polling times out", async () => {
    vi.useFakeTimers();

    // First call: INITIAL_UPDATE_COMPLETE with transactions
    mockTransactionsSync.mockResolvedValueOnce(
      makeSyncResponse({
        added: [makeTx("tx-1"), makeTx("tx-2")],
        next_cursor: "cursor-1",
        transactions_update_status: "INITIAL_UPDATE_COMPLETE",
      }),
    );

    // Remaining 10 retries: all NOT_READY, no new data
    for (let i = 0; i < 10; i++) {
      mockTransactionsSync.mockResolvedValueOnce(
        makeSyncResponse({
          next_cursor: "cursor-1",
          transactions_update_status: "NOT_READY",
        }),
      );
    }

    const resultPromise = plaidService.syncTransactions({
      connectionId: 1,
      accessToken: "access-token",
      cursor: null,
      waitForInitialPull: true,
    });

    // Advance through all backoff delays
    for (const delay of [
      5000, 10000, 20000, 30000, 30000, 30000, 30000, 30000, 30000, 30000,
    ]) {
      await vi.advanceTimersByTimeAsync(delay);
    }

    const result = await resultPromise;

    expect(mockTransactionsSync).toHaveBeenCalledTimes(11);
    expect(result.added).toBe(2);
    expect(result.nextCursor).toBe("cursor-1");

    vi.useRealTimers();
  });

  // INITIAL_UPDATE_COMPLETE with data: should continue polling for historical data
  it("continues polling when INITIAL_UPDATE_COMPLETE, stops at HISTORICAL_UPDATE_COMPLETE", async () => {
    vi.useFakeTimers();

    mockTransactionsSync
      .mockResolvedValueOnce(
        makeSyncResponse({
          added: [makeTx("tx-1"), makeTx("tx-2"), makeTx("tx-3")],
          next_cursor: "cursor-1",
          transactions_update_status: "INITIAL_UPDATE_COMPLETE",
        }),
      )
      .mockResolvedValueOnce(
        makeSyncResponse({
          added: [makeTx("tx-4"), makeTx("tx-5")],
          next_cursor: "cursor-2",
          transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
        }),
      );

    const resultPromise = plaidService.syncTransactions({
      connectionId: 1,
      accessToken: "access-token",
      cursor: null,
      waitForInitialPull: true,
    });

    // Advance past the first backoff delay (5s)
    await vi.advanceTimersByTimeAsync(5000);

    const result = await resultPromise;

    expect(mockTransactionsSync).toHaveBeenCalledTimes(2);
    expect(result.added).toBe(5);
    expect(result.nextCursor).toBe("cursor-2");

    vi.useRealTimers();
  });

  // Incremental sync (cursor != null): should exit immediately without polling,
  // even if status is not HISTORICAL_UPDATE_COMPLETE
  it("does not poll during incremental sync (cursor != null)", async () => {
    mockTransactionsSync.mockResolvedValueOnce(
      makeSyncResponse({
        added: [makeTx("tx-1")],
        next_cursor: "cursor-2",
        transactions_update_status: "INITIAL_UPDATE_COMPLETE",
      }),
    );

    const result = await plaidService.syncTransactions({
      connectionId: 1,
      accessToken: "access-token",
      cursor: "cursor-1",
    });

    expect(mockTransactionsSync).toHaveBeenCalledTimes(1);
    expect(result.added).toBe(1);
    expect(result.nextCursor).toBe("cursor-2");
  });

  // A replacement card joins the Item with a new account_id. Accounts used to
  // be saved only at link time, so its transactions were skipped on every sync
  // while the cursor moved past them.
  it("saves transactions for an account added to the Item after linking", async () => {
    mockAccountsGet.mockResolvedValue({
      data: {
        accounts: [makeAccount("plaid-acct-1"), makeAccount("plaid-acct-2")],
      },
    });
    // The new account's row exists only once its upsert has run.
    let saved = false;
    dbMock.values = vi.fn((row: Record<string, unknown>) => {
      if (row.providerAccountId === "plaid-acct-2") saved = true;
      return dbMock;
    });
    dbMock.where = vi.fn(() =>
      whereResult(
        saved
          ? accountRows("plaid-acct-1", "plaid-acct-2")
          : accountRows("plaid-acct-1"),
      ),
    );
    mockTransactionsSync.mockResolvedValueOnce(
      makeSyncResponse({
        added: [makeTx("tx-new", "plaid-acct-2")],
        next_cursor: "cursor-2",
      }),
    );

    const result = await plaidService.syncTransactions({
      connectionId: 1,
      accessToken: "access-token",
      cursor: "cursor-1",
    });

    expect(dbMock.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        accountConnectionId: 1,
        providerAccountId: "plaid-acct-2",
        mask: "0310",
      }),
    );
    expect(dbMock.values).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 2, providerTransactionId: "tx-new" }),
    );
    expect(result.added).toBe(1);
  });

  it("warns about transactions for an account Plaid didn't list", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockTransactionsSync.mockResolvedValueOnce(
      makeSyncResponse({ added: [makeTx("tx-1", "plaid-acct-9")] }),
    );

    const result = await plaidService.syncTransactions({
      connectionId: 1,
      accessToken: "access-token",
      cursor: "cursor-1",
    });

    expect(result.added).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("plaid-acct-9"));
    warn.mockRestore();
  });
});

describe("PlaidService.getItemStatus", () => {
  beforeEach(() => {
    mockItemGet.mockReset();
  });

  it("parses transaction status timestamps and item fields", async () => {
    mockItemGet.mockResolvedValueOnce({
      data: {
        item: {
          error: null,
          created_at: "2026-03-05T03:25:49Z",
        },
        status: {
          transactions: {
            last_successful_update: "2026-04-27T07:47:05.046Z",
            last_failed_update: "2026-04-28T11:49:11.985Z",
          },
        },
      },
    });

    const result = await plaidService.getItemStatus("access-token");

    expect(result.lastSuccessfulUpdate?.toISOString()).toBe(
      "2026-04-27T07:47:05.046Z",
    );
    expect(result.lastFailedUpdate?.toISOString()).toBe(
      "2026-04-28T11:49:11.985Z",
    );
    expect(result.itemError).toBeNull();
    expect(result.itemCreatedAt?.toISOString()).toBe(
      "2026-03-05T03:25:49.000Z",
    );
  });

  it("returns null fields when status.transactions is missing", async () => {
    mockItemGet.mockResolvedValueOnce({
      data: {
        item: { error: null, created_at: null },
        status: {},
      },
    });

    const result = await plaidService.getItemStatus("access-token");

    expect(result.lastSuccessfulUpdate).toBeNull();
    expect(result.lastFailedUpdate).toBeNull();
    expect(result.itemError).toBeNull();
    expect(result.itemCreatedAt).toBeNull();
  });

  it("propagates a non-null item.error", async () => {
    const itemError = {
      error_code: "ITEM_LOGIN_REQUIRED",
      error_type: "ITEM_ERROR",
    };
    mockItemGet.mockResolvedValueOnce({
      data: {
        item: { error: itemError, created_at: "2026-03-05T03:25:49Z" },
        status: {
          transactions: {
            last_successful_update: null,
            last_failed_update: "2026-04-28T11:49:11Z",
          },
        },
      },
    });

    const result = await plaidService.getItemStatus("access-token");
    expect(result.itemError).toEqual(itemError);
    expect(result.lastSuccessfulUpdate).toBeNull();
    expect(result.lastFailedUpdate?.toISOString()).toBe(
      "2026-04-28T11:49:11.000Z",
    );
  });
});
