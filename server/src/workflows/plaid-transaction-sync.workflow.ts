import { DBOS } from "@dbos-inc/dbos-sdk";
import { db } from "../db";
import { accountConnections, syncJobs } from "../schema";
import { eq } from "drizzle-orm";
import { plaidService } from "../lib/sync/plaid.service";
import { extractPlaidError } from "../lib/sync/plaid.client";
import { needsUserAction } from "../lib/sync/disconnect-codes";
import { notificationService } from "../lib/notification.service";

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Plaid pulls from the bank asynchronously after a Link connect or reauth, so
 * the first /transactions/sync right afterwards can come back empty or partial.
 * Until we consume the SYNC_UPDATES_AVAILABLE webhook, re-check on a backoff
 * instead of declaring success on an empty first page. Most pulls land within
 * seconds, so it starts short.
 */
const UPSTREAM_PULL_RETRY_DELAYS_MS = [
  5_000, 10_000, 20_000, 30_000, 60_000, 120_000, 300_000, 600_000,
];

const UPSTREAM_NOT_READY_MESSAGE =
  "Your bank is still sending data. This usually finishes on its own shortly.";

/**
 * Has Plaid finished pulling from the bank?
 *
 * A transaction delta is not a readiness signal — an Item can legitimately
 * report "done" with nothing changed, and can equally report NOT_READY forever.
 * The right signal depends on whether we have synced the Item before:
 *
 * - **Not yet** (no baseline): `transactions_update_status` reaching
 *   HISTORICAL_UPDATE_COMPLETE. Anything unknown counts as done, so Items with
 *   no /transactions/sync-eligible accounts (brokerages) don't block.
 * - **Yes** (reauth): the status is *already*
 *   HISTORICAL_UPDATE_COMPLETE from the original link and says nothing about the
 *   fresh pull, so require last_successful_update to advance past the baseline
 *   captured before waiting.
 */
function isPullComplete(params: {
  updateStatus: string | null;
  baseline: number | null;
  current: number | null;
}): boolean {
  const { updateStatus, baseline, current } = params;

  if (baseline !== null) return current !== null && current > baseline;

  return (
    updateStatus !== "NOT_READY" && updateStatus !== "INITIAL_UPDATE_COMPLETE"
  );
}

const STALE_USER_MESSAGE =
  "Your bank hasn't sent new transactions in a while. Please reconnect to resume syncing.";
const ITEM_ERROR_USER_MESSAGE =
  "Your bank connection needs to be reauthorized. Please reconnect.";

export class PlaidTransactionSyncWorkflow {
  @DBOS.step()
  static async fetchConnection(connectionId: number) {
    const rows = await db
      .select()
      .from(accountConnections)
      .where(eq(accountConnections.id, connectionId))
      .limit(1);
    return rows[0] ?? null;
  }

  @DBOS.step()
  static async runSync(params: {
    connectionId: number;
    accessToken: string;
    cursor: string | null;
  }) {
    return plaidService.syncTransactions(params);
  }

  /**
   * Timestamp of Plaid's last successful transactions pull, or null if it has
   * never pulled (or the status read failed — in which case we fall back to
   * the status-based check, which errs towards not blocking).
   */
  @DBOS.step()
  static async readLastSuccessfulUpdate(
    accessToken: string,
  ): Promise<number | null> {
    try {
      const status = await plaidService.getItemStatus(accessToken);
      return status.lastSuccessfulUpdate?.getTime() ?? null;
    } catch (err) {
      DBOS.logger.warn(
        `Item status read failed: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  @DBOS.step()
  static async markComplete(syncJobId: number, recordsProcessed: number) {
    await db
      .update(syncJobs)
      .set({
        status: "success",
        completedAt: new Date(),
        recordsProcessed,
        updatedAt: new Date(),
      })
      .where(eq(syncJobs.id, syncJobId));
  }

  @DBOS.step()
  static async markStarted(syncJobId: number) {
    await db
      .update(syncJobs)
      .set({ startedAt: new Date(), updatedAt: new Date() })
      .where(eq(syncJobs.id, syncJobId));
  }

  @DBOS.step()
  static async markError(
    syncJobId: number,
    errorMessage: string,
    errorCode?: string,
  ) {
    await db
      .update(syncJobs)
      .set({
        status: "error",
        completedAt: new Date(),
        errorMessage,
        errorCode: errorCode ?? null,
        updatedAt: new Date(),
      })
      .where(eq(syncJobs.id, syncJobId));
  }

  /** What's wrong with the Item, if it needs the user. */
  @DBOS.step()
  static async checkItemFreshness(
    accessToken: string,
  ): Promise<{ code: string; message: string } | null> {
    let status: Awaited<ReturnType<typeof plaidService.getItemStatus>>;
    try {
      status = await plaidService.getItemStatus(accessToken);
    } catch (err) {
      DBOS.logger.warn(
        `Item status check failed: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }

    // Report Plaid's real code, and only one the user can clear: parking a
    // connection over a passing outage would stop it recovering by itself.
    const itemErrorCode = status.itemError?.error_code;
    if (itemErrorCode && needsUserAction(itemErrorCode)) {
      DBOS.logger.info(`Plaid item error: ${itemErrorCode}`);
      return { code: itemErrorCode, message: ITEM_ERROR_USER_MESSAGE };
    }

    const { lastSuccessfulUpdate, lastFailedUpdate, itemCreatedAt } = status;
    const isFailing =
      lastFailedUpdate !== null &&
      (lastSuccessfulUpdate === null ||
        lastFailedUpdate > lastSuccessfulUpdate);

    if (!isFailing) return null;

    const baseline = lastSuccessfulUpdate ?? itemCreatedAt;
    const ageMs = baseline ? Date.now() - baseline.getTime() : Infinity;
    if (ageMs <= STALE_THRESHOLD_MS) return null;

    DBOS.logger.info(
      `Plaid upstream pull stale: last_successful_update=${lastSuccessfulUpdate?.toISOString() ?? "never"} ` +
        `(${Math.round(ageMs / (60 * 60 * 1000))}h ago), last_failed_update=${lastFailedUpdate?.toISOString() ?? "never"}`,
    );
    return { code: "STALE_DATA", message: STALE_USER_MESSAGE };
  }

  @DBOS.step()
  static async notifyDisconnect(
    userId: string,
    connectionId: number,
    errorMessage?: string,
  ) {
    try {
      await notificationService.sendAccountDisconnectEmail({
        userId,
        connectionId,
        errorMessage,
      });
    } catch (e) {
      DBOS.logger.error(
        `Failed to send disconnect notification for connection ${connectionId}: ${e}`,
      );
    }
  }

  @DBOS.step()
  static async notifySync(
    userId: string,
    connectionId: number,
    added: number,
    modified: number,
    removed: number,
  ) {
    try {
      await notificationService.logTransactionSync({
        userId,
        connectionId,
        added,
        modified,
        removed,
      });
    } catch (e) {
      DBOS.logger.error(
        `Failed to log sync notification for connection ${connectionId}: ${e}`,
      );
    }
  }

  @DBOS.workflow()
  static async run(input: {
    connectionId: number;
    userId: string;
    syncJobId: number;
    /**
     * Set when this sync was dispatched straight after Link (new connection or
     * reauth). Plaid's pull from the bank is still in flight at that point, so
     * the workflow retries on a backoff rather than reporting an empty success.
     */
    awaitUpstreamPull?: boolean;
  }): Promise<{ added: number; modified: number; removed: number } | null> {
    const { connectionId, syncJobId, awaitUpstreamPull } = input;

    await PlaidTransactionSyncWorkflow.markStarted(syncJobId);

    const connection =
      await PlaidTransactionSyncWorkflow.fetchConnection(connectionId);

    if (!connection || !connection.plaidAccessToken) {
      await PlaidTransactionSyncWorkflow.markError(
        syncJobId,
        "Connection not found or missing access token",
      );
      return null;
    }

    try {
      // A reauth must see Plaid run a fresh pull, which
      // transactions_update_status cannot express, so note where Plaid stands
      // before the first sync. A saved cursor is what marks a reauth.
      // last_successful_update can't: Plaid often finishes a new Item's pull
      // before Link closes, and then won't pull again for hours. Brokerages
      // never get a cursor, so they don't wait either.
      const baseline =
        awaitUpstreamPull && connection.transactionCursor
          ? await PlaidTransactionSyncWorkflow.readLastSuccessfulUpdate(
              connection.plaidAccessToken,
            )
          : null;

      let result = await PlaidTransactionSyncWorkflow.runSync({
        connectionId,
        accessToken: connection.plaidAccessToken,
        cursor: connection.transactionCursor,
      });

      if (awaitUpstreamPull) {
        let current = await PlaidTransactionSyncWorkflow.readLastSuccessfulUpdate(
          connection.plaidAccessToken,
        );
        let complete = isPullComplete({
          updateStatus: result.updateStatus,
          baseline,
          current,
        });

        for (const delayMs of UPSTREAM_PULL_RETRY_DELAYS_MS) {
          if (complete) break;

          DBOS.logger.info(
            `Connection ${connectionId}: upstream pull not complete ` +
              `(status=${result.updateStatus ?? "unknown"}), ` +
              `re-checking in ${Math.round(delayMs / 1000)}s`,
          );
          await DBOS.sleep(delayMs);

          const next = await PlaidTransactionSyncWorkflow.runSync({
            connectionId,
            accessToken: connection.plaidAccessToken,
            cursor: result.nextCursor,
          });
          result = {
            nextCursor: next.nextCursor,
            updateStatus: next.updateStatus,
            added: result.added + next.added,
            modified: result.modified + next.modified,
            removed: result.removed + next.removed,
          };
          current = await PlaidTransactionSyncWorkflow.readLastSuccessfulUpdate(
            connection.plaidAccessToken,
          );
          complete = isPullComplete({
            updateStatus: result.updateStatus,
            baseline,
            current,
          });
        }

        // Never report success on a pull that never finished — that is what
        // made an unfinished sync indistinguishable from an empty one. The
        // code is deliberately not a disconnect code, so the poller keeps
        // retrying and no reconnect email or prompt is raised.
        if (!complete) {
          DBOS.logger.warn(
            `Connection ${connectionId}: upstream pull still incomplete after ` +
              `${UPSTREAM_PULL_RETRY_DELAYS_MS.length} retries`,
          );
          await PlaidTransactionSyncWorkflow.markError(
            syncJobId,
            UPSTREAM_NOT_READY_MESSAGE,
            "UPSTREAM_NOT_READY",
          );
          return null;
        }
      }

      // Skip the freshness check on initial sync — Plaid hasn't run a
      // background pull yet, so last_successful_update may be unset. Also skip
      // it right after Link: the item legitimately looks stale until Plaid's
      // first post-reauth pull lands.
      if (connection.transactionCursor !== null && !awaitUpstreamPull) {
        const failure = await PlaidTransactionSyncWorkflow.checkItemFreshness(
          connection.plaidAccessToken,
        );
        if (failure) {
          await PlaidTransactionSyncWorkflow.markError(
            syncJobId,
            failure.message,
            failure.code,
          );
          await PlaidTransactionSyncWorkflow.notifyDisconnect(
            input.userId,
            connectionId,
            failure.message,
          );
          return null;
        }
      }

      const total = result.added + result.modified + result.removed;
      await PlaidTransactionSyncWorkflow.markComplete(syncJobId, total);
      if (total > 0) {
        await PlaidTransactionSyncWorkflow.notifySync(
          input.userId,
          connectionId,
          result.added,
          result.modified,
          result.removed,
        );
      }
      return result;
    } catch (err) {
      // An uncoded failure never reached Plaid (network, or a bug here), so the
      // poller retries it rather than parking the connection.
      const { errorCode, message } = extractPlaidError(err);

      await PlaidTransactionSyncWorkflow.markError(
        syncJobId,
        message,
        errorCode,
      );
      DBOS.logger.error(
        `Transaction sync failed for connection ${connectionId}: ` +
          `${errorCode ?? "UNKNOWN"} — ${message}`,
      );

      if (needsUserAction(errorCode)) {
        await PlaidTransactionSyncWorkflow.notifyDisconnect(
          input.userId,
          connectionId,
          message,
        );
      }

      return null;
    }
  }
}
