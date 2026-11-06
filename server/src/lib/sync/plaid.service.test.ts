/**
 * Tests for PlaidService.syncTransactions: reading a whole update from
 * /transactions/sync and saving it. Waiting for Plaid's pull to finish is the
 * sync workflow's job.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockTransactionsSync = vi.fn();
const mockItemGet = vi.fn();
const mockAccountsGet = vi.fn();
const mockItemRemove = vi.fn();

vi.mock("./plaid.client", () => ({
  plaidClient: {
    transactionsSync: mockTransactionsSync,
    itemGet: mockItemGet,
    accountsGet: mockAccountsGet,
    itemRemove: mockItemRemove,
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
  accountConnections: {
    id: "id",
    userId: "userId",
    plaidAccessToken: "plaidAccessToken",
    transactionCursor: "transactionCursor",
  },
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
  and: vi.fn(),
  inArray: vi.fn(),
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

/** The connection row `loadConnection` reads. */
let connectionRow: {
  userId: string;
  accessToken: string | null;
  cursor: string | null;
};

/**
 * `where` ends some chains (awaited directly) and continues the connection
 * lookup (`.limit(1)`), so it returns something that is both.
 */
function whereResult(rows: unknown[]) {
  return Object.assign(Promise.resolve(rows), {
    limit: () => Promise.resolve([connectionRow]),
  });
}

/** Points the db mock at connection 1, with one account. */
function wireDb() {
  connectionRow = { userId: "user-1", accessToken: "access-token", cursor: null };
  dbMock.select = vi.fn().mockReturnValue(dbMock);
  dbMock.from = vi.fn().mockReturnValue(dbMock);
  dbMock.where = vi.fn(() => whereResult(accountRows("plaid-acct-1")));
  dbMock.insert = vi.fn().mockReturnValue(dbMock);
  dbMock.values = vi.fn().mockReturnValue(dbMock);
  dbMock.onConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  dbMock.update = vi.fn().mockReturnValue(dbMock);
  dbMock.set = vi.fn().mockReturnValue(dbMock);
}

/** Syncs connection 1 from a saved cursor. */
function syncFrom(cursor: string | null) {
  connectionRow.cursor = cursor;
  return plaidService.syncTransactions(1);
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

    wireDb();
  });

  it("syncs transactions on first call when data is ready", async () => {
    mockTransactionsSync.mockResolvedValueOnce(
      makeSyncResponse({
        added: [makeTx("tx-1"), makeTx("tx-2")],
        next_cursor: "cursor-1",
        transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
      }),
    );

    const result = await syncFrom(null);

    expect(result.added).toBe(2);
    expect(result.nextCursor).toBe("cursor-1");
    expect(mockTransactionsSync).toHaveBeenCalledTimes(1);
  });

  /** The transactions saved so far, in order. */
  function savedTransactionIds() {
    const values = dbMock.values as ReturnType<typeof vi.fn>;
    return values.mock.calls
      .map(([row]) => (row as { providerTransactionId?: string }).providerTransactionId)
      .filter(Boolean);
  }

  const dataChanged = Object.assign(new Error("data changed"), {
    errorCode: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION",
  });

  it("reads every page before saving anything", async () => {
    let savedBeforeLastPage: unknown[] = [];
    mockTransactionsSync
      .mockResolvedValueOnce(
        makeSyncResponse({
          added: [makeTx("tx-1")],
          next_cursor: "page-2",
          has_more: true,
        }),
      )
      .mockImplementationOnce(async () => {
        savedBeforeLastPage = savedTransactionIds();
        return makeSyncResponse({
          added: [makeTx("tx-2")],
          next_cursor: "cursor-2",
        });
      });

    const result = await syncFrom("cursor-1");

    expect(savedBeforeLastPage).toEqual([]);
    expect(savedTransactionIds()).toEqual(["tx-1", "tx-2"]);
    expect(result).toMatchObject({ added: 2, nextCursor: "cursor-2" });
    expect(mockTransactionsSync).toHaveBeenCalledWith(
      expect.objectContaining({ count: 500 }),
    );
  });

  // Plaid requires restarting from the update's first cursor. A transaction
  // from the abandoned attempt may have since been removed, and the restarted
  // update wouldn't mention it, so saving it would leave a phantom row.
  it("restarts from the original cursor when the data changes mid-update", async () => {
    mockTransactionsSync
      .mockResolvedValueOnce(
        makeSyncResponse({
          added: [makeTx("tx-abandoned")],
          next_cursor: "page-2",
          has_more: true,
        }),
      )
      .mockRejectedValueOnce(dataChanged)
      .mockResolvedValueOnce(
        makeSyncResponse({ added: [makeTx("tx-1")], next_cursor: "cursor-2" }),
      );

    const result = await syncFrom("cursor-1");

    expect(mockTransactionsSync.mock.calls.map(([req]) => req.cursor)).toEqual([
      "cursor-1",
      "page-2",
      "cursor-1",
    ]);
    expect(savedTransactionIds()).toEqual(["tx-1"]);
    expect(result).toMatchObject({ added: 1, nextCursor: "cursor-2" });
  });

  it("gives up when the data never settles, keeping the cursor", async () => {
    mockTransactionsSync.mockRejectedValue(dataChanged);

    await expect(
      syncFrom("cursor-1"),
    ).rejects.toBe(dataChanged);

    expect(mockTransactionsSync).toHaveBeenCalledTimes(3);
    expect(dbMock.set).not.toHaveBeenCalled();
  });

  it("doesn't retry any other error", async () => {
    const loginRequired = Object.assign(new Error("login"), {
      errorCode: "ITEM_LOGIN_REQUIRED",
    });
    mockTransactionsSync.mockRejectedValue(loginRequired);

    await expect(
      syncFrom("cursor-1"),
    ).rejects.toBe(loginRequired);

    expect(mockTransactionsSync).toHaveBeenCalledTimes(1);
  });

  it("continues from the saved cursor and reports the update status", async () => {
    mockTransactionsSync.mockResolvedValueOnce(
      makeSyncResponse({
        added: [makeTx("tx-1")],
        next_cursor: "cursor-2",
        transactions_update_status: "INITIAL_UPDATE_COMPLETE",
      }),
    );

    const result = await syncFrom("cursor-1");

    expect(mockTransactionsSync).toHaveBeenCalledTimes(1);
    expect(result.added).toBe(1);
    expect(result.nextCursor).toBe("cursor-2");
    expect(result.updateStatus).toBe("INITIAL_UPDATE_COMPLETE");
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

    const result = await syncFrom("cursor-1");

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

  it("only removes transactions from this connection's accounts", async () => {
    const { inArray } = await import("drizzle-orm");
    mockTransactionsSync.mockResolvedValueOnce(
      makeSyncResponse({
        removed: [{ transaction_id: "tx-gone", account_id: "plaid-acct-1" }],
        next_cursor: "cursor-2",
      }),
    );

    const result = await syncFrom("cursor-1");

    expect(result.removed).toBe(1);
    expect(dbMock.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "deleted" }),
    );
    expect(inArray).toHaveBeenCalledWith("accountId", [1]);
    expect(inArray).toHaveBeenCalledWith("providerTransactionId", ["tx-gone"]);
  });

  it("fails when the connection has no access token", async () => {
    connectionRow.accessToken = null;

    await expect(plaidService.syncTransactions(1)).rejects.toThrow(
      "Connection 1 not found or missing access token",
    );
    expect(mockTransactionsSync).not.toHaveBeenCalled();
  });

  it("warns about transactions for an account Plaid didn't list", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockTransactionsSync.mockResolvedValueOnce(
      makeSyncResponse({ added: [makeTx("tx-1", "plaid-acct-9")] }),
    );

    const result = await syncFrom("cursor-1");

    expect(result.added).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("plaid-acct-9"));
    warn.mockRestore();
  });
});

describe("PlaidService.getItemStatus", () => {
  beforeEach(() => {
    mockItemGet.mockReset();
    wireDb();
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

    const result = await plaidService.getItemStatus(1);

    expect(mockItemGet).toHaveBeenCalledWith({ access_token: "access-token" });
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

    const result = await plaidService.getItemStatus(1);

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

    const result = await plaidService.getItemStatus(1);
    expect(result.itemError).toEqual(itemError);
    expect(result.lastSuccessfulUpdate).toBeNull();
    expect(result.lastFailedUpdate?.toISOString()).toBe(
      "2026-04-28T11:49:11.000Z",
    );
  });
});

describe("PlaidService.itemRemove", () => {
  beforeEach(() => {
    mockItemRemove.mockReset();
  });

  it("confirms a removal", async () => {
    mockItemRemove.mockResolvedValueOnce({ data: {} });

    await expect(plaidService.itemRemove("token")).resolves.toBe(true);
  });

  it("counts an Item that's already gone as removed", async () => {
    mockItemRemove.mockRejectedValueOnce(
      Object.assign(new Error("not found"), { errorCode: "ITEM_NOT_FOUND" }),
    );

    await expect(plaidService.itemRemove("token")).resolves.toBe(true);
  });

  it("reports any other failure", async () => {
    mockItemRemove.mockRejectedValueOnce(
      Object.assign(new Error("down"), { errorCode: "INTERNAL_SERVER_ERROR" }),
    );

    await expect(plaidService.itemRemove("token")).resolves.toBe(false);
  });
});
