/**
 * Tests for storing institution health from Plaid, on a real database.
 *
 * The first version of this job never stored anything, for reasons a mocked
 * database can't show: a Date in a raw `sql` template crashed it on every run,
 * and with that fixed its filter would have matched nothing, because it asked
 * for rows not updated in a day straight after the catalog refresh updated them
 * all.
 */
import { randomUUID } from "crypto";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { institutionRegistry } from "../../schema";
import { sleep } from "$lib/utils";
import {
  getConnectionHealth,
  PlaidInstitutionSyncer,
} from "./plaid-institution-syncer.js";

const plaid = vi.hoisted(() => ({ institutionsGetById: vi.fn() }));

vi.mock("$lib/sync/plaid.client.js", () => ({
  plaidClient: plaid,
  PLAID_COUNTRY_CODES: ["US", "CA"],
}));
vi.mock("$lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("$lib/utils")>()),
  sleep: vi.fn(),
}));

/** Wealthsimple's status as Plaid returned it on 2026-11-06. */
const status = {
  item_logins: {
    status: "DEGRADED",
    last_status_change: "2026-11-05T23:40:18Z",
    breakdown: { success: 0.663, error_plaid: 0.337, error_institution: 0 },
  },
  transactions_updates: {
    status: "DEGRADED",
    last_status_change: "2026-11-06T07:25:22Z",
    breakdown: {
      success: 0.989,
      error_plaid: 0.011,
      error_institution: 0,
      refresh_interval: "NORMAL",
    },
  },
  auth: {
    status: "HEALTHY",
    last_status_change: "2026-11-06T01:15:18Z",
    breakdown: { success: 1, error_plaid: 0, error_institution: 0 },
  },
};

describe("getConnectionHealth", () => {
  it("keeps Plaid's numbers for logins and transaction updates", () => {
    const health = getConnectionHealth({ status } as never);

    expect(health?.item_logins?.breakdown.success).toBe(0.663);
    expect(health?.transactions_updates?.breakdown.refresh_interval).toBe(
      "NORMAL",
    );
    expect(Number.isNaN(Date.parse(health!.lastUpdated))).toBe(false);
    expect(health).not.toHaveProperty("auth");
  });

  it.each([
    ["missing", {}],
    ["null", { status: null }],
    ["empty", { status: {} }],
  ])("returns undefined when the status is %s", (_label, institution) => {
    expect(getConnectionHealth(institution as never)).toBeUndefined();
  });
});

describe("PlaidInstitutionSyncer.updateConnectionHealthStatus", () => {
  const run = randomUUID().slice(0, 8);
  const ids = {
    reported: `ins_reported_${run}`,
    quiet: `ins_quiet_${run}`,
    failing: `ins_failing_${run}`,
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // As the catalog refresh leaves them: updated just now, with no health.
    await db.insert(institutionRegistry).values(
      Object.values(ids).map((institutionId) => ({
        name: institutionId,
        countryCode: "CA",
        providerCompositeKey: `plaid_${institutionId}`,
        lastSynced: new Date(),
        plaidData: {
          institutionId,
          countryCodes: ["CA"],
          oauth: false,
          products: ["transactions"],
          routingNumbers: [],
        },
      })),
    );

    plaid.institutionsGetById.mockImplementation(
      async ({ institution_id }: { institution_id: string }) => {
        if (institution_id === ids.failing) throw new Error("rate limited");
        return {
          data: {
            institution: {
              status: institution_id === ids.reported ? status : null,
            },
          },
        };
      },
    );
  });

  afterEach(async () => {
    for (const institutionId of Object.values(ids)) {
      await db
        .delete(institutionRegistry)
        .where(
          eq(institutionRegistry.providerCompositeKey, `plaid_${institutionId}`),
        );
    }
  });

  async function plaidData(institutionId: string) {
    const [row] = await db
      .select({ plaidData: institutionRegistry.plaidData })
      .from(institutionRegistry)
      .where(
        eq(institutionRegistry.providerCompositeKey, `plaid_${institutionId}`),
      );
    return row.plaidData;
  }

  it("stores health on rows the catalog refresh just updated", async () => {
    await new PlaidInstitutionSyncer().updateConnectionHealthStatus();

    expect(await plaidData(ids.reported)).toMatchObject({
      institutionId: ids.reported,
      products: ["transactions"],
      connectionHealth: {
        item_logins: { status: "DEGRADED" },
        transactions_updates: { status: "DEGRADED" },
      },
    });
  });

  it("asks for status in both countries the catalog covers", async () => {
    await new PlaidInstitutionSyncer().updateConnectionHealthStatus();

    expect(plaid.institutionsGetById).toHaveBeenCalledWith({
      institution_id: ids.reported,
      country_codes: ["US", "CA"],
      options: { include_status: true },
    });
  });

  it("leaves a bank alone when Plaid reports nothing for it", async () => {
    await new PlaidInstitutionSyncer().updateConnectionHealthStatus();

    expect(await plaidData(ids.quiet)).not.toHaveProperty("connectionHealth");
  });

  it("carries on past a failed lookup", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      new PlaidInstitutionSyncer().updateConnectionHealthStatus(),
    ).resolves.toBeUndefined();

    expect(await plaidData(ids.failing)).not.toHaveProperty("connectionHealth");
    expect(await plaidData(ids.reported)).toHaveProperty("connectionHealth");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("rate limited"));
    warn.mockRestore();
  });

  it("waits out a rate limit instead of losing the institution", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const limited = Object.assign(new Error("rate limit exceeded"), {
      errorCode: "INSTITUTIONS_GET_BY_ID_LIMIT",
    });
    plaid.institutionsGetById.mockRejectedValueOnce(limited);

    await new PlaidInstitutionSyncer().updateConnectionHealthStatus();

    expect(sleep).toHaveBeenCalledWith(60_000);
    expect(await plaidData(ids.reported)).toHaveProperty("connectionHealth");
    warn.mockRestore();
  });

  it("moves on if the rate limit outlasts the wait", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const limited = Object.assign(new Error("rate limit exceeded"), {
      errorCode: "INSTITUTIONS_GET_BY_ID_LIMIT",
    });
    plaid.institutionsGetById
      .mockRejectedValueOnce(limited)
      .mockRejectedValueOnce(limited);

    await expect(
      new PlaidInstitutionSyncer().updateConnectionHealthStatus(),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("rate limit exceeded"),
    );
    warn.mockRestore();
  });

  it("stops at the limit it's given", async () => {
    await new PlaidInstitutionSyncer().updateConnectionHealthStatus(1);

    expect(plaid.institutionsGetById).toHaveBeenCalledOnce();
  });

  it("stays under Plaid's 400 calls a minute", async () => {
    await new PlaidInstitutionSyncer().updateConnectionHealthStatus();

    const { calls } = vi.mocked(sleep).mock;
    expect(calls).toHaveLength(plaid.institutionsGetById.mock.calls.length);
    for (const [ms] of calls) expect(60_000 / ms).toBeLessThanOrEqual(400);
    expect(sleep).not.toHaveBeenCalledWith(60_000);
  });
});
