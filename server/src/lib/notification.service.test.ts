import { randomUUID } from "crypto";
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { user, notifications } from "../schema";

vi.mock("./emails/resend.client", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

const { notificationService } = await import("./notification.service");
const { sendEmail } = await import("./emails/resend.client");

describe("notificationService.sendAccountDisconnectEmail", () => {
  const userId = `test-notify-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    await db.insert(user).values({
      id: userId,
      name: "Test User",
      email: `${userId}@test.com`,
      emailVerified: false,
    });
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await db.delete(notifications).where(eq(notifications.userId, userId));
  });

  afterAll(async () => {
    await db.delete(notifications).where(eq(notifications.userId, userId));
    await db.delete(user).where(eq(user.id, userId));
  });

  // Polling stops after a login error, so this email is sent once. When a sync
  // notice from earlier that day suppressed it, the user was never told.
  it("isn't suppressed by a routine sync notice", async () => {
    await notificationService.logTransactionSync({
      userId,
      connectionId: 1,
      added: 3,
      modified: 0,
      removed: 0,
    });

    await notificationService.sendAccountDisconnectEmail({
      userId,
      connectionId: 1,
    });

    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it("sends at most one a week for a connection", async () => {
    for (let i = 0; i < 2; i++) {
      await notificationService.sendAccountDisconnectEmail({
        userId,
        connectionId: 1,
      });
    }

    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it("sends again once a week has passed", async () => {
    await db.insert(notifications).values({
      userId,
      channel: "email",
      title: "Earlier",
      sentAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      metadata: {
        type: "account_disconnected",
        connectionId: 1,
        institutionName: "Test Bank",
        institutionUrl: null,
      },
    });

    await notificationService.sendAccountDisconnectEmail({
      userId,
      connectionId: 1,
    });

    expect(sendEmail).toHaveBeenCalledOnce();
  });

  it("tracks each connection separately", async () => {
    for (const connectionId of [1, 2]) {
      await notificationService.sendAccountDisconnectEmail({
        userId,
        connectionId,
      });
    }

    expect(sendEmail).toHaveBeenCalledTimes(2);
  });
});
