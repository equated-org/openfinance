import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireSession, type AuthEnv } from "../lib/middleware";
import { db } from "../db.js";
import { notifications } from "../schema.js";
import { eq, and, desc, isNull, or, lt, sql } from "drizzle-orm";
import type { ApiNotification } from "@openfinance/shared";

const notificationRoutes = new Hono<AuthEnv>();

notificationRoutes.use("*", requireSession);

const querySchema = z.object({
  limit: z.coerce.number().int().positive().optional().default(30),
  cursor: z.string().optional(),
});

// GET /api/notifications
notificationRoutes.get("/", zValidator("query", querySchema), async (c) => {
  const user = c.get("user");
  const { limit, cursor } = c.req.valid("query");

  try {
    const fetchLimit = limit + 1;

    const conditions = [eq(notifications.userId, user.id)];

    if (cursor) {
      const separatorIdx = cursor.lastIndexOf(":");
      const cursorDate = cursor.slice(0, separatorIdx);
      const cursorId = parseInt(cursor.slice(separatorIdx + 1), 10);

      conditions.push(
        or(
          lt(notifications.sentAt, new Date(cursorDate)),
          and(
            eq(notifications.sentAt, new Date(cursorDate)),
            lt(notifications.id, cursorId),
          ),
        )!,
      );
    }

    const rows = await db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.sentAt), desc(notifications.id))
      .limit(fetchLimit);

    const items: ApiNotification[] = rows.map((r) => ({
      id: r.id,
      channel: r.channel,
      title: r.title,
      metadata: r.metadata,
      sentAt: r.sentAt.toISOString(),
      readAt: r.readAt?.toISOString() ?? null,
    }));

    if (items.length > limit) {
      items.pop();
    }

    return c.json({ notifications: items });
  } catch (error) {
    console.error("Error fetching notifications", error);
    return c.json({ error: "Failed to fetch notifications" }, 500);
  }
});

// GET /api/notifications/unread-count
notificationRoutes.get("/unread-count", async (c) => {
  const user = c.get("user");

  try {
    const [result] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(eq(notifications.userId, user.id), isNull(notifications.readAt)),
      );

    return c.json({ unreadCount: result?.count ?? 0 });
  } catch (error) {
    console.error("Error fetching unread count", error);
    return c.json({ error: "Failed to fetch unread count" }, 500);
  }
});

// POST /api/notifications/mark-read
notificationRoutes.post("/mark-read", async (c) => {
  const user = c.get("user");

  try {
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(eq(notifications.userId, user.id), isNull(notifications.readAt)),
      );

    return c.json({ ok: true });
  } catch (error) {
    console.error("Error marking notifications read", error);
    return c.json({ error: "Failed to mark notifications read" }, 500);
  }
});

export default notificationRoutes;
