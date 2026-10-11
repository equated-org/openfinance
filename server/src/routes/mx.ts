import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { mxService } from "$lib/sync/mx.service";
import { requireSession, type AuthEnv } from "$lib/middleware";
import { billingService } from "$lib/billing";
import { db } from "../db";
import { accountConnections, user as userTable } from "../schema";
import { eq } from "drizzle-orm";

const connectMemberSchema = z.object({
  member_guid: z.string(),
  user_guid: z.string(),
  institution_code: z.string().optional(),
});

const createWidgetUrlSchema = z.object({
  institution_code: z.string().optional(),
});

const createWidgetUrlForUpdateSchema = z.object({
  account_id: z.number(),
});

const mxRoutes = new Hono<AuthEnv>();

mxRoutes.use("*", requireSession);

// POST /api/mx/create_widget_url
mxRoutes.post(
  "/create_widget_url",
  zValidator("json", createWidgetUrlSchema),
  async (c) => {
    const authUser = c.get("user");
    const { institution_code } = c.req.valid("json");

    // Check if user has mxUserGuid, create MX user if not
    const [dbUser] = await db
      .select({ id: userTable.id, mxUserGuid: userTable.mxUserGuid })
      .from(userTable)
      .where(eq(userTable.id, authUser.id))
      .limit(1);

    let userGuid = dbUser?.mxUserGuid;

    if (!userGuid) {
      const mxUser = await mxService.createUser({ userId: authUser.id });
      userGuid = mxUser.guid;

      await db
        .update(userTable)
        .set({ mxUserGuid: userGuid, updatedAt: new Date() })
        .where(eq(userTable.id, authUser.id));
    }

    const result = await mxService.requestWidgetUrl({
      userGuid,
      institutionCode: institution_code,
    });

    return c.json({ widget_url: result.widget_url, user_guid: userGuid });
  },
);

// POST /api/mx/connect_member
mxRoutes.post(
  "/connect_member",
  zValidator("json", connectMemberSchema),
  async (c) => {
    const authUser = c.get("user");
    const { member_guid, user_guid, institution_code } = c.req.valid("json");

    // Check if this is a reconnection (existing connection with same member_guid)
    const [existingConn] = await db
      .select({ id: accountConnections.id })
      .from(accountConnections)
      .where(eq(accountConnections.mxMemberGuid, member_guid))
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

    await mxService.connectAndPerformInitialSync({
      userId: authUser.id,
      userGuid: user_guid,
      memberGuid: member_guid,
      institutionCode: institution_code ?? undefined,
    });

    return c.json({ message: "MX account connected successfully" });
  },
);

// POST /api/mx/create_widget_url_for_update
mxRoutes.post(
  "/create_widget_url_for_update",
  zValidator("json", createWidgetUrlForUpdateSchema),
  async (c) => {
    const authUser = c.get("user");
    const { account_id } = c.req.valid("json");

    // Find connection for this account
    const { financialAccounts: fa } = await import("../schema");
    const [account] = await db
      .select({
        connectionId: fa.accountConnectionId,
      })
      .from(fa)
      .where(eq(fa.id, account_id))
      .limit(1);

    if (!account) {
      return c.json({ error: "Account not found" }, 404);
    }

    const [conn] = await db
      .select()
      .from(accountConnections)
      .where(eq(accountConnections.id, account.connectionId))
      .limit(1);

    if (!conn || !conn.mxMemberGuid) {
      return c.json({ error: "MX connection not found" }, 404);
    }

    // Get user's MX guid
    const [dbUser] = await db
      .select({ mxUserGuid: userTable.mxUserGuid })
      .from(userTable)
      .where(eq(userTable.id, authUser.id))
      .limit(1);

    if (!dbUser?.mxUserGuid) {
      return c.json({ error: "MX user not found" }, 404);
    }

    const result = await mxService.requestWidgetUrl({
      userGuid: dbUser.mxUserGuid,
      currentMemberGuid: conn.mxMemberGuid,
    });

    return c.json({
      widget_url: result.widget_url,
      user_guid: dbUser.mxUserGuid,
      member_guid: conn.mxMemberGuid,
    });
  },
);

// GET /api/mx/member_status
mxRoutes.get("/member_status", async (c) => {
  const authUser = c.get("user");
  const memberGuid = c.req.query("member_guid");

  if (!memberGuid) {
    return c.json({ error: "member_guid query param required" }, 400);
  }

  // Get user's MX guid
  const [dbUser] = await db
    .select({ mxUserGuid: userTable.mxUserGuid })
    .from(userTable)
    .where(eq(userTable.id, authUser.id))
    .limit(1);

  if (!dbUser?.mxUserGuid) {
    return c.json({ error: "MX user not found" }, 404);
  }

  const member = await mxService.getMemberStatus(dbUser.mxUserGuid, memberGuid);

  return c.json({
    connection_status: member.connection_status,
    is_being_aggregated: member.is_being_aggregated,
    successfully_aggregated_at: member.successfully_aggregated_at ?? null,
  });
});

export default mxRoutes;
