import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db", () => ({ db: {} }));
vi.mock("@dbos-inc/dbos-sdk", () => ({ DBOS: {} }));
vi.mock("../../workflows/mx-transaction-sync.workflow", () => ({
  MxTransactionSyncWorkflow: {},
}));

const { mxService } = await import("./mx.service");

function respondWith(status: number) {
  const body = status === 204 ? null : JSON.stringify({ error: "nope" });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status })));
}

describe("MXService.deleteMember", () => {
  beforeEach(() => {
    vi.stubEnv("MX_CLIENT_ID", "client");
    vi.stubEnv("MX_API_KEY", "key");
    vi.stubEnv("MX_API_URL", "https://mx.test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("confirms MX's empty 204", async () => {
    respondWith(204);

    await expect(mxService.deleteMember("USR", "MBR")).resolves.toBe(true);
  });

  it("counts a member that's already gone as deleted", async () => {
    respondWith(404);

    await expect(mxService.deleteMember("USR", "MBR")).resolves.toBe(true);
  });

  it("reports any other failure", async () => {
    respondWith(500);

    await expect(mxService.deleteMember("USR", "MBR")).resolves.toBe(false);
  });
});
