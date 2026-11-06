import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { InstitutionSyncWorkflow } from "./institution-sync.workflow";

const mockPlaidSyncer = {
  refreshInstitutions: vi.fn(),
  updateConnectionHealthStatus: vi.fn(),
};

const mockMxSyncer = {
  refreshInstitutions: vi.fn(),
};

vi.mock("$lib/sync/plaid-institution-syncer.js", () => ({
  PlaidInstitutionSyncer: vi.fn(function () {
    return mockPlaidSyncer;
  }),
}));

vi.mock("$lib/sync/mx-institution-syncer.js", () => ({
  MXInstitutionSyncer: vi.fn(function () {
    return mockMxSyncer;
  }),
}));

vi.mock("$lib/sync/mx.client.js", () => ({
  isMxConfigured: () => true,
}));

describe("InstitutionSyncWorkflow", () => {
  beforeAll(async () => {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) throw new Error("DATABASE_URL is not set");

    DBOS.setConfig({
      name: "institution-sync-test",
      systemDatabaseUrl: dbUrl,
    });
    await DBOS.launch();
  });

  afterAll(async () => {
    await DBOS.shutdown();
  });

  it("should call all steps on success", async () => {
    mockPlaidSyncer.refreshInstitutions.mockResolvedValue(undefined);
    mockMxSyncer.refreshInstitutions.mockResolvedValue(undefined);
    mockPlaidSyncer.updateConnectionHealthStatus.mockResolvedValue(undefined);

    const handle = await DBOS.startWorkflow(
      InstitutionSyncWorkflow,
    ).syncInstitutionsWorkflow();

    const result = await handle.getResult();

    expect(result.success).toBe(true);
    expect(result.providersRefreshed).toEqual(["plaid", "mx"]);
    expect(result.healthStatusUpdated).toBe(true);
    expect(result.errors).toBeUndefined();
    expect(mockPlaidSyncer.refreshInstitutions).toHaveBeenCalledOnce();
    expect(mockMxSyncer.refreshInstitutions).toHaveBeenCalledOnce();
    expect(mockPlaidSyncer.updateConnectionHealthStatus).toHaveBeenCalledOnce();
  });

  it("should handle partial failure gracefully", async () => {
    mockPlaidSyncer.refreshInstitutions.mockRejectedValue(
      new Error("Plaid API error"),
    );
    mockMxSyncer.refreshInstitutions.mockResolvedValue(undefined);
    mockPlaidSyncer.updateConnectionHealthStatus.mockResolvedValue(undefined);

    const handle = await DBOS.startWorkflow(
      InstitutionSyncWorkflow,
    ).syncInstitutionsWorkflow();

    const result = await handle.getResult();

    expect(result.success).toBe(false);
    expect(result.providersRefreshed).toEqual(["mx"]);
    expect(result.healthStatusUpdated).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.errors![0]).toContain("Plaid");
  });

  it("should handle all steps failing", async () => {
    mockPlaidSyncer.refreshInstitutions.mockRejectedValue(
      new Error("Plaid API error"),
    );
    mockMxSyncer.refreshInstitutions.mockRejectedValue(
      new Error("MX API error"),
    );
    mockPlaidSyncer.updateConnectionHealthStatus.mockRejectedValue(
      new Error("Health check error"),
    );

    const handle = await DBOS.startWorkflow(
      InstitutionSyncWorkflow,
    ).syncInstitutionsWorkflow();

    const result = await handle.getResult();

    expect(result.success).toBe(false);
    expect(result.providersRefreshed).toEqual([]);
    expect(result.healthStatusUpdated).toBe(false);
    expect(result.errors).toHaveLength(3);
  });
});
