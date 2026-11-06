import { Hono } from "hono";
import { requireSession, type AuthEnv } from "../lib/middleware";
import { db } from "../db";
import {
  user as userTable,
  session,
  account,
  accountConnections,
} from "../schema";
import { eq } from "drizzle-orm";
import { billingService } from "$lib/billing";
import { financialAccountService } from "$lib/financial-account.service";

const meRoutes = new Hono<AuthEnv>();

meRoutes.use("*", requireSession);

// POST /api/me/dismiss-onboarding
meRoutes.post("/dismiss-onboarding", async (c) => {
  const user = c.get("user");

  await db
    .update(userTable)
    .set({ onboardingDismissedAt: new Date() })
    .where(eq(userTable.id, user.id));

  return c.json({ ok: true });
});

// DELETE /api/me/delete-account
meRoutes.delete("/delete-account", async (c) => {
  const user = c.get("user");

  // 1. Disconnect banks first. Their tokens are deleted with the rows below,
  // so a link that fails after that could never be retried.
  const connections = await db
    .select()
    .from(accountConnections)
    .where(eq(accountConnections.userId, user.id));

  for (const connection of connections) {
    if (!(await financialAccountService.unlinkConnection(connection))) {
      return c.json(
        {
          error:
            "We couldn't disconnect one of your banks, so your account wasn't deleted. Please try again.",
        },
        502,
      );
    }
  }

  // 2. Cancel Stripe subscription if active
  try {
    const plan = await billingService.getUserPlan(user.id);
    if (plan.stripeSubscriptionId) {
      await billingService.cancelSubscription(plan.stripeSubscriptionId);
    }
  } catch (err) {
    console.error(
      "Failed to cancel Stripe subscription, proceeding with deletion:",
      err,
    );
  }

  // 3. Delete auth tables (no cascade on user FK)
  await db.delete(session).where(eq(session.userId, user.id));
  await db.delete(account).where(eq(account.userId, user.id));

  // 4. Delete user (cascades to accountConnections, financialAccounts, apiKeys, notifications, syncJobs, transactions)
  await db.delete(userTable).where(eq(userTable.id, user.id));

  return c.json({ success: true });
});

export default meRoutes;
