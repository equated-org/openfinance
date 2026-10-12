/**
 * Tests for PlaidTransactionSyncWorkflow's upstream-pull handling.
 *
 * The retry loop used to exit on a transaction delta, which is not a readiness
 * signal. That conflated two different things: an Item that finished pulling
 * with nothing to report looked identical to one that never finished. The
 * consequences were a job marked `success` on a pull that never completed, and
 * ~18.5 minutes of pointless backoff whenever a sync legitimately had no
 * changes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSyncTransactions = vi.fn();
const mockGetItemStatus = vi.fn();

vi.mock("../lib/sync/plaid.service", () => ({
  plaidService: {
    syncTransactions: mockSyncTransactions,
    getItemStatus: mockGetItemStatus,
  },
}));

vi.mock("../lib/notification.service", () => ({
  notificationService: {
    sendAccountDisconnectEmail: vi.fn(),
    logTransactionSync: vi.fn(),
  },
}));

const sleepCalls: number[] = [];
vi.mock("@dbos-inc/dbos-sdk", () => ({
  DBOS: {
    step: () => () => {},
    workflow: () => () => {},
    sleep: (ms: number) => {
      sleepCalls.push(ms);
      return Promise.resolve();
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}));

const jobUpdates: Array<Record<string, unknown>> = [];
let connectionRows: Array<Record<string, unknown>> = [];

// `where` terminates the update chain (awaited directly) but continues the
// select chain (`.limit(1)`), so it returns something that is both thenable
// and chainable.
const dbMock: Record<string, unknown> = {};
dbMock.select = vi.fn(() => dbMock);
dbMock.from = vi.fn(() => dbMock);
dbMock.update = vi.fn(() => dbMock);
dbMock.set = vi.fn((values: Record<string, unknown>) => {
  jobUpdates.push(values);
  return dbMock;
});
dbMock.where = vi.fn(() => ({
  limit: () => Promise.resolve(connectionRows),
  then: (resolve: (v: unknown) => unknown) => Promise.resolve().then(resolve),
}));

vi.mock("../db", () => ({ db: dbMock }));
vi.mock("../schema", () => ({ accountConnections: { id: "id" }, syncJobs: { id: "id" } }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));

const { PlaidTransactionSyncWorkflow } = await import(
  "./plaid-transaction-sync.workflow"
);

/** The connection row `fetchConnection` reads. */
function connection(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    userId: "user-1",
    plaidAccessToken: "access-token",
    transactionCursor: null,
    ...overrides,
  };
}

function syncResult(overrides: Record<string, unknown> = {}) {
  return {
    nextCursor: "",
    added: 0,
    modified: 0,
    removed: 0,
    updateStatus: "HISTORICAL_UPDATE_COMPLETE",
    ...overrides,
  };
}

/** The terminal write to sync_jobs (status success/error). */
function terminalUpdate() {
  return jobUpdates.filter((u) => u.status !== undefined).at(-1);
}

describe("PlaidTransactionSyncWorkflow upstream pull", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobUpdates.length = 0;
    sleepCalls.length = 0;
    connectionRows = [];
  });

  function withConnection(conn: Record<string, unknown>) {
    connectionRows = [conn];
  }

  it("does not report success when Plaid never becomes ready", async () => {
    withConnection(connection());
    mockGetItemStatus.mockResolvedValue({ lastSuccessfulUpdate: null });
    mockSyncTransactions.mockResolvedValue(
      syncResult({ updateStatus: "NOT_READY" }),
    );

    const result = await PlaidTransactionSyncWorkflow.run({
      connectionId: 1,
      userId: "user-1",
      syncJobId: 500,
      awaitUpstreamPull: true,
    });

    expect(result).toBeNull();

    const terminal = terminalUpdate();
    expect(terminal?.status).toBe("error");
    expect(terminal?.errorCode).toBe("UPSTREAM_NOT_READY");
  });

  it("succeeds immediately when ready with no changes, without sleeping", async () => {
    withConnection(connection());
    mockGetItemStatus.mockResolvedValue({ lastSuccessfulUpdate: null });
    mockSyncTransactions.mockResolvedValue(
      syncResult({ updateStatus: "HISTORICAL_UPDATE_COMPLETE" }),
    );

    await PlaidTransactionSyncWorkflow.run({
      connectionId: 1,
      userId: "user-1",
      syncJobId: 501,
      awaitUpstreamPull: true,
    });

    // The old delta-based exit burned every backoff delay here.
    expect(sleepCalls).toEqual([]);
    expect(mockSyncTransactions).toHaveBeenCalledTimes(1);
    expect(terminalUpdate()?.status).toBe("success");
  });

  it("treats an unknown update status as ready rather than blocking", async () => {
    withConnection(connection());
    mockGetItemStatus.mockResolvedValue({ lastSuccessfulUpdate: null });
    mockSyncTransactions.mockResolvedValue(
      syncResult({ updateStatus: "TRANSACTIONS_UPDATE_STATUS_UNKNOWN" }),
    );

    await PlaidTransactionSyncWorkflow.run({
      connectionId: 1,
      userId: "user-1",
      syncJobId: 502,
      awaitUpstreamPull: true,
    });

    expect(sleepCalls).toEqual([]);
    expect(terminalUpdate()?.status).toBe("success");
  });

  it("waits for a reauth pull to land even though the status already reads complete", async () => {
    const baseline = new Date("2026-05-01T00:00:00Z");
    const advanced = new Date("2026-07-22T00:00:00Z");

    withConnection(connection({ transactionCursor: "cursor-1" }));
    // Status is already HISTORICAL_UPDATE_COMPLETE from the original link, so
    // only last_successful_update can reveal the fresh pull.
    mockSyncTransactions.mockResolvedValue(syncResult());
    mockGetItemStatus
      .mockResolvedValueOnce({ lastSuccessfulUpdate: baseline }) // baseline
      .mockResolvedValueOnce({ lastSuccessfulUpdate: baseline }) // still stale
      .mockResolvedValue({ lastSuccessfulUpdate: advanced }); // landed

    await PlaidTransactionSyncWorkflow.run({
      connectionId: 1,
      userId: "user-1",
      syncJobId: 503,
      awaitUpstreamPull: true,
    });

    // Waited rather than exiting on the already-complete status.
    expect(sleepCalls.length).toBeGreaterThan(0);
    expect(terminalUpdate()?.status).toBe("success");
  });

  it("does not report success when a reauth pull never lands", async () => {
    const baseline = new Date("2026-05-01T00:00:00Z");

    withConnection(connection({ transactionCursor: "cursor-1" }));
    mockSyncTransactions.mockResolvedValue(syncResult());
    mockGetItemStatus.mockResolvedValue({ lastSuccessfulUpdate: baseline });

    const result = await PlaidTransactionSyncWorkflow.run({
      connectionId: 1,
      userId: "user-1",
      syncJobId: 504,
      awaitUpstreamPull: true,
    });

    expect(result).toBeNull();
    expect(terminalUpdate()?.errorCode).toBe("UPSTREAM_NOT_READY");
  });

  it("UPSTREAM_NOT_READY does not raise a reconnect notification", async () => {
    const { notificationService } = await import("../lib/notification.service");

    withConnection(connection());
    mockGetItemStatus.mockResolvedValue({ lastSuccessfulUpdate: null });
    mockSyncTransactions.mockResolvedValue(
      syncResult({ updateStatus: "NOT_READY" }),
    );

    await PlaidTransactionSyncWorkflow.run({
      connectionId: 1,
      userId: "user-1",
      syncJobId: 505,
      awaitUpstreamPull: true,
    });

    expect(notificationService.sendAccountDisconnectEmail).not.toHaveBeenCalled();
  });
});
