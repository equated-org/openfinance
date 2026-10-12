import { pgTable, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { user } from "./auth.sql";

/**
 * OAuth tables behind the hosted MCP endpoint's sign-in, owned by better-auth's
 * mcp() plugin: dynamic client registration, the authorization code + PKCE
 * grant, and refresh tokens. We never write them directly. They live here so
 * the Drizzle adapter can find the plugin's models and drizzle-kit can generate
 * migrations, so the export names must stay better-auth's model names.
 * better-auth sets every value itself, so the columns carry no NOT NULL or
 * defaults beyond what its schema declares.
 */
export const oauthApplication = pgTable(
  "oauth_application",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    icon: text("icon"),
    metadata: text("metadata"),
    clientId: text("client_id").unique(),
    clientSecret: text("client_secret"),
    redirectUrls: text("redirect_urls"),
    type: text("type"),
    disabled: boolean("disabled").default(false),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => ({
    userIdIdx: index("idx_oauth_application_user_id").on(table.userId),
  }),
);

export const oauthAccessToken = pgTable(
  "oauth_access_token",
  {
    id: text("id").primaryKey(),
    accessToken: text("access_token").unique(),
    refreshToken: text("refresh_token").unique(),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    clientId: text("client_id").references(() => oauthApplication.clientId, {
      onDelete: "cascade",
    }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    scopes: text("scopes"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => ({
    clientIdIdx: index("idx_oauth_access_token_client_id").on(table.clientId),
    userIdIdx: index("idx_oauth_access_token_user_id").on(table.userId),
  }),
);

export const oauthConsent = pgTable(
  "oauth_consent",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").references(() => oauthApplication.clientId, {
      onDelete: "cascade",
    }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    scopes: text("scopes"),
    consentGiven: boolean("consent_given"),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => ({
    clientIdIdx: index("idx_oauth_consent_client_id").on(table.clientId),
    userIdIdx: index("idx_oauth_consent_user_id").on(table.userId),
  }),
);

export type OauthApplication = typeof oauthApplication.$inferSelect;
export type OauthAccessToken = typeof oauthAccessToken.$inferSelect;
export type OauthConsent = typeof oauthConsent.$inferSelect;
