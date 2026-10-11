import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { Products } from "plaid";
import { plaidClient, PLAID_COUNTRY_CODES } from "$lib/sync/plaid.client";
import { plaidService } from "$lib/sync/plaid.service";
import { requireAuth, type AuthEnv } from "$lib/middleware";
import { billingService } from "$lib/billing";
import { db } from "../db";
import { financialAccounts, accountConnections } from "../schema";
import { eq, and } from "drizzle-orm";

const exchangeTokenSchema = z.object({
  public_token: z.string(),
  institution_id: z.string().optional(),
});

const plaidRoutes = new Hono<AuthEnv>();

plaidRoutes.use("*", requireAuth);

// POST /api/plaid/create_link_token
plaidRoutes.post("/create_link_token", async (c) => {
  const user = c.get("user");

  const response = await plaidClient.linkTokenCreate({
    user: { client_user_id: user.id },
    client_name: "Open Finance",
    products: [Products.Transactions],
    transactions: { days_requested: 730 },
    country_codes: PLAID_COUNTRY_CODES,
    language: "en",
  });

  return c.json({ link_token: response.data.link_token });
});

// POST /api/plaid/create_link_token_for_update
plaidRoutes.post(
  "/create_link_token_for_update",
  zValidator("json", z.object({ account_id: z.number() })),
  async (c) => {
    const user = c.get("user");
    const { account_id } = c.req.valid("json");

    // Look up the account's connection to get the access token
    const [result] = await db
      .select({
        plaidAccessToken: accountConnections.plaidAccessToken,
      })
      .from(financialAccounts)
      .innerJoin(
        accountConnections,
        eq(financialAccounts.accountConnectionId, accountConnections.id),
      )
      .where(
        and(
          eq(financialAccounts.id, account_id),
          eq(financialAccounts.userId, user.id),
          eq(accountConnections.provider, "plaid"),
        ),
      )
      .limit(1);

    if (!result?.plaidAccessToken) {
      return c.json({ error: "Plaid account not found" }, 404);
    }

    const linkToken = await plaidService.createUpdateLinkToken(
      user.id,
      result.plaidAccessToken,
    );

    return c.json({ link_token: linkToken });
  },
);

// POST /api/plaid/exchange_public_token
plaidRoutes.post(
  "/exchange_public_token",
  zValidator("json", exchangeTokenSchema),
  async (c) => {
    const user = c.get("user");
    const { public_token, institution_id } = c.req.valid("json");

    // Exchange public token for access token
    const { accessToken, itemId } =
      await plaidService.exchangePublicToken(public_token);

    // If this item already exists, it's a reauth — skip billing check
    const [existing] = await db
      .select({ id: accountConnections.id })
      .from(accountConnections)
      .where(eq(accountConnections.plaidItemId, itemId))
      .limit(1);

    if (!existing) {
      // New connection: check billing limits
      const connectCheck = await billingService.checkCanConnect(user.id);
      if (!connectCheck.allowed) {
        return c.json(
          {
            error: "upgrade_required",
            requiredPlan: connectCheck.requiredPlan,
          },
          402,
        );
      }
    }

    // Get institution info and registry ID
    let registryId: number | null = null;
    if (institution_id) {
      try {
        await plaidService.getInstitutionInfo(institution_id);
      } catch {
        // ignore - use defaults
      }
      registryId = await plaidService.findRegistryId(institution_id);
    }

    await plaidService.connectAndPerformInitialSync({
      userId: user.id,
      institutionRegistryId: registryId,
      plaidItemId: itemId,
      plaidAccessToken: accessToken,
    });

    return c.json({ message: "Account connected successfully" });
  },
);

export default plaidRoutes;
