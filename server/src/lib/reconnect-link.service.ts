import crypto from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
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
  institutionLogoUrl,
  reconnectLinks,
  user as userTable,
  type AccountConnection,
  type ReconnectLink,
} from "../schema";
import { financialAccountService } from "./financial-account.service";
import { plaidService } from "./sync/plaid.service";
import { quilttService } from "./sync/quiltt.service";
import { appUrl } from "./origins.js";

export const RECONNECT_LINK_TTL_MS = 24 * 60 * 60 * 1000;

// A sign-in that starts just before the link expires can still finish, and
// its sync can still be watched, for this long afterwards.
const FINISH_GRACE_MS = 60 * 60 * 1000;

// Expired links are kept this long so they answer "expired" rather than
// "never existed".
const EXPIRED_LINK_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

// Tokens are 32 random bytes in base64url. Anything else can't match a link,
// so it's rejected before touching the database.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

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
  connectionId: number;
  institutionRegistryId: number | null;
  target: ReconnectTarget;
  accountName: string;
  accountMask: string | null;
  institutionName: string | null;
  institutionUrl: string | null;
  institutionLogoUrl: string | null;
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

    await db
      .delete(reconnectLinks)
      .where(
        and(
          eq(reconnectLinks.userId, userId),
          lt(
            reconnectLinks.expiresAt,
            new Date(Date.now() - EXPIRED_LINK_RETENTION_MS),
          ),
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

    return {
      ok: true,
      link: {
        // The token goes in the fragment, which browsers never send to a
        // server, so it stays out of request logs.
        url: `${appUrl}/reconnect#${token}`,
        expiresAt: expiresAt.toISOString(),
        accountId,
        institutionName: row.institutionName,
        provider: target.provider,
      },
    };
  }

  /**
   * Resolves a link's token. Expired links still resolve so the caller can
   * tell "expired" apart from "never existed".
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
        institutionLogoUrl,
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
      link: row.link,
      connectionId: row.connection.id,
      institutionRegistryId: row.connection.institutionRegistryId,
      target,
      accountName: row.accountName,
      accountMask: row.accountMask,
      institutionName: row.institutionName,
      institutionUrl: row.institutionUrl,
      institutionLogoUrl: row.institutionLogoUrl,
    };
  }

  /** Whether the link can still open a provider sign-in. */
  canStart({ link }: ResolvedReconnectLink): boolean {
    return Date.now() < link.expiresAt.getTime();
  }

  /** Whether a sign-in that started in time can still finish and be watched. */
  canFinish({ link }: ResolvedReconnectLink): boolean {
    return Date.now() < link.expiresAt.getTime() + FINISH_GRACE_MS;
  }

  /**
   * Reports the connection as GET /api/accounts does: a running sync first,
   * then a sync error that needs the owner to sign in again.
   */
  async getStatus(resolved: ResolvedReconnectLink): Promise<ReconnectLinkStatus> {
    const { connectionId } = resolved;
    const [syncing, syncErrors] = await Promise.all([
      financialAccountService.getSyncingConnections([connectionId]),
      financialAccountService.getSyncErrors([connectionId]),
    ]);

    const state: ReconnectLinkState = syncing.has(connectionId)
      ? "syncing"
      : syncErrors.has(connectionId)
        ? "ready"
        : "synced";

    return {
      provider: resolved.target.provider,
      institutionName: resolved.institutionName,
      institutionUrl: resolved.institutionUrl,
      institutionLogoUrl: resolved.institutionLogoUrl,
      accountName: resolved.accountName,
      accountMask: resolved.accountMask,
      expiresAt: resolved.link.expiresAt.toISOString(),
      state,
    };
  }

  /**
   * Creates what the page needs to open the provider's reconnect flow, as
   * long as the connection still needs it.
   */
  async startSession(
    resolved: ResolvedReconnectLink,
  ): Promise<
    { ok: true; session: ReconnectSession } | { ok: false; error: "not_needed" }
  > {
    const { link, target } = resolved;
    const { state } = await this.getStatus(resolved);
    if (state !== "ready") return { ok: false, error: "not_needed" };

    if (target.provider === "plaid") {
      const linkToken = await plaidService.createUpdateLinkToken(
        link.userId,
        target.accessToken,
      );
      return { ok: true, session: { provider: "plaid", linkToken } };
    }

    // Reuse the link's session rather than minting one per attempt: Quiltt
    // allows a profile 10 a day, and each one can read the whole profile.
    let sessionToken = link.quilttSessionToken;
    if (!sessionToken) {
      const profileId = await this.getQuilttProfileId(link.userId);
      sessionToken = (await quilttService.createSession(profileId)).token;
      await db
        .update(reconnectLinks)
        .set({ quilttSessionToken: sessionToken })
        .where(eq(reconnectLinks.id, link.id));
    }

    return {
      ok: true,
      session: {
        provider: "quiltt",
        sessionToken,
        connectorId: process.env.QUILTT_CONNECTOR_ID ?? "",
        connectionId: target.connectionId,
      },
    };
  }

  /**
   * Called after the provider flow succeeds. Re-syncs the connection through
   * the same path as an in-app reconnect, which clears its sync error. Does
   * nothing if a sync is already running or the connection is healthy.
   */
  async complete(
    resolved: ResolvedReconnectLink,
    { quilttConnectionId }: { quilttConnectionId?: string } = {},
  ): Promise<ReconnectLinkStatus> {
    if ((await this.getStatus(resolved)).state === "ready") {
      await this.startSync(resolved, quilttConnectionId);
    }
    return this.getStatus(resolved);
  }

  private async startSync(
    { link, connectionId, institutionRegistryId, target }: ResolvedReconnectLink,
    newQuilttConnectionId?: string,
  ): Promise<void> {
    if (target.provider === "plaid") {
      // Update mode keeps the Item's access token, so there's nothing to
      // exchange: re-sync with the stored one.
      await plaidService.connectAndPerformInitialSync({
        userId: link.userId,
        institutionRegistryId,
        plaidItemId: target.itemId,
        plaidAccessToken: target.accessToken,
      });
      return;
    }

    const profileId = await this.getQuilttProfileId(link.userId);
    let quilttConnectionId = target.connectionId;

    // Reconnecting a DISCONNECTED Quiltt connection creates a new one with a
    // new ID. Point this connection at it so its accounts carry on.
    if (newQuilttConnectionId && newQuilttConnectionId !== quilttConnectionId) {
      const connection = await quilttService.getConnection(
        profileId,
        newQuilttConnectionId,
      );
      if (!connection) {
        throw new Error(
          `Quiltt connection ${newQuilttConnectionId} isn't in the owner's profile`,
        );
      }

      const [taken] = await db
        .select({ id: accountConnections.id })
        .from(accountConnections)
        .where(eq(accountConnections.quilttConnectionId, newQuilttConnectionId))
        .limit(1);
      if (!taken) {
        await db
          .update(accountConnections)
          .set({ quilttConnectionId: newQuilttConnectionId, updatedAt: new Date() })
          .where(eq(accountConnections.id, connectionId));
      }
      quilttConnectionId = newQuilttConnectionId;
    }

    await quilttService.connectAndPerformInitialSync({
      userId: link.userId,
      quilttConnectionId,
      quilttProfileId: profileId,
    });

    // The page is done with the session, so don't leave it valid for a day.
    if (link.quilttSessionToken) {
      try {
        await quilttService.revokeSession(link.quilttSessionToken);
      } catch (err) {
        console.error("Failed to revoke a reconnect link's Quiltt session:", err);
      }
      await db
        .update(reconnectLinks)
        .set({ quilttSessionToken: null })
        .where(eq(reconnectLinks.id, link.id));
    }
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
