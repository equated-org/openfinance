import { randomUUID } from "crypto";
import crypto from "node:crypto";
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { user, apiKeys } from "../schema";
import type { AuthEnv } from "./middleware";

// Control session auth deterministically; the API-key path uses the real db.
const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock("../auth.js", () => ({
  auth: { api: { getSession } },
}));

// Import after the mock so middleware picks up the mocked auth module.
const { requireAuth, requireSession } = await import("./middleware");

const testUserId = `test-mw-${randomUUID().slice(0, 8)}`;
const plaintextKey = `sk-${randomUUID()}`;
const keyHash = crypto.createHash("sha256").update(plaintextKey).digest("hex");

const app = new Hono<AuthEnv>();
app.get("/read", requireAuth, (c) =>
  c.json({ userId: c.get("user").id, authMethod: c.get("authMethod") }),
);
app.get("/write", requireSession, (c) =>
  c.json({ userId: c.get("user").id, authMethod: c.get("authMethod") }),
);

describe("auth middleware (API keys are read-only)", () => {
  beforeAll(async () => {
    await db.insert(user).values({
      id: testUserId,
      name: "MW User",
      email: `${testUserId}@test.com`,
      emailVerified: false,
    });
    await db.insert(apiKeys).values({
      userId: testUserId,
      keyHash,
      key: plaintextKey,
      prefix: plaintextKey.slice(0, 8),
    });
  });

  afterAll(async () => {
    await db.delete(apiKeys).where(eq(apiKeys.userId, testUserId));
    await db.delete(user).where(eq(user.id, testUserId));
  });

  beforeEach(() => {
    getSession.mockReset();
  });

  it("requireAuth accepts a valid API key (read access)", async () => {
    const res = await app.request("/read", {
      headers: { Authorization: `Bearer ${plaintextKey}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: testUserId,
      authMethod: "apiKey",
    });
    expect(getSession).not.toHaveBeenCalled();
  });

  it("requireAuth rejects an unknown API key with 401", async () => {
    const res = await app.request("/read", {
      headers: { Authorization: "Bearer sk-not-a-real-key" },
    });
    expect(res.status).toBe(401);
  });

  it("requireSession rejects an API key with 403", async () => {
    const res = await app.request("/write", {
      headers: { Authorization: `Bearer ${plaintextKey}` },
    });
    expect(res.status).toBe(403);
    // The key is never even looked up — rejected on the header alone.
    expect(getSession).not.toHaveBeenCalled();
  });

  it("requireSession allows a logged-in session", async () => {
    getSession.mockResolvedValue({
      user: {
        id: testUserId,
        name: "MW User",
        email: `${testUserId}@test.com`,
      },
    });
    const res = await app.request("/write");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: testUserId,
      authMethod: "session",
    });
  });

  it("requireSession returns 401 without a session", async () => {
    getSession.mockResolvedValue(null);
    const res = await app.request("/write");
    expect(res.status).toBe(401);
  });

  it("requireAuth falls back to session cookies when no API key is present", async () => {
    getSession.mockResolvedValue({
      user: {
        id: testUserId,
        name: "MW User",
        email: `${testUserId}@test.com`,
      },
    });
    const res = await app.request("/read");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      userId: testUserId,
      authMethod: "session",
    });
  });
});
