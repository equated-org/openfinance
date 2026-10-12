import { plaidClient, PLAID_COUNTRY_CODES } from "./plaid.client";
import { db } from "../../db";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { PlaidTransactionSyncWorkflow } from "../../workflows/plaid-transaction-sync.workflow";
import { sleep } from "../utils";
import {
  financialAccounts,
  accountConnections,
  syncJobs,
  institutionRegistry,
  transactions,
} from "../../schema";
import { eq, sql, and, isNull } from "drizzle-orm";
import { user as userTable } from "../../schema";

class PlaidService {
  async exchangePublicToken(publicToken: string) {
    const response = await plaidClient.itemPublicTokenExchange({
      public_token: publicToken,
    });
    return {
      accessToken: response.data.access_token,
      itemId: response.data.item_id,
    };
  }

  /**
   * Link token for update mode, which re-authenticates an existing Item. Plaid
   * expires it after 30 minutes, so create it right before opening Link.
   */
  async createUpdateLinkToken(userId: string, accessToken: string) {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: userId },
      client_name: "Open Finance",
      access_token: accessToken,
      country_codes: PLAID_COUNTRY_CODES,
      language: "en",
    });
    return response.data.link_token;
  }

  async getInstitutionInfo(institutionId: string) {
    const response = await plaidClient.institutionsGetById({
      institution_id: institutionId,
      country_codes: PLAID_COUNTRY_CODES,
      options: { include_optional_metadata: true },
    });
    return {
      name: response.data.institution.name,
      logo: response.data.institution.logo ?? null,
    };
  }

  async findRegistryId(institutionId: string): Promise<number | null> {
    const rows = await db
      .select({ id: institutionRegistry.id })
      .from(institutionRegistry)
      .where(
        eq(institutionRegistry.providerCompositeKey, `plaid_${institutionId}`),
      )
      .limit(1);
    return rows[0]?.id ?? null;
  }

  async connectAndPerformInitialSync(params: {
    userId: string;
    institutionRegistryId: number | null;
    plaidItemId: string;
    plaidAccessToken: string;
  }) {
    const { userId, institutionRegistryId, plaidItemId, plaidAccessToken } =
      params;

    // Upsert account connection (handles both new connections and reauth)
    const [connection] = await db
      .insert(accountConnections)
      .values({
        userId,
        provider: "plaid",
        institutionRegistryId,
        plaidItemId,
        plaidAccessToken,
        status: "active",
      })
      .onConflictDoUpdate({
        target: accountConnections.plaidItemId,
        set: {
          plaidAccessToken,
          status: "active",
          updatedAt: new Date(),
        },
      })
      .returning();

    const connectionId = connection.id;

    this.markFirstAccountConnected(userId);

    await this.upsertAccounts({
      userId,
      connectionId,
      accessToken: plaidAccessToken,
    });

    // Create a sync job for transactions
    const [syncJob] = await db
      .insert(syncJobs)
      .values({
        userId,
        accountConnectionId: connectionId,
        provider: "plaid",
        jobType: "transactions",
        status: "pending",
      })
      .returning();

    // Dispatch background workflow for transaction sync. Plaid is still pulling
    // from the bank at this point, so tell the workflow to wait for that data
    // instead of reporting an empty success a second after Link closes.
    await DBOS.startWorkflow(PlaidTransactionSyncWorkflow).run({
      connectionId,
      userId,
      syncJobId: syncJob.id,
      awaitUpstreamPull: true,
    });

    return { syncJobId: syncJob.id };
  }

  /**
   * Upsert every account Plaid reports for the Item, with fresh balances.
   * Accounts can join an Item after it was linked — a replacement card arrives
   * with a new account_id — and a transaction is only saved for an account
   * that has a row here.
   */
  async upsertAccounts(params: {
    userId: string;
    connectionId: number;
    accessToken: string;
  }) {
    const { userId, connectionId, accessToken } = params;

    const accountsResponse = await plaidClient.accountsGet({
      access_token: accessToken,
    });

    for (const account of accountsResponse.data.accounts) {
      const fields = {
        name: account.name,
        officialName: account.official_name ?? null,
        type: account.type,
        subtype: account.subtype ?? null,
        mask: account.mask ?? null,
        currentBalance: account.balances.current?.toString() ?? null,
        availableBalance: account.balances.available?.toString() ?? null,
        isoCurrencyCode: account.balances.iso_currency_code ?? null,
      };

      await db
        .insert(financialAccounts)
        .values({
          userId,
          accountConnectionId: connectionId,
          providerAccountId: account.account_id,
          ...fields,
        })
        .onConflictDoUpdate({
          target: [
            financialAccounts.accountConnectionId,
            financialAccounts.providerAccountId,
          ],
          set: { ...fields, updatedAt: new Date() },
        });
    }
  }

  async syncTransactions(params: {
    connectionId: number;
    accessToken: string;
    cursor: string | null;
    /**
     * Wait for Plaid's asynchronous initial/historical pull to finish. Only set
     * on the Link path — the scheduled poll processes connections serially, so
     * blocking there would delay every other connection's sync.
     */
    waitForInitialPull?: boolean;
  }) {
    const { connectionId, accessToken, cursor, waitForInitialPull } = params;

    const [connection] = await db
      .select({ userId: accountConnections.userId })
      .from(accountConnections)
      .where(eq(accountConnections.id, connectionId))
      .limit(1);

    if (!connection) {
      throw new Error(`Connection ${connectionId} not found`);
    }

    // Before reading transactions: /transactions/sync returns each one only
    // once, so one for an account without a row yet would be lost for good.
    await this.upsertAccounts({
      userId: connection.userId,
      connectionId,
      accessToken,
    });

    // Get accounts for this connection to map account IDs
    const accounts = await db
      .select({
        id: financialAccounts.id,
        providerAccountId: financialAccounts.providerAccountId,
        userId: financialAccounts.userId,
      })
      .from(financialAccounts)
      .where(eq(financialAccounts.accountConnectionId, connectionId));

    const accountMap = new Map(accounts.map((a) => [a.providerAccountId, a]));

    let nextCursor = cursor ?? "";
    let updateStatus: string | null = null;
    let added = 0;
    let modified = 0;
    let removed = 0;
    const skippedAccountIds = new Set<string>();

    const initialDelay = 5000;
    const maxDelay = 30000;
    const maxRetries = 10;
    let retryIndex = 0;

    // Single loop: pages through results, then polls with backoff if NOT_READY
    for (;;) {
      const response = await plaidClient.transactionsSync({
        access_token: accessToken,
        cursor: nextCursor || undefined,
      });

      const data = response.data;
      nextCursor = data.next_cursor;
      updateStatus = data.transactions_update_status ?? null;

      console.debug(
        `connection ${connectionId}: status=${data.transactions_update_status}, ` +
          `added=${data.added.length}, modified=${data.modified.length}, removed=${data.removed.length}, ` +
          `has_more=${data.has_more}`,
      );

      // Process added transactions
      for (const tx of data.added) {
        const account = accountMap.get(tx.account_id);
        if (!account) {
          skippedAccountIds.add(tx.account_id);
          continue;
        }

        await db
          .insert(transactions)
          .values({
            userId: account.userId,
            accountId: account.id,
            providerTransactionId: tx.transaction_id,
            name: tx.name,
            amount: tx.amount.toString(),
            isoCurrencyCode: tx.iso_currency_code ?? null,
            date: new Date(tx.date),
            authorizedDate: tx.authorized_date
              ? new Date(tx.authorized_date)
              : null,
            pending: tx.pending,
            merchantName: tx.merchant_name ?? null,
            raw: tx as unknown as Record<string, unknown>,
          })
          .onConflictDoUpdate({
            target: [
              transactions.accountId,
              transactions.providerTransactionId,
            ],
            set: {
              name: tx.name,
              amount: tx.amount.toString(),
              isoCurrencyCode: tx.iso_currency_code ?? null,
              date: new Date(tx.date),
              authorizedDate: tx.authorized_date
                ? new Date(tx.authorized_date)
                : null,
              pending: tx.pending,
              merchantName: tx.merchant_name ?? null,
              raw: tx as unknown as Record<string, unknown>,
              updatedAt: new Date(),
            },
          });
        added++;
      }

      // Process modified transactions
      for (const tx of data.modified) {
        const account = accountMap.get(tx.account_id);
        if (!account) {
          skippedAccountIds.add(tx.account_id);
          continue;
        }

        await db
          .insert(transactions)
          .values({
            userId: account.userId,
            accountId: account.id,
            providerTransactionId: tx.transaction_id,
            name: tx.name,
            amount: tx.amount.toString(),
            isoCurrencyCode: tx.iso_currency_code ?? null,
            date: new Date(tx.date),
            authorizedDate: tx.authorized_date
              ? new Date(tx.authorized_date)
              : null,
            pending: tx.pending,
            merchantName: tx.merchant_name ?? null,
            raw: tx as unknown as Record<string, unknown>,
          })
          .onConflictDoUpdate({
            target: [
              transactions.accountId,
              transactions.providerTransactionId,
            ],
            set: {
              name: tx.name,
              amount: tx.amount.toString(),
              isoCurrencyCode: tx.iso_currency_code ?? null,
              date: new Date(tx.date),
              authorizedDate: tx.authorized_date
                ? new Date(tx.authorized_date)
                : null,
              pending: tx.pending,
              merchantName: tx.merchant_name ?? null,
              raw: tx as unknown as Record<string, unknown>,
              updatedAt: new Date(),
            },
          });
        modified++;
      }

      // Process removed transactions
      for (const tx of data.removed) {
        if (!tx.transaction_id) continue;
        await db
          .update(transactions)
          .set({ status: "deleted", updatedAt: new Date() })
          .where(
            sql`${transactions.providerTransactionId} = ${tx.transaction_id}`,
          );
        removed++;
      }

      // More pages available — continue immediately
      if (data.has_more) continue;

      // Wait for Plaid's initial/historical pull to finish.
      //
      // This deliberately does NOT key off `cursor === null`. A not-ready first
      // sync returns an empty next_cursor, and so does an Item with no
      // /transactions/sync-eligible accounts (brokerages — the endpoint covers
      // credit, depository and some loan accounts only). Both persist as "", so
      // the cursor cannot tell "not ready yet" from "nothing here, ever".
      //
      // An unknown/absent status means we cannot tell; treat it as done rather
      // than blocking, so those Items never sit in a pointless retry loop.
      const awaitingPull =
        updateStatus === "NOT_READY" ||
        updateStatus === "INITIAL_UPDATE_COMPLETE";

      if (waitForInitialPull && awaitingPull && retryIndex < maxRetries) {
        const delay = Math.min(initialDelay * 2 ** retryIndex, maxDelay);
        console.debug(
          `connection ${connectionId}: ${updateStatus}, retrying in ${delay}ms (attempt ${retryIndex + 1}/${maxRetries})`,
        );
        await sleep(delay);
        retryIndex++;
        continue;
      }

      break;
    }

    if (skippedAccountIds.size > 0) {
      console.warn(
        `connection ${connectionId}: skipped transactions for unknown account(s) ${[...skippedAccountIds].join(", ")}`,
      );
    }

    // Update cursor on connection
    await db
      .update(accountConnections)
      .set({
        transactionCursor: nextCursor,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(accountConnections.id, connectionId));

    console.debug(
      `connection ${connectionId}: sync complete — added=${added}, modified=${modified}, removed=${removed}`,
    );

    return { nextCursor, added, modified, removed, updateStatus };
  }

  async getItemStatus(accessToken: string) {
    const r = await plaidClient.itemGet({ access_token: accessToken });
    const tx = r.data.status?.transactions;
    return {
      lastSuccessfulUpdate: tx?.last_successful_update
        ? new Date(tx.last_successful_update)
        : null,
      lastFailedUpdate: tx?.last_failed_update
        ? new Date(tx.last_failed_update)
        : null,
      itemError: r.data.item.error,
      itemCreatedAt: r.data.item.created_at
        ? new Date(r.data.item.created_at)
        : null,
    };
  }

  async itemRemove(accessToken: string): Promise<boolean> {
    try {
      await plaidClient.itemRemove({ access_token: accessToken });
      return true;
    } catch {
      return false;
    }
  }

  private markFirstAccountConnected(userId: string): void {
    db.update(userTable)
      .set({ firstAccountConnectedAt: new Date() })
      .where(
        and(
          eq(userTable.id, userId),
          isNull(userTable.firstAccountConnectedAt),
        ),
      )
      .then(
        () => {},
        () => {},
      );
  }
}

export const plaidService = new PlaidService();
