import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { quilttService } from "$lib/sync/quiltt.service";
import { requireSession, type AuthEnv } from "$lib/middleware";
import { billingService } from "$lib/billing";
import { db } from "../db";
import { accountConnections, user as userTable } from "../schema";
import { eq } from "drizzle-orm";

const callbackSchema = z.object({
  connectionId: z.string(),
  profileId: z.string(),
});

const quilttRoutes = new Hono<AuthEnv>();

quilttRoutes.use("*", requireSession);

// POST /api/quiltt/session - Create a Quiltt session token
quilttRoutes.post("/session", async (c) => {
  const authUser = c.get("user");

  // Check if user already has a Quiltt profile ID
  const [dbUser] = await db
    .select({
      id: userTable.id,
      quilttProfileId: userTable.quilttProfileId,
    })
    .from(userTable)
    .where(eq(userTable.id, authUser.id))
    .limit(1);

  let profileId = dbUser?.quilttProfileId;

  // Create or reuse Quiltt session
  const sessionData = await quilttService.createSession(profileId ?? undefined);

  // Store profileId if this is a new profile
  if (!profileId && sessionData.userId) {
    await db
      .update(userTable)
      .set({ quilttProfileId: sessionData.userId, updatedAt: new Date() })
      .where(eq(userTable.id, authUser.id));
  }

  return c.json({
    token: sessionData.token,
    profileId: sessionData.userId,
    connectorId: process.env.QUILTT_CONNECTOR_ID ?? "",
    expiresAt: sessionData.expiresAt,
  });
});

// POST /api/quiltt/callback - Handle Quiltt connection callback
quilttRoutes.post(
  "/callback",
  zValidator("json", callbackSchema),
  async (c) => {
    const authUser = c.get("user");
    const { connectionId, profileId } = c.req.valid("json");

    // Check if this is a reconnection (existing connection)
    const [existingConn] = await db
      .select({ id: accountConnections.id })
      .from(accountConnections)
      .where(eq(accountConnections.quilttConnectionId, connectionId))
      .limit(1);

    if (!existingConn) {
      // Only check billing for NEW connections
      const connectCheck = await billingService.checkCanConnect(authUser.id);
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

    // Update user's quilttProfileId if not set
    const [dbUser] = await db
      .select({ quilttProfileId: userTable.quilttProfileId })
      .from(userTable)
      .where(eq(userTable.id, authUser.id))
      .limit(1);

    if (!dbUser?.quilttProfileId) {
      await db
        .update(userTable)
        .set({ quilttProfileId: profileId, updatedAt: new Date() })
        .where(eq(userTable.id, authUser.id));
    }

    await quilttService.connectAndPerformInitialSync({
      userId: authUser.id,
      quilttConnectionId: connectionId,
      quilttProfileId: profileId,
    });

    return c.json({ message: "Quiltt account connected successfully" });
  },
);

export default quilttRoutes;
