import {
  pgTable,
  serial,
  text,
  timestamp,
  json,
  boolean,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Registry of institutions from every provider. Plaid and MX rows mirror their
 * catalogs and are what the picker searches. Quiltt rows are written when a
 * connection is made, from the institution Quiltt reports, so connections can
 * be named; they're never offered in search.
 */
export const institutionRegistry = pgTable(
  "institution_registry",
  {
    id: serial("id").primaryKey(),

    // Core institution data
    name: text("name").notNull(),
    logo: text("logo"),
    primaryColor: text("primary_color"),
    url: text("url"),
    countryCode: text("country_code").notNull(),

    // Composite key for upserts: "plaid_{institutionId}", "mx_{institutionCode}"
    // or "quiltt_{institutionId}"
    providerCompositeKey: text("provider_composite_key").unique(),

    // Provider-specific data stored as JSON
    plaidData: json("plaid_data").$type<{
      institutionId: string;
      countryCodes: string[];
      oauth: boolean;
      products: string[];
      routingNumbers: string[];

      // Connection health data (only for top institutions)
      connectionHealth?: {
        item_logins?: {
          status: "HEALTHY" | "DEGRADED" | "DOWN";
          last_status_change: string;
          breakdown: {
            success: number;
            error_institution: number;
            error_plaid: number;
          };
        };
        transactions_updates?: {
          status: "HEALTHY" | "DEGRADED" | "DOWN";
          last_status_change: string;
          breakdown: {
            success: number;
            error_institution: number;
            error_plaid: number;
            refresh_interval?: "NORMAL" | "DELAYED";
          };
        };
        lastUpdated: string;
      };
    } | null>(),

    mxData: json("mx_data").$type<{
      institutionCode: string;
      name: string;
      url?: string | null;
      smallLogoUrl?: string | null;
      mediumLogoUrl?: string | null;
      supportsAccountIdentification?: boolean;
      supportsTransactionHistory?: boolean;
      supportsAccountStatement?: boolean;
      supportsAccountVerification?: boolean;
      logo?: string | null;
    } | null>(),

    // Supported account types - standardized to Plaid's three-type system
    supportedAccountTypes: json("supported_account_types").$type<
      AccountType[] | null
    >(),

    // Metadata
    isTopInstitution: boolean("is_top_institution").default(false).notNull(),
    countryRank: integer("country_rank"),
    lastSynced: timestamp("last_synced", { mode: "date" }).notNull(),

    // Timestamps
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    nameIdx: index("institution_registry_name_idx").on(table.name),
    countryCodeIdx: index("institution_registry_country_code_idx").on(
      table.countryCode,
    ),
    lastSyncedIdx: index("institution_registry_last_synced_idx").on(
      table.lastSynced,
    ),
  }),
);

/**
 * The row's logo when it's an image URL, as on Quiltt rows, which have no
 * homepage for logo.dev. Plaid's logos are base64 and stay out of account
 * payloads.
 */
export const institutionLogoUrl = sql<string | null>`case when ${institutionRegistry.logo} like 'https://%' then ${institutionRegistry.logo} end`;

export type InstitutionRegistry = typeof institutionRegistry.$inferSelect;
export type NewInstitutionRegistry = typeof institutionRegistry.$inferInsert;

/**
 * Standardized account types matching Plaid's account type system
 * Used across all providers for consistency
 */
export type AccountType = "credit" | "depository" | "investment" | "loan";

/**
 * All possible account types supported by institutions
 */
export const ALL_ACCOUNT_TYPES: AccountType[] = [
  "credit",
  "depository",
  "investment",
  "loan",
];
