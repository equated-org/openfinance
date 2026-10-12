import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { mcp } from "better-auth/plugins";
import { db } from "./db.js";
import * as schema from "./schema.js";
import { createApiKeyForUser } from "./lib/api-key.service.js";
import { appUrl, serverUrl } from "./lib/origins.js";

export const auth = betterAuth({
  baseURL: serverUrl,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await createApiKeyForUser(user.id);
        },
      },
    },
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
  },
  plugins: [
    // OAuth 2.1 server for the hosted MCP endpoint, so connectors such as
    // Claude and ChatGPT sign in with just the URL. Access tokens last an hour
    // and are refreshed silently; each refresh starts a new 90-day window, so
    // a connector in use never has to sign in again.
    mcp({
      loginPage: `${appUrl}/login`,
      resource: `${serverUrl}/mcp`,
      oidcConfig: {
        loginPage: `${appUrl}/login`,
        // routes/auth.ts sends every authorize request through this page.
        consentPage: `${appUrl}/oauth/consent`,
        requirePKCE: true,
        accessTokenExpiresIn: 60 * 60,
        refreshTokenExpiresIn: 60 * 60 * 24 * 90,
      },
    }),
  ],
  trustedOrigins: [serverUrl, appUrl],
});
