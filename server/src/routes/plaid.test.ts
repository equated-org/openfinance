import { randomUUID } from "crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";

const testUserId = `test-plaid-${randomUUID().slice(0, 8)}`;

vi.mock("../lib/middleware", () => ({
  requireSession: vi.fn((c: any, next: any) => {
    c.set("user", {
      id: testUserId,
      name: "Test User",
      email: `${testUserId}@test.com`,
    });
    return next();
  }),
}));

vi.mock("$lib/billing", () => ({
  billingService: { checkCanConnect: vi.fn() },
}));

vi.mock("$lib/sync/plaid.service", () => ({
  plaidService: {
    exchangePublicToken: vi.fn(),
    itemRemove: vi.fn().mockResolvedValue(true),
    connectAndPerformInitialSync: vi.fn(),
  },
}));

const { default: plaidRoutes } = await import("./plaid.js");
const { billingService } = await import("$lib/billing");
const { plaidService } = await import("$lib/sync/plaid.service");

const app = new Hono();
app.route("/api/plaid", plaidRoutes);

function post(path: string, body: unknown) {
  return app.request(`/api/plaid/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Plaid routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // By the time the limit is checked the Item exists at Plaid and bills
  // monthly, and dropping this token would leave nothing able to remove it.
  it("removes the Item when the plan has no room for it", async () => {
    vi.mocked(plaidService.exchangePublicToken).mockResolvedValue({
      accessToken: "access-new",
      itemId: `item-${randomUUID()}`,
    });
    vi.mocked(billingService.checkCanConnect).mockResolvedValue({
      allowed: false,
      requiredPlan: "plus",
      currentPlan: "free",
      connectionCount: 1,
      maxConnections: 1,
    });

    const response = await post("exchange_public_token", {
      public_token: "public-token",
    });

    expect(response.status).toBe(402);
    expect(plaidService.itemRemove).toHaveBeenCalledWith("access-new");
    expect(plaidService.connectAndPerformInitialSync).not.toHaveBeenCalled();
  });

  it("logs how a Link session ended, against the user", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await post("link_exit", {
      status: "requires_credentials",
      link_session_id: "session-1",
      error_code: "INTERNAL_SERVER_ERROR",
    });

    expect(response.status).toBe(200);
    const line = warn.mock.calls[0][0] as string;
    expect(line).toContain("Plaid Link exit");
    expect(line).toContain(testUserId);
    expect(line).toContain("session-1");
    warn.mockRestore();
  });
});
