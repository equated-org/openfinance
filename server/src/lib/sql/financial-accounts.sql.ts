import {
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  numeric,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { user } from "./auth.sql";
import { accountConnections } from "./account-connections.sql";

export const financialAccountStatusEnum = pgEnum("financial_account_status", [
  "active",
  "deleted",
  "hidden",
]);

export const financialAccounts = pgTable(
  "financial_accounts",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accountConnectionId: integer("account_connection_id")
      .notNull()
      .references(() => accountConnections.id, { onDelete: "cascade" }),
    providerAccountId: text("provider_account_id").notNull(),

    name: text("name").notNull(),
    officialName: text("official_name"),
    type: text("type").notNull(),
    subtype: text("subtype"),
    mask: text("mask"),
    currentBalance: numeric("current_balance", { precision: 19, scale: 4 }),
    availableBalance: numeric("available_balance", { precision: 19, scale: 4 }),
    isoCurrencyCode: text("iso_currency_code"),

    status: financialAccountStatusEnum("status").notNull().default("active"),
    lastSyncedAt: timestamp("last_synced_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => ({
    userIdIdx: index("idx_financial_accounts_user_id").on(table.userId),
    providerAccountUnique: unique(
      "uq_financial_accounts_connection_provider_account",
    ).on(table.accountConnectionId, table.providerAccountId),
  }),
);

export type FinancialAccount = typeof financialAccounts.$inferSelect;
export type NewFinancialAccount = typeof financialAccounts.$inferInsert;

/**
 * Standardized account types matching Plaid's account type system
 * Used across all providers for consistency
 */
export type AccountType = "credit" | "depository" | "investment" | "loan";
