import {
  pgTable,
  serial,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import type { NotificationMetadata } from "@openfinance/shared";
import { user } from "./auth.sql";

// ==================== Metadata Types ====================

// The API returns metadata as stored, so the shared contract is its type.
export type {
  AccountDisconnectedMetadata,
  TransactionSyncMetadata,
  NotificationMetadata,
} from "@openfinance/shared";

// ==================== Table ====================

export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    title: text("title").notNull(),
    metadata: jsonb("metadata").notNull().$type<NotificationMetadata>(),
    sentAt: timestamp("sent_at").notNull().defaultNow(),
    readAt: timestamp("read_at"),
  },
  (table) => ({
    dedupIdx: index("idx_notifications_dedup").on(table.userId, table.sentAt),
  }),
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
