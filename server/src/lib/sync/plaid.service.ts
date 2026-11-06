import type { RemovedTransaction, Transaction } from "plaid";
import { plaidClient, PLAID_COUNTRY_CODES } from "./plaid.client";
import { readFailure } from "./disconnect-codes";
import { db } from "../../db";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { PlaidTransactionSyncWorkflow } from "../../workflows/plaid-transaction-sync.workflow";
import {
  financialAccounts,
  accountConnections,
  syncJobs,
  institutionRegistry,
  transactions,
} from "../../schema";
import { eq, and, inArray, isNull } from "drizzle-orm";
import { user as userTable } from "../../schema";

/** Plaid's largest page, so a big update has fewer chances to be interrupted. */
const SYNC_PAGE_SIZE = 500;

/** How many times to try an update whose data keeps changing underneath us. */
const MAX_SYNC_ATTEMPTS = 3;

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

  /**
   * Read here rather than passed in by a workflow: DBOS stores what a step
   * returns, so a token held in workflow state is written out on every sync.
   */
  private async loadConnection(connectionId: number) {
    const [connection] = await db
      .select({
        userId: accountConnections.userId,
        accessToken: accountConnections.plaidAccessToken,
        cursor: accountConnections.transactionCursor,
      })
      .from(accountConnections)
      .where(eq(accountConnections.id, connectionId))
      .limit(1);

    if (!connection?.accessToken) {
      throw new Error(
        `Connection ${connectionId} not found or missing access token`,
      );
    }

    return { ...connection, accessToken: connection.accessToken };
  }

  /**
   * Every update since `cursor`. If the data changes between pages, Plaid
   * rejects the next page and the whole update has to start over from `cursor`.
   * That's why nothing is saved until every page is in: a half-saved attempt
   * could keep a transaction the restarted update never mentions.
   */
  private async fetchUpdates(accessToken: string, cursor: string | null) {
    for (let attempt = 1; ; attempt++) {
      const added: Transaction[] = [];
      const modified: Transaction[] = [];
      const removed: RemovedTransaction[] = [];
      let nextCursor = cursor ?? "";

      try {
        for (;;) {
          const { data } = await plaidClient.transactionsSync({
            access_token: accessToken,
            cursor: nextCursor || undefined,
            count: SYNC_PAGE_SIZE,
          });
          added.push(...data.added);
          modified.push(...data.modified);
          removed.push(...data.removed);
          nextCursor = data.next_cursor;

          if (!data.has_more) {
            const updateStatus: string | null =
              data.transactions_update_status ?? null;
            return { added, modified, removed, nextCursor, updateStatus };
          }
        }
      } catch (err) {
        const restart =
          readFailure(err).errorCode ===
          "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION";
        if (!restart || attempt === MAX_SYNC_ATTEMPTS) throw err;
      }
    }
  }

  async syncTransactions(connectionId: number) {
    const { userId, accessToken, cursor } =
      await this.loadConnection(connectionId);

    // Before reading transactions: /transactions/sync returns each one only
    // once, so one for an account without a row yet would be lost for good.
    await this.upsertAccounts({ userId, connectionId, accessToken });

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

    const updates = await this.fetchUpdates(accessToken, cursor);
    const { nextCursor, updateStatus } = updates;

    const skippedAccountIds = new Set<string>();

    /** Saves a new or changed transaction, returning how many rows it wrote. */
    const save = async (tx: Transaction) => {
      const account = accountMap.get(tx.account_id);
      if (!account) {
        skippedAccountIds.add(tx.account_id);
        return 0;
      }

      const fields = {
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
      };

      await db
        .insert(transactions)
        .values({
          userId: account.userId,
          accountId: account.id,
          providerTransactionId: tx.transaction_id,
          ...fields,
        })
        .onConflictDoUpdate({
          target: [transactions.accountId, transactions.providerTransactionId],
          set: { ...fields, updatedAt: new Date() },
        });
      return 1;
    };

    let added = 0;
    for (const tx of updates.added) added += await save(tx);

    let modified = 0;
    for (const tx of updates.modified) modified += await save(tx);

    // Limited to this connection's accounts: transaction ids are only unique
    // per account, and this table holds every user's rows.
    const removedIds = updates.removed.map((tx) => tx.transaction_id);
    const removed = removedIds.length;
    if (removed > 0) {
      await db
        .update(transactions)
        .set({ status: "deleted", updatedAt: new Date() })
        .where(
          and(
            inArray(
              transactions.accountId,
              accounts.map((a) => a.id),
            ),
            inArray(transactions.providerTransactionId, removedIds),
          ),
        );
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
      `connection ${connectionId}: sync complete, status=${updateStatus}, ` +
        `added=${added}, modified=${modified}, removed=${removed}`,
    );

    return { nextCursor, added, modified, removed, updateStatus };
  }

  async getItemStatus(connectionId: number) {
    const { accessToken } = await this.loadConnection(connectionId);
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
    } catch (err) {
      const failure = readFailure(err);
      // Already removed is what the caller wanted, and retries depend on it.
      if (failure.errorCode === "ITEM_NOT_FOUND") return true;
      // The Item keeps billing until removed, so this shouldn't pass quietly.
      console.warn(`Plaid Item removal failed: ${failure.message}`);
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
