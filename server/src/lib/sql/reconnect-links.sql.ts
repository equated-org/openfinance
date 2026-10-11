import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { user } from "./auth.sql";
import { financialAccounts } from "./financial-accounts.sql";
import { syncJobs } from "./sync-jobs.sql";

/**
 * Public links that let someone reconnect one account without signing in.
 * Only the token's hash is stored, so a database leak can't be replayed.
 */
export const reconnectLinks = pgTable(
  "reconnect_links",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    financialAccountId: integer("financial_account_id")
      .notNull()
      .references(() => financialAccounts.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    // Set when the provider flow succeeds. A used link can't open another
    // flow, but keeps reporting the sync it started until it expires.
    usedAt: timestamp("used_at"),
    syncJobId: integer("sync_job_id").references(() => syncJobs.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index("idx_reconnect_links_user_id").on(table.userId),
  }),
);

export type ReconnectLink = typeof reconnectLinks.$inferSelect;
export type NewReconnectLink = typeof reconnectLinks.$inferInsert;
