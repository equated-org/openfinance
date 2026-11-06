/**
 * Tests for the sync job the provider workflows share, through MX and Quiltt.
 *
 * Each provider used to decide for itself when to record an error and when to
 * email the user. Now a failure's code decides, so these pin what each provider
 * reports. Plaid's are in plaid-transaction-sync.workflow.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mxService = { syncTransactions: vi.fn(), getMemberStatus: vi.fn() };
const quilttService = {
  syncTransactions: vi.fn(),
  waitForConnectionSync: vi.fn(),
};
const notificationService = {
  sendAccountDisconnectEmail: vi.fn(),
  logTransactionSync: vi.fn(),
};

vi.mock("../lib/sync/mx.service", () => ({ mxService }));
vi.mock("../lib/sync/quiltt.service", () => ({ quilttService }));
vi.mock("../lib/notification.service", () => ({ notificationService }));
vi.mock("@dbos-inc/dbos-sdk", () => ({
  DBOS: {
    step: () => () => {},
    workflow: () => () => {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}));

const jobUpdates: Array<Record<string, unknown>> = [];
let rows: Array<Record<string, unknown>> = [];

// `where` ends the update chain (awaited directly) but continues the select
// chain (`.limit(1)`), so it returns something that is both.
const dbMock: Record<string, unknown> = {};
dbMock.select = vi.fn(() => dbMock);
dbMock.from = vi.fn(() => dbMock);
dbMock.update = vi.fn(() => dbMock);
dbMock.set = vi.fn((values: Record<string, unknown>) => {
  jobUpdates.push(values);
  return dbMock;
});
dbMock.where = vi.fn(() =>
  Object.assign(Promise.resolve(), { limit: () => Promise.resolve(rows) }),
);

vi.mock("../db", () => ({ db: dbMock }));
vi.mock("../schema", () => ({
  accountConnections: {},
  syncJobs: {},
  user: {},
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));

const { MxTransactionSyncWorkflow } = await import(
  "./mx-transaction-sync.workflow"
);
const { QuilttTransactionSyncWorkflow } = await import(
  "./quiltt-transaction-sync.workflow"
);

const input = { connectionId: 1, userId: "user-1", syncJobId: 500 };

/** What the job ended as. */
function terminalUpdate() {
  return jobUpdates.filter((u) => u.status !== undefined).at(-1);
}

beforeEach(() => {
  vi.clearAllMocks();
  jobUpdates.length = 0;
  // One row serves every lookup: the connection and the user's provider id.
  rows = [
    {
      mxMemberGuid: "member-1",
      quilttConnectionId: "quiltt-1",
      lastSyncedAt: new Date("2026-11-05T12:00:00Z"),
      mxUserGuid: "user-guid",
      quilttProfileId: "profile-1",
    },
  ];
});

describe("a sync job", () => {
  it("records what changed and logs the sync", async () => {
    mxService.getMemberStatus.mockResolvedValue({ connection_status: "CONNECTED" });
    mxService.syncTransactions.mockResolvedValue({ added: 3 });

    const result = await MxTransactionSyncWorkflow.run(input);

    expect(result).toEqual({ added: 3, modified: 0, removed: 0 });
    expect(terminalUpdate()).toMatchObject({
      status: "success",
      recordsProcessed: 3,
    });
    expect(notificationService.logTransactionSync).toHaveBeenCalledWith({
      userId: "user-1",
      connectionId: 1,
      added: 3,
      modified: 0,
      removed: 0,
    });
  });

  it("logs nothing when nothing changed", async () => {
    mxService.getMemberStatus.mockResolvedValue({ connection_status: "CONNECTED" });
    mxService.syncTransactions.mockResolvedValue({ added: 0 });

    await MxTransactionSyncWorkflow.run(input);

    expect(terminalUpdate()?.status).toBe("success");
    expect(notificationService.logTransactionSync).not.toHaveBeenCalled();
  });

  it("fails when the connection is gone", async () => {
    rows = [];

    expect(await MxTransactionSyncWorkflow.run(input)).toBeNull();

    expect(terminalUpdate()).toMatchObject({
      status: "error",
      errorMessage: "Connection not found",
    });
    expect(mxService.syncTransactions).not.toHaveBeenCalled();
  });

  it("still finishes when the disconnect email fails", async () => {
    mxService.getMemberStatus.mockResolvedValue({ connection_status: "EXPIRED" });
    notificationService.sendAccountDisconnectEmail.mockRejectedValue(
      new Error("Resend is down"),
    );

    expect(await MxTransactionSyncWorkflow.run(input)).toBeNull();

    expect(terminalUpdate()?.errorCode).toBe("CONNECTION_EXPIRED");
  });

  // DBOS stores what a step returns, so this must never select the token.
  it("reads no secrets from the connection", async () => {
    mxService.getMemberStatus.mockResolvedValue({ connection_status: "CONNECTED" });
    mxService.syncTransactions.mockResolvedValue({ added: 0 });

    await MxTransactionSyncWorkflow.run(input);

    const select = dbMock.select as ReturnType<typeof vi.fn>;
    expect(Object.keys(select.mock.calls[0][0])).not.toContain(
      "plaidAccessToken",
    );
  });
});

describe("MxTransactionSyncWorkflow", () => {
  it.each([
    ["EXPIRED", "CONNECTION_EXPIRED"],
    ["CHALLENGED", "ITEM_LOGIN_REQUIRED"],
  ])("asks the user to reconnect a member that's %s", async (status, code) => {
    mxService.getMemberStatus.mockResolvedValue({ connection_status: status });

    expect(await MxTransactionSyncWorkflow.run(input)).toBeNull();

    expect(terminalUpdate()).toMatchObject({
      status: "error",
      errorCode: code,
      errorMessage: `MX member ${status}`,
    });
    expect(notificationService.sendAccountDisconnectEmail).toHaveBeenCalledWith({
      userId: "user-1",
      connectionId: 1,
      errorMessage: `MX member ${status}`,
    });
    expect(mxService.syncTransactions).not.toHaveBeenCalled();
  });

  it("syncs anyway when the member check fails", async () => {
    mxService.getMemberStatus.mockRejectedValue(new Error("MX is down"));
    mxService.syncTransactions.mockResolvedValue({ added: 1 });

    await MxTransactionSyncWorkflow.run(input);

    expect(terminalUpdate()?.status).toBe("success");
  });

  it("syncs from the day of the last sync", async () => {
    mxService.getMemberStatus.mockResolvedValue({ connection_status: "CONNECTED" });
    mxService.syncTransactions.mockResolvedValue({ added: 0 });

    await MxTransactionSyncWorkflow.run(input);

    expect(mxService.syncTransactions).toHaveBeenCalledWith({
      connectionId: 1,
      userGuid: "user-guid",
      memberGuid: "member-1",
      fromDate: "2026-11-05",
    });
  });

  it("retries a failed sync without bothering the user", async () => {
    mxService.getMemberStatus.mockResolvedValue({ connection_status: "CONNECTED" });
    mxService.syncTransactions.mockRejectedValue(new Error("try later"));

    expect(await MxTransactionSyncWorkflow.run(input)).toBeNull();

    expect(terminalUpdate()).toMatchObject({
      status: "error",
      errorCode: null,
      errorMessage: "try later",
    });
    expect(notificationService.sendAccountDisconnectEmail).not.toHaveBeenCalled();
  });

  it("fails without a member GUID", async () => {
    rows = [{ ...rows[0], mxMemberGuid: null }];

    expect(await MxTransactionSyncWorkflow.run(input)).toBeNull();

    expect(terminalUpdate()?.status).toBe("error");
    expect(notificationService.sendAccountDisconnectEmail).not.toHaveBeenCalled();
  });
});

describe("QuilttTransactionSyncWorkflow", () => {
  it("asks the user to reconnect a repairable connection", async () => {
    quilttService.waitForConnectionSync.mockResolvedValue({
      status: "ERROR_REPAIRABLE",
      ready: false,
    });

    expect(await QuilttTransactionSyncWorkflow.run(input)).toBeNull();

    expect(terminalUpdate()).toMatchObject({
      status: "error",
      errorCode: "CONNECTION_EXPIRED",
    });
    expect(notificationService.sendAccountDisconnectEmail).toHaveBeenCalledOnce();
    expect(quilttService.syncTransactions).not.toHaveBeenCalled();
  });

  it("retries a provider error without bothering the user", async () => {
    quilttService.waitForConnectionSync.mockResolvedValue({
      status: "ERROR_PROVIDER",
      ready: false,
    });

    expect(await QuilttTransactionSyncWorkflow.run(input)).toBeNull();

    expect(terminalUpdate()).toMatchObject({
      status: "error",
      errorCode: "SYNC_ERROR",
      errorMessage: "Connection sync failed with status: ERROR_PROVIDER",
    });
    expect(notificationService.sendAccountDisconnectEmail).not.toHaveBeenCalled();
  });

  it("syncs anyway when the status check fails", async () => {
    quilttService.waitForConnectionSync.mockRejectedValue(new Error("403"));
    quilttService.syncTransactions.mockResolvedValue({ added: 2 });

    expect(await QuilttTransactionSyncWorkflow.run(input)).toEqual({
      added: 2,
      modified: 0,
      removed: 0,
    });

    expect(terminalUpdate()?.status).toBe("success");
  });

  it("retries a failed sync without bothering the user", async () => {
    quilttService.waitForConnectionSync.mockResolvedValue({
      status: "SYNCED",
      ready: true,
    });
    quilttService.syncTransactions.mockRejectedValue(new Error("try later"));

    expect(await QuilttTransactionSyncWorkflow.run(input)).toBeNull();

    expect(terminalUpdate()).toMatchObject({ status: "error", errorCode: null });
    expect(notificationService.sendAccountDisconnectEmail).not.toHaveBeenCalled();
  });

  it("fails without a profile", async () => {
    rows = [{ ...rows[0], quilttProfileId: null }];

    expect(await QuilttTransactionSyncWorkflow.run(input)).toBeNull();

    expect(terminalUpdate()).toMatchObject({
      status: "error",
      errorMessage: "User does not have a Quiltt profile ID",
    });
  });
});
