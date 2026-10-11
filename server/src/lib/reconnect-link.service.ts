import crypto from "node:crypto";
import { and, eq, isNull, lt } from "drizzle-orm";
import type {
  CreatedReconnectLink,
  ReconnectLinkState,
  ReconnectLinkStatus,
  ReconnectSession,
} from "@openfinance/shared";
import { db } from "../db";
import {
  accountConnections,
  financialAccounts,
  institutionRegistry,
  reconnectLinks,
  syncJobs,
  user as userTable,
  type AccountConnection,
  type ReconnectLink,
} from "../schema";
import { plaidService } from "./sync/plaid.service";
import { quilttService } from "./sync/quiltt.service";
import { needsUserAction } from "./sync/disconnect-codes";

export const RECONNECT_LINK_TTL_MS = 24 * 60 * 60 * 1000;

// Tokens are 32 random bytes in base64url. Anything else can't match a link,
// so it's rejected before touching the database.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// Shown when the reconnect worked but the sync after it hit a transient error
// (a bank still sending data, a timeout). The scheduled poll retries it.
const CATCHING_UP_MESSAGE =
  "Your bank is still sending data. New transactions will show up on their own.";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/** The provider flow a link runs, with the ids it needs. */
type ReconnectTarget =
  | { provider: "plaid"; itemId: string; accessToken: string }
  | { provider: "quiltt"; connectionId: string };

function reconnectTarget(connection: AccountConnection): ReconnectTarget | null {
  if (
    connection.provider === "plaid" &&
    connection.plaidItemId &&
    connection.plaidAccessToken
  ) {
    return {
      provider: "plaid",
      itemId: connection.plaidItemId,
      accessToken: connection.plaidAccessToken,
    };
  }
  if (connection.provider === "quiltt" && connection.quilttConnectionId) {
    return { provider: "quiltt", connectionId: connection.quilttConnectionId };
  }
  return null;
}

/** A link with the account and connection it reconnects. */
export interface ResolvedReconnectLink {
  link: ReconnectLink;
  connection: AccountConnection;
  target: ReconnectTarget;
  accountName: string;
  accountMask: string | null;
  institutionName: string;
  institutionUrl: string | null;
}

class ReconnectLinkService {
  async create(
    userId: string,
    accountId: number,
  ): Promise<
    | { ok: true; link: CreatedReconnectLink }
    | { ok: false; error: "not_found" | "unsupported_provider" }
  > {
    const [row] = await db
      .select({
        connection: accountConnections,
        institutionName: institutionRegistry.name,
      })
      .from(financialAccounts)
      .innerJoin(
        accountConnections,
        eq(financialAccounts.accountConnectionId, accountConnections.id),
      )
      .leftJoin(
        institutionRegistry,
        eq(accountConnections.institutionRegistryId, institutionRegistry.id),
      )
      .where(
        and(
          eq(financialAccounts.id, accountId),
          eq(financialAccounts.userId, userId),
        ),
      )
      .limit(1);

    if (!row) return { ok: false, error: "not_found" };
    const target = reconnectTarget(row.connection);
    if (!target) return { ok: false, error: "unsupported_provider" };

    // Expired links can never be used again, so don't keep their hashes around.
    await db
      .delete(reconnectLinks)
      .where(
        and(
          eq(reconnectLinks.userId, userId),
          lt(reconnectLinks.expiresAt, new Date()),
        ),
      );

    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + RECONNECT_LINK_TTL_MS);

    await db.insert(reconnectLinks).values({
      userId,
      financialAccountId: accountId,
      tokenHash: hashToken(token),
      expiresAt,
    });

    const appUrl = process.env.APP_URL || "http://localhost:6100";

    return {
      ok: true,
      link: {
        url: `${appUrl}/reconnect/${token}`,
        expiresAt: expiresAt.toISOString(),
        accountId,
        institutionName: row.institutionName ?? "Unknown",
        provider: target.provider,
      },
    };
  }

  /**
   * Resolves the token from a link's URL. Expired links still resolve so the
   * caller can tell "expired" apart from "never existed".
   */
  async findByToken(token: string): Promise<ResolvedReconnectLink | null> {
    if (!TOKEN_PATTERN.test(token)) return null;

    const [row] = await db
      .select({
        link: reconnectLinks,
        connection: accountConnections,
        accountName: financialAccounts.name,
        accountMask: financialAccounts.mask,
        institutionName: institutionRegistry.name,
        institutionUrl: institutionRegistry.url,
      })
      .from(reconnectLinks)
      .innerJoin(
        financialAccounts,
        eq(reconnectLinks.financialAccountId, financialAccounts.id),
      )
      .innerJoin(
        accountConnections,
        eq(financialAccounts.accountConnectionId, accountConnections.id),
      )
      .leftJoin(
        institutionRegistry,
        eq(accountConnections.institutionRegistryId, institutionRegistry.id),
      )
      .where(eq(reconnectLinks.tokenHash, hashToken(token)))
      .limit(1);

    if (!row) return null;
    const target = reconnectTarget(row.connection);
    if (!target) return null;

    return {
      ...row,
      target,
      institutionName: row.institutionName ?? "Unknown",
      institutionUrl: row.institutionUrl ?? null,
    };
  }

  isExpired({ link }: ResolvedReconnectLink): boolean {
    return link.expiresAt.getTime() <= Date.now();
  }

  async getStatus(resolved: ResolvedReconnectLink): Promise<ReconnectLinkStatus> {
    const { link } = resolved;
    let state: ReconnectLinkState = "ready";
    let message: string | null = null;

    if (link.usedAt) {
      const [job] = link.syncJobId
        ? await db
            .select({
              status: syncJobs.status,
              errorMessage: syncJobs.errorMessage,
              errorCode: syncJobs.errorCode,
            })
            .from(syncJobs)
            .where(eq(syncJobs.id, link.syncJobId))
            .limit(1)
        : [];

      if (!job || job.status === "pending") {
        state = "syncing";
      } else if (job.status === "error" && needsUserAction(job.errorCode)) {
        state = "failed";
        message = job.errorMessage;
      } else {
        state = "synced";
        message = job.status === "error" ? CATCHING_UP_MESSAGE : null;
      }
    }

    return {
      provider: resolved.target.provider,
      institutionName: resolved.institutionName,
      institutionUrl: resolved.institutionUrl,
      accountName: resolved.accountName,
      accountMask: resolved.accountMask,
      expiresAt: link.expiresAt.toISOString(),
      state,
      message,
    };
  }

  /**
   * Creates what the page needs to open the provider's reconnect flow. Allowed
   * until a reconnect succeeds; a link whose sync then failed (the bank still
   * wants a login) can be tried again.
   */
  async startSession(
    resolved: ResolvedReconnectLink,
  ): Promise<
    { ok: true; session: ReconnectSession } | { ok: false; error: "already_used" }
  > {
    const { link, target } = resolved;
    const { state } = await this.getStatus(resolved);

    if (state === "syncing" || state === "synced") {
      return { ok: false, error: "already_used" };
    }
    if (state === "failed") {
      await db
        .update(reconnectLinks)
        .set({ usedAt: null, syncJobId: null })
        .where(eq(reconnectLinks.id, link.id));
    }

    if (target.provider === "plaid") {
      const linkToken = await plaidService.createUpdateLinkToken(
        link.userId,
        target.accessToken,
      );
      return { ok: true, session: { provider: "plaid", linkToken } };
    }

    const profileId = await this.getQuilttProfileId(link.userId);
    const quilttSession = await quilttService.createSession(profileId);
    return {
      ok: true,
      session: {
        provider: "quiltt",
        sessionToken: quilttSession.token,
        connectorId: process.env.QUILTT_CONNECTOR_ID ?? "",
        connectionId: target.connectionId,
      },
    };
  }

  /**
   * Called after the provider flow succeeds: marks the link used and re-syncs
   * the connection through the same path as an in-app reconnect, which also
   * clears the account's sync error. Repeat calls don't start another sync.
   */
  async complete(resolved: ResolvedReconnectLink): Promise<ReconnectLinkStatus> {
    const { link } = resolved;

    const [claimed] = await db
      .update(reconnectLinks)
      .set({ usedAt: new Date() })
      .where(and(eq(reconnectLinks.id, link.id), isNull(reconnectLinks.usedAt)))
      .returning();

    if (!claimed) {
      const [current] = await db
        .select()
        .from(reconnectLinks)
        .where(eq(reconnectLinks.id, link.id))
        .limit(1);
      return this.getStatus({ ...resolved, link: current ?? link });
    }

    try {
      const { syncJobId } = await this.startSync(link.userId, resolved);
      const [updated] = await db
        .update(reconnectLinks)
        .set({ syncJobId })
        .where(eq(reconnectLinks.id, link.id))
        .returning();
      return this.getStatus({ ...resolved, link: updated });
    } catch (err) {
      // Release the link so the reconnect can be finished on a retry.
      await db
        .update(reconnectLinks)
        .set({ usedAt: null })
        .where(eq(reconnectLinks.id, link.id));
      throw err;
    }
  }

  private async startSync(
    userId: string,
    { connection, target }: ResolvedReconnectLink,
  ): Promise<{ syncJobId: number }> {
    if (target.provider === "plaid") {
      // Update mode keeps the Item's access token, so there's nothing to
      // exchange: re-sync with the stored one.
      return plaidService.connectAndPerformInitialSync({
        userId,
        institutionRegistryId: connection.institutionRegistryId,
        plaidItemId: target.itemId,
        plaidAccessToken: target.accessToken,
      });
    }

    return quilttService.connectAndPerformInitialSync({
      userId,
      quilttConnectionId: target.connectionId,
      quilttProfileId: await this.getQuilttProfileId(userId),
      institutionRegistryId: connection.institutionRegistryId,
    });
  }

  private async getQuilttProfileId(userId: string): Promise<string> {
    const [row] = await db
      .select({ quilttProfileId: userTable.quilttProfileId })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1);
    if (!row?.quilttProfileId) {
      throw new Error(`User ${userId} has no Quiltt profile`);
    }
    return row.quilttProfileId;
  }
}

export const reconnectLinkService = new ReconnectLinkService();
