import {
  pgTable,
  serial,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { user } from "./auth.sql";

// ==================== Metadata Types ====================

export type AccountDisconnectedMetadata = {
  type: "account_disconnected";
  connectionId: number;
  institutionName: string;
  institutionUrl: string | null;
  /** Missing on notifications stored before it was recorded. */
  institutionLogoUrl?: string | null;
  errorMessage?: string;
};

export type TransactionSyncMetadata = {
  type: "transaction_sync";
  connectionId: number;
  institutionName: string;
  institutionUrl: string | null;
  /** Missing on notifications stored before it was recorded. */
  institutionLogoUrl?: string | null;
  added: number;
  modified: number;
  removed: number;
};

export type NotificationMetadata =
  | AccountDisconnectedMetadata
  | TransactionSyncMetadata;

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
