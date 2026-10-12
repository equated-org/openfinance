import { randomUUID } from "crypto";
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  vi,
} from "vitest";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import {
  user,
  accountConnections,
  financialAccounts,
  institutionRegistry,
  syncJobs,
  transactions,
} from "../../schema";
import { mapQuilttTypeToAccountType, quilttService } from "./quiltt.service.js";

describe("mapQuilttTypeToAccountType", () => {
  it("should map depository account types correctly", () => {
    expect(mapQuilttTypeToAccountType("CHECKING")).toBe("depository");
    expect(mapQuilttTypeToAccountType("SAVINGS")).toBe("depository");
    expect(mapQuilttTypeToAccountType("MONEY_MARKET")).toBe("depository");
    expect(mapQuilttTypeToAccountType("CD")).toBe("depository");
  });

  it("should map credit account types correctly", () => {
    expect(mapQuilttTypeToAccountType("CREDIT_CARD")).toBe("credit");
    expect(mapQuilttTypeToAccountType("LINE_OF_CREDIT")).toBe("credit");
  });

  it("should map loan account types correctly", () => {
    expect(mapQuilttTypeToAccountType("LOAN")).toBe("loan");
    expect(mapQuilttTypeToAccountType("MORTGAGE")).toBe("loan");
    expect(mapQuilttTypeToAccountType("STUDENT")).toBe("loan");
    expect(mapQuilttTypeToAccountType("AUTO")).toBe("loan");
  });

  it("should map investment account types correctly", () => {
    expect(mapQuilttTypeToAccountType("INVESTMENT")).toBe("investment");
    expect(mapQuilttTypeToAccountType("BROKERAGE")).toBe("investment");
    expect(mapQuilttTypeToAccountType("RETIREMENT")).toBe("investment");
    expect(mapQuilttTypeToAccountType("401K")).toBe("investment");
    expect(mapQuilttTypeToAccountType("IRA")).toBe("investment");
  });

  it("should be case-insensitive", () => {
    expect(mapQuilttTypeToAccountType("checking")).toBe("depository");
    expect(mapQuilttTypeToAccountType("Savings")).toBe("depository");
    expect(mapQuilttTypeToAccountType("credit_card")).toBe("credit");
  });

  it("should default unknown types to depository", () => {
    expect(mapQuilttTypeToAccountType("UNKNOWN_TYPE")).toBe("depository");
    expect(mapQuilttTypeToAccountType("")).toBe("depository");
    expect(mapQuilttTypeToAccountType("RANDOM")).toBe("depository");
  });

  describe("Name-based detection for OTHER type", () => {
    it("should detect investment accounts by name when type is OTHER", () => {
      expect(mapQuilttTypeToAccountType("OTHER", "401K")).toBe("investment");
      expect(mapQuilttTypeToAccountType("OTHER", "My 401k Account")).toBe(
        "investment",
      );
      expect(mapQuilttTypeToAccountType("OTHER", "Roth IRA")).toBe(
        "investment",
      );
      expect(mapQuilttTypeToAccountType("OTHER", "Traditional IRA")).toBe(
        "investment",
      );
      expect(mapQuilttTypeToAccountType("OTHER", "403B")).toBe("investment");
      expect(mapQuilttTypeToAccountType("OTHER", "529 College Savings")).toBe(
        "investment",
      );
      expect(mapQuilttTypeToAccountType("OTHER", "ROLLOVER")).toBe(
        "investment",
      );
      expect(mapQuilttTypeToAccountType("OTHER", "Retirement Account")).toBe(
        "investment",
      );
      expect(mapQuilttTypeToAccountType("OTHER", "Brokerage Account")).toBe(
        "investment",
      );
      expect(mapQuilttTypeToAccountType("OTHER", "Investment Portfolio")).toBe(
        "investment",
      );
    });

    it("should detect credit accounts by name when type is OTHER", () => {
      expect(mapQuilttTypeToAccountType("OTHER", "Credit Card")).toBe("credit");
      expect(mapQuilttTypeToAccountType("OTHER", "Visa CreditCard")).toBe(
        "credit",
      );
      expect(mapQuilttTypeToAccountType("OTHER", "Line of Credit")).toBe(
        "credit",
      );
      expect(mapQuilttTypeToAccountType("OTHER", "HELOC")).toBe("credit");
    });

    it("should detect loan accounts by name when type is OTHER", () => {
      expect(mapQuilttTypeToAccountType("OTHER", "Home Mortgage")).toBe("loan");
      expect(mapQuilttTypeToAccountType("OTHER", "Auto Loan")).toBe("loan");
      expect(mapQuilttTypeToAccountType("OTHER", "Autoloan")).toBe("loan");
      expect(mapQuilttTypeToAccountType("OTHER", "Student Loan")).toBe("loan");
      expect(mapQuilttTypeToAccountType("OTHER", "Personal Loan")).toBe("loan");
    });

    it("should detect depository accounts by name when type is OTHER", () => {
      expect(mapQuilttTypeToAccountType("OTHER", "Checking Account")).toBe(
        "depository",
      );
      expect(mapQuilttTypeToAccountType("OTHER", "Savings Account")).toBe(
        "depository",
      );
      expect(mapQuilttTypeToAccountType("OTHER", "Money Market")).toBe(
        "depository",
      );
      expect(mapQuilttTypeToAccountType("OTHER", "CD 12 Month")).toBe(
        "depository",
      );
    });

    it("should default to depository when name doesn't match any pattern", () => {
      expect(mapQuilttTypeToAccountType("OTHER", "Unknown Account")).toBe(
        "depository",
      );
      expect(mapQuilttTypeToAccountType("OTHER", "My Account")).toBe(
        "depository",
      );
      expect(mapQuilttTypeToAccountType("OTHER")).toBe("depository");
    });

    it("should not use name-based detection for non-OTHER types", () => {
      expect(mapQuilttTypeToAccountType("CHECKING", "Investment Account")).toBe(
        "depository",
      );
      expect(mapQuilttTypeToAccountType("SAVINGS", "401K")).toBe("depository");
    });
  });
});

describe("QuilttService.syncTransactions", () => {
  const testUserId = `test-user-${randomUUID().slice(0, 8)}`;
  const quilttConnectionId = `conn_${randomUUID().slice(0, 8)}`;
  let connectionId: number;

  beforeAll(async () => {
    await db.insert(user).values({
      id: testUserId,
      name: "Test User",
      email: `${testUserId}@test.com`,
      emailVerified: false,
    });

    const [conn] = await db
      .insert(accountConnections)
      .values({
        userId: testUserId,
        provider: "quiltt",
        quilttConnectionId,
        status: "active",
      })
      .returning();
    connectionId = conn.id;
  });

  afterAll(async () => {
    await db.delete(transactions).where(eq(transactions.userId, testUserId));
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
      .where(
        inArray(institutionRegistry.providerCompositeKey, [
          "quiltt_inst_test",
          "quiltt_inst_cibc",
          `quiltt_inst_wf_${quilttConnectionId}`,
          `mastercard_wf_${quilttConnectionId}`,
        ]),
      );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("upserts accounts that the initial sync missed (INITIALIZING case)", async () => {
    // Pre-condition: connection exists but no financial accounts (the bug scenario:
    // initial sync ran while Quiltt was INITIALIZING and returned empty accounts).
    const before = await db
      .select()
      .from(financialAccounts)
      .where(eq(financialAccounts.accountConnectionId, connectionId));
    expect(before).toHaveLength(0);

    vi.spyOn(quilttService, "getConnection").mockResolvedValue({
      id: quilttConnectionId,
      provider: "plaid_aggregated",
      status: "SYNCED",
      institution: { id: "inst_test", name: "Test Bank" },
      accounts: [
        {
          id: "quiltt_acct_checking",
          name: "Checking",
          kind: "CHECKING",
          mask: "1111",
          balance: { current: 100.5, available: 95.5 },
        },
        {
          id: "quiltt_acct_savings",
          name: "Savings",
          kind: "SAVINGS",
          mask: "2222",
          balance: { current: 5000, available: 5000 },
        },
      ],
    });
    vi.spyOn(quilttService, "getAllTransactions").mockResolvedValue([]);

    await quilttService.syncTransactions({
      connectionId,
      quilttConnectionId,
      quilttProfileId: "profile_1",
    });

    const after = await db
      .select()
      .from(financialAccounts)
      .where(eq(financialAccounts.accountConnectionId, connectionId));

    expect(after).toHaveLength(2);
    const checking = after.find(
      (a) => a.providerAccountId === "quiltt_acct_checking",
    );
    expect(checking?.name).toBe("Checking");
    expect(checking?.type).toBe("depository");
    expect(checking?.mask).toBe("1111");
  });

  // The currency used to be hardcoded to "USD", which filed Canadian accounts
  // (e.g. a CIBC chequing account reporting CAD) under USD.
  it("stores the currency Quiltt reports rather than assuming USD", async () => {
    vi.spyOn(quilttService, "getConnection").mockResolvedValue({
      id: quilttConnectionId,
      provider: "plaid_aggregated",
      status: "SYNCED",
      institution: { id: "inst_cibc", name: "CIBC Canada" },
      accounts: [
        {
          id: "quiltt_acct_cad",
          name: "CHECKING",
          kind: "CHECKING",
          mask: "7388",
          currencyCode: "CAD",
          balance: { current: 77455.46, available: 77455.46 },
        },
        {
          id: "quiltt_acct_no_currency",
          name: "Unknown Currency",
          kind: "CHECKING",
          mask: "3333",
          balance: { current: 10, available: 10 },
        },
      ],
    });
    vi.spyOn(quilttService, "getAllTransactions").mockResolvedValue([]);

    await quilttService.syncTransactions({
      connectionId,
      quilttConnectionId,
      quilttProfileId: "profile_1",
    });

    const after = await db
      .select()
      .from(financialAccounts)
      .where(eq(financialAccounts.accountConnectionId, connectionId));

    expect(
      after.find((a) => a.providerAccountId === "quiltt_acct_cad")
        ?.isoCurrencyCode,
    ).toBe("CAD");
    expect(
      after.find((a) => a.providerAccountId === "quiltt_acct_no_currency")
        ?.isoCurrencyCode,
    ).toBeNull();
  });

  // The account-level fix above left the transaction path still defaulting to
  // "USD", so a CAD account's transactions were stamped USD while the account
  // row said CAD.
  it("stores transaction currency from Quiltt, falling back to the account's currency instead of USD", async () => {
    vi.spyOn(quilttService, "getConnection").mockResolvedValue({
      id: quilttConnectionId,
      provider: "plaid_aggregated",
      status: "SYNCED",
      institution: { id: "inst_cibc", name: "CIBC Canada" },
      accounts: [
        {
          id: "quiltt_acct_cad",
          name: "CHECKING",
          kind: "CHECKING",
          mask: "7388",
          currencyCode: "CAD",
          balance: { current: 77455.46, available: 77455.46 },
        },
        {
          id: "quiltt_acct_no_currency",
          name: "Unknown Currency",
          kind: "CHECKING",
          mask: "3333",
          balance: { current: 10, available: 10 },
        },
      ],
    });
    vi.spyOn(quilttService, "getAllTransactions").mockResolvedValue([
      {
        id: "quiltt_txn_explicit",
        date: "2026-07-01",
        description: "Explicit currency",
        amount: 25.5,
        currencyCode: "CAD",
        entryType: "DEBIT",
        status: "POSTED",
        account: { id: "quiltt_acct_cad" },
      },
      {
        // Quiltt omitted currencyCode — must inherit CAD from the account.
        id: "quiltt_txn_inherits",
        date: "2026-07-02",
        description: "No currency reported",
        amount: 40,
        entryType: "DEBIT",
        status: "POSTED",
        account: { id: "quiltt_acct_cad" },
      },
      {
        // Neither the transaction nor the account has a currency — stay null
        // rather than inventing one.
        id: "quiltt_txn_unknown",
        date: "2026-07-03",
        description: "Unknowable currency",
        amount: 5,
        entryType: "CREDIT",
        status: "POSTED",
        account: { id: "quiltt_acct_no_currency" },
      },
    ]);

    await quilttService.syncTransactions({
      connectionId,
      quilttConnectionId,
      quilttProfileId: "profile_1",
    });

    const rows = await db
      .select()
      .from(transactions)
      .where(eq(transactions.userId, testUserId));

    const byProviderId = (id: string) =>
      rows.find((t) => t.providerTransactionId === id);

    expect(byProviderId("quiltt_txn_explicit")?.isoCurrencyCode).toBe("CAD");
    expect(byProviderId("quiltt_txn_inherits")?.isoCurrencyCode).toBe("CAD");
    expect(byProviderId("quiltt_txn_unknown")?.isoCurrencyCode).toBeNull();
  });

  // Connections made before Quiltt named them point at the old Mastercard
  // catalog; their next sync moves them onto Quiltt's institution.
  it("moves a connection onto the institution Quiltt reports", async () => {
    const [catalogRow] = await db
      .insert(institutionRegistry)
      .values({
        name: "Wells Fargo",
        url: "www.wellsfargo.com",
        countryCode: "US",
        providerCompositeKey: `mastercard_wf_${quilttConnectionId}`,
        lastSynced: new Date(),
      })
      .returning();
    await db
      .update(accountConnections)
      .set({ institutionRegistryId: catalogRow.id })
      .where(eq(accountConnections.id, connectionId));

    vi.spyOn(quilttService, "getConnection").mockResolvedValue({
      id: quilttConnectionId,
      provider: "FINICITY",
      status: "SYNCED",
      institution: {
        id: `inst_wf_${quilttConnectionId}`,
        name: "Wells Fargo",
        logo: { url: "https://cdn.quiltt.io/institutions/wf.png" },
      },
      accounts: [],
    });
    vi.spyOn(quilttService, "getAllTransactions").mockResolvedValue([]);

    await quilttService.syncTransactions({
      connectionId,
      quilttConnectionId,
      quilttProfileId: "profile_1",
    });

    const [row] = await db
      .select({
        key: institutionRegistry.providerCompositeKey,
        logo: institutionRegistry.logo,
      })
      .from(accountConnections)
      .innerJoin(
        institutionRegistry,
        eq(accountConnections.institutionRegistryId, institutionRegistry.id),
      )
      .where(eq(accountConnections.id, connectionId));
    expect(row).toEqual({
      key: `quiltt_inst_wf_${quilttConnectionId}`,
      logo: "https://cdn.quiltt.io/institutions/wf.png",
    });
  });
});

describe("QuilttService.connectAndPerformInitialSync", () => {
  const suffix = randomUUID().slice(0, 8);
  const testUserId = `test-user-${suffix}`;
  const institution = {
    id: `inst_${suffix}`,
    name: "BMO",
    logo: { url: "https://cdn.quiltt.io/institutions/bmo.png" },
  };
  let catalogRowId: number;

  beforeAll(async () => {
    await db.insert(user).values({
      id: testUserId,
      name: "Test User",
      email: `${testUserId}@test.com`,
      emailVerified: false,
    });
    const [row] = await db
      .insert(institutionRegistry)
      .values({
        name: "Bank of Montreal",
        url: "https://www.bmo.com",
        countryCode: "CA",
        providerCompositeKey: `mastercard_${suffix}`,
        lastSynced: new Date(),
      })
      .returning();
    catalogRowId = row.id;
  });

  beforeEach(() => {
    vi.spyOn(DBOS, "startWorkflow").mockReturnValue({
      run: vi.fn().mockResolvedValue(undefined),
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    const conns = await db
      .select({ id: accountConnections.id })
      .from(accountConnections)
      .where(eq(accountConnections.userId, testUserId));
    if (conns.length) {
      await db.delete(syncJobs).where(
        inArray(
          syncJobs.accountConnectionId,
          conns.map((c) => c.id),
        ),
      );
    }
    await db
      .delete(accountConnections)
      .where(eq(accountConnections.userId, testUserId));
    await db.delete(user).where(eq(user.id, testUserId));
    await db
      .delete(institutionRegistry)
      .where(
        inArray(institutionRegistry.providerCompositeKey, [
          `mastercard_${suffix}`,
          `quiltt_${institution.id}`,
        ]),
      );
  });

  /** Connects through Quiltt and returns the connection's registry id. */
  async function connect(
    quilttConnectionId: string,
    reported: {
      id: string;
      name: string;
      logo?: { url: string } | null;
    } | null = institution,
  ) {
    vi.spyOn(quilttService, "getConnection").mockResolvedValue({
      id: quilttConnectionId,
      provider: "FINICITY",
      status: "SYNCED",
      institution: reported,
      accounts: [],
    });
    await quilttService.connectAndPerformInitialSync({
      userId: testUserId,
      quilttConnectionId,
      quilttProfileId: "profile_1",
    });
    const [conn] = await db
      .select({ registryId: accountConnections.institutionRegistryId })
      .from(accountConnections)
      .where(eq(accountConnections.quilttConnectionId, quilttConnectionId));
    return conn.registryId;
  }

  // Quiltt's names don't match our catalogs ("BMO", not "Bank of Montreal"),
  // so the row is keyed on Quiltt's own institution id instead.
  it("names a new connection after the institution Quiltt reports", async () => {
    const registryId = await connect(`conn_new_${suffix}`);

    const [row] = await db
      .select()
      .from(institutionRegistry)
      .where(eq(institutionRegistry.id, registryId!));
    expect(row).toMatchObject({
      providerCompositeKey: `quiltt_${institution.id}`,
      name: "BMO",
      logo: institution.logo.url,
      plaidData: null,
      mxData: null,
    });
  });

  /** The registry id of the row built from `institution`. */
  async function quilttRowId() {
    const [row] = await db
      .select({ id: institutionRegistry.id })
      .from(institutionRegistry)
      .where(
        eq(institutionRegistry.providerCompositeKey, `quiltt_${institution.id}`),
      );
    return row.id;
  }

  it("moves a reconnected connection onto the institution Quiltt reports", async () => {
    const quilttConnectionId = `conn_old_${suffix}`;
    await db.insert(accountConnections).values({
      userId: testUserId,
      provider: "quiltt",
      quilttConnectionId,
      institutionRegistryId: catalogRowId,
    });

    expect(await connect(quilttConnectionId)).toBe(await quilttRowId());
  });

  it("keeps the last known logo when Quiltt reports none", async () => {
    const quilttConnectionId = `conn_nologo_${suffix}`;
    await connect(quilttConnectionId);
    await connect(quilttConnectionId, { ...institution, logo: null });

    const [row] = await db
      .select({ logo: institutionRegistry.logo })
      .from(institutionRegistry)
      .where(
        eq(institutionRegistry.providerCompositeKey, `quiltt_${institution.id}`),
      );
    expect(row.logo).toBe(institution.logo.url);
  });

  it("keeps a connection's institution when Quiltt reports none", async () => {
    const quilttConnectionId = `conn_kept_${suffix}`;
    await db.insert(accountConnections).values({
      userId: testUserId,
      provider: "quiltt",
      quilttConnectionId,
      institutionRegistryId: catalogRowId,
    });

    expect(await connect(quilttConnectionId, null)).toBe(catalogRowId);
  });

  // A failed name match used to leave these showing "Unknown".
  it("names a reconnected connection that had no institution", async () => {
    const quilttConnectionId = `conn_unnamed_${suffix}`;
    await db.insert(accountConnections).values({
      userId: testUserId,
      provider: "quiltt",
      quilttConnectionId,
    });

    expect(await connect(quilttConnectionId)).toBe(await quilttRowId());
  });
});
