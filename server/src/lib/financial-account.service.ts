import { db } from "../db";
import {
  financialAccounts,
  accountConnections,
  institutionRegistry,
  institutionLogoUrl,
  syncJobs,
  type FinancialAccount,
  type NewFinancialAccount,
} from "../schema";
import { eq, inArray, and, desc, sql } from "drizzle-orm";
import type { ConnectedAccount } from "@openfinance/shared";
import { plaidService } from "./sync/plaid.service";
import { mxService } from "./sync/mx.service";
import { quilttService } from "./sync/quiltt.service";
import { needsUserAction } from "./sync/disconnect-codes";
import { user as userTable } from "../schema";

interface SyncError {
  message: string;
  lastFailedAt: string;
}

/** Accounts with the connection and institution that describe them. */
function selectConnectedAccounts() {
  return db
    .select({
      account: financialAccounts,
      connectionId: accountConnections.id,
      provider: accountConnections.provider,
      quilttConnectionId: accountConnections.quilttConnectionId,
      institutionName: institutionRegistry.name,
      institutionUrl: institutionRegistry.url,
      institutionLogoUrl,
    })
    .from(financialAccounts)
    .innerJoin(
      accountConnections,
      eq(financialAccounts.accountConnectionId, accountConnections.id),
    )
    .leftJoin(
      institutionRegistry,
      eq(accountConnections.institutionRegistryId, institutionRegistry.id),
    );
}

type ConnectedAccountRow = Awaited<
  ReturnType<typeof selectConnectedAccounts>
>[number];

class FinancialAccountService {
  async getAccountsByUserId(
    userId: string,
    includeStatus: ("active" | "hidden")[] = ["active"],
  ): Promise<ConnectedAccount[]> {
    const rows = await selectConnectedAccounts().where(
      and(
        eq(financialAccounts.userId, userId),
        inArray(financialAccounts.status, includeStatus),
      ),
    );
    return this.toConnectedAccounts(rows);
  }

  async getAccountById(
    accountId: number,
    userId: string,
  ): Promise<ConnectedAccount | undefined> {
    const [row] = await selectConnectedAccounts()
      .where(eq(financialAccounts.id, accountId))
      .limit(1);
    if (!row || row.account.userId !== userId) return undefined;

    const [account] = await this.toConnectedAccounts([row]);
    return account;
  }

  /** Shapes rows for the API, with each connection's sync state. */
  private async toConnectedAccounts(
    rows: ConnectedAccountRow[],
  ): Promise<ConnectedAccount[]> {
    const connectionIds = [...new Set(rows.map((r) => r.connectionId))];
    const [syncErrorMap, syncingConnections] = await Promise.all([
      this.getSyncErrors(connectionIds),
      this.getSyncingConnections(connectionIds),
    ]);

    return rows.map((row) => ({
      id: row.account.id,
      name: row.account.name,
      officialName: row.account.officialName,
      type: row.account.type,
      subtype: row.account.subtype,
      mask: row.account.mask,
      currentBalance: row.account.currentBalance,
      availableBalance: row.account.availableBalance,
      isoCurrencyCode: row.account.isoCurrencyCode,
      institutionName: row.institutionName ?? "Unknown",
      institutionUrl: row.institutionUrl ?? null,
      institutionLogoUrl: row.institutionLogoUrl ?? null,
      syncError: syncErrorMap.get(row.connectionId) ?? null,
      isSyncing: syncingConnections.has(row.connectionId),
      connectionId: row.connectionId,
      provider: row.provider,
      quilttConnectionId: row.quilttConnectionId ?? null,
      status: row.account.status as "active" | "hidden",
    }));
  }

  async upsertAccount(
    data: Omit<NewFinancialAccount, "id" | "createdAt" | "updatedAt">,
  ): Promise<FinancialAccount> {
    const [result] = await db
      .insert(financialAccounts)
      .values(data)
      .onConflictDoUpdate({
        target: [
          financialAccounts.accountConnectionId,
          financialAccounts.providerAccountId,
        ],
        set: {
          name: data.name,
          officialName: data.officialName,
          type: data.type,
          subtype: data.subtype,
          mask: data.mask,
          currentBalance: data.currentBalance,
          availableBalance: data.availableBalance,
          isoCurrencyCode: data.isoCurrencyCode,
          status: sql`financial_accounts.status`,
          updatedAt: new Date(),
        },
      })
      .returning();

    return result;
  }

  async updateAccountStatus(
    accountId: number,
    userId: string,
    status: "active" | "hidden",
  ): Promise<FinancialAccount | null> {
    const [updated] = await db
      .update(financialAccounts)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(financialAccounts.id, accountId),
          eq(financialAccounts.userId, userId),
        ),
      )
      .returning();

    return updated ?? null;
  }

  async deleteAccount(
    accountId: number,
    userId: string,
  ): Promise<FinancialAccount | null> {
    const [account] = await db
      .select()
      .from(financialAccounts)
      .where(
        and(
          eq(financialAccounts.id, accountId),
          eq(financialAccounts.userId, userId),
        ),
      )
      .limit(1);

    if (!account) return null;

    await db
      .delete(financialAccounts)
      .where(eq(financialAccounts.id, accountId));

    // If no other accounts remain on this connection, delete the connection too
    const remaining = await db
      .select({ id: financialAccounts.id })
      .from(financialAccounts)
      .where(
        eq(financialAccounts.accountConnectionId, account.accountConnectionId),
      )
      .limit(1);

    if (remaining.length === 0) {
      // Best-effort provider-side unlink before deleting the connection row
      const [connection] = await db
        .select()
        .from(accountConnections)
        .where(eq(accountConnections.id, account.accountConnectionId))
        .limit(1);

      if (connection) {
        try {
          if (connection.provider === "plaid" && connection.plaidAccessToken) {
            await plaidService.itemRemove(connection.plaidAccessToken);
          } else if (connection.provider === "mx" && connection.mxMemberGuid) {
            await mxService.deleteMember(
              connection.userId,
              connection.mxMemberGuid,
            );
          } else if (
            connection.provider === "quiltt" &&
            connection.quilttConnectionId
          ) {
            const [dbUser] = await db
              .select({ quilttProfileId: userTable.quilttProfileId })
              .from(userTable)
              .where(eq(userTable.id, connection.userId))
              .limit(1);
            if (dbUser?.quilttProfileId) {
              await quilttService.disconnectConnection(
                dbUser.quilttProfileId,
                connection.quilttConnectionId,
              );
            }
          }
        } catch (err) {
          console.error(
            "Failed to unlink provider connection, proceeding with deletion:",
            err,
          );
        }
      }

      await db
        .delete(accountConnections)
        .where(eq(accountConnections.id, account.accountConnectionId));
    }

    return account;
  }

  async getAccountsByConnectionId(
    connectionId: number,
  ): Promise<FinancialAccount[]> {
    return db
      .select()
      .from(financialAccounts)
      .where(eq(financialAccounts.accountConnectionId, connectionId));
  }

  async getSyncingConnections(
    connectionIds: number[],
  ): Promise<Set<number>> {
    if (connectionIds.length === 0) return new Set();

    const pendingJobs = await db
      .select({ accountConnectionId: syncJobs.accountConnectionId })
      .from(syncJobs)
      .where(
        and(
          inArray(syncJobs.accountConnectionId, connectionIds),
          eq(syncJobs.status, "pending"),
        ),
      );

    return new Set(pendingJobs.map((j) => j.accountConnectionId));
  }

  async getSyncErrors(
    connectionIds: number[],
  ): Promise<Map<number, SyncError>> {
    if (connectionIds.length === 0) return new Map();

    const latestJobs = await db
      .selectDistinctOn([syncJobs.accountConnectionId], {
        accountConnectionId: syncJobs.accountConnectionId,
        errorMessage: syncJobs.errorMessage,
        errorCode: syncJobs.errorCode,
        completedAt: syncJobs.completedAt,
        status: syncJobs.status,
      })
      .from(syncJobs)
      .where(inArray(syncJobs.accountConnectionId, connectionIds))
      .orderBy(
        syncJobs.accountConnectionId,
        desc(syncJobs.createdAt),
        desc(syncJobs.id),
      );

    const errorMap = new Map<number, SyncError>();
    for (const job of latestJobs) {
      // Only genuine disconnects get a syncError, because that is what drives
      // the "Reconnect" prompt and the reconnect task. Transient failures
      // (INSTITUTION_DOWN, rate limits, an upstream pull still in progress)
      // must not tell the user to re-link — re-linking would not help.
      if (
        job.status === "error" &&
        job.errorMessage &&
        needsUserAction(job.errorCode)
      ) {
        errorMap.set(job.accountConnectionId, {
          message: job.errorMessage,
          lastFailedAt: (job.completedAt ?? new Date()).toISOString(),
        });
      }
    }

    return errorMap;
  }
}

export const financialAccountService = new FinancialAccountService();
