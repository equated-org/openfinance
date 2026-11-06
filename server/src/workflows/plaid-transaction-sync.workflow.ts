import { DBOS } from "@dbos-inc/dbos-sdk";
import { plaidService } from "../lib/sync/plaid.service";
import {
  needsUserAction,
  readFailure,
  SyncFailure,
} from "../lib/sync/disconnect-codes";
import { runSyncJob, type SyncDelta, type SyncJobInput } from "./sync-job";

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

/** The Item's status, or null if the read failed: that can't fail a sync. */
async function readItemStatus(connectionId: number) {
  try {
    return await plaidService.getItemStatus(connectionId);
  } catch (err) {
    DBOS.logger.warn(
      `Item status read failed for connection ${connectionId}: ${readFailure(err).message}`,
    );
    return null;
  }
}

interface PlaidSyncInput extends SyncJobInput {
  /**
   * Set when this sync was dispatched straight after Link (new connection or
   * reauth). Plaid's pull from the bank is still in flight at that point, so
   * the workflow retries on a backoff rather than reporting an empty success.
   */
  awaitUpstreamPull?: boolean;
}

export class PlaidTransactionSyncWorkflow {
  @DBOS.step()
  static async runSync(connectionId: number) {
    return plaidService.syncTransactions(connectionId);
  }

  /**
   * Timestamp of Plaid's last successful transactions pull, or null if it has
   * never pulled (or the status read failed — in which case we fall back to
   * the status-based check, which errs towards not blocking).
   */
  @DBOS.step()
  static async readLastSuccessfulUpdate(
    connectionId: number,
  ): Promise<number | null> {
    const status = await readItemStatus(connectionId);
    return status?.lastSuccessfulUpdate?.getTime() ?? null;
  }

  /** Fails the sync if something is wrong with the Item that needs the user. */
  @DBOS.step()
  static async checkItemFreshness(connectionId: number) {
    const status = await readItemStatus(connectionId);
    if (!status) return;

    // Report Plaid's real code, and only one the user can clear: parking a
    // connection over a passing outage would stop it recovering by itself.
    const itemErrorCode = status.itemError?.error_code;
    if (itemErrorCode && needsUserAction(itemErrorCode)) {
      throw new SyncFailure(ITEM_ERROR_USER_MESSAGE, itemErrorCode);
    }

    const { lastSuccessfulUpdate, lastFailedUpdate, itemCreatedAt } = status;
    const isFailing =
      lastFailedUpdate !== null &&
      (lastSuccessfulUpdate === null ||
        lastFailedUpdate > lastSuccessfulUpdate);

    if (!isFailing) return;

    const baseline = lastSuccessfulUpdate ?? itemCreatedAt;
    const ageMs = baseline ? Date.now() - baseline.getTime() : Infinity;
    if (ageMs <= STALE_THRESHOLD_MS) return;

    DBOS.logger.info(
      `Plaid upstream pull stale: last_successful_update=${lastSuccessfulUpdate?.toISOString() ?? "never"} ` +
        `(${Math.round(ageMs / (60 * 60 * 1000))}h ago), last_failed_update=${lastFailedUpdate?.toISOString() ?? "never"}`,
    );
    throw new SyncFailure(STALE_USER_MESSAGE, "STALE_DATA");
  }

  private static async syncUntilPulled(
    connectionId: number,
    cursor: string | null,
  ): Promise<SyncDelta> {
    // A reauth must see Plaid run a fresh pull, which
    // transactions_update_status cannot express, so note where Plaid stands
    // before the first sync. A saved cursor is what marks a reauth.
    // last_successful_update can't: Plaid often finishes a new Item's pull
    // before Link closes, and then won't pull again for hours. Brokerages
    // never get a cursor, so they don't wait either.
    const baseline = cursor
      ? await PlaidTransactionSyncWorkflow.readLastSuccessfulUpdate(connectionId)
      : null;

    const total = { added: 0, modified: 0, removed: 0 };

    for (const delayMs of [0, ...UPSTREAM_PULL_RETRY_DELAYS_MS]) {
      if (delayMs > 0) await DBOS.sleep(delayMs);

      const { added, modified, removed, updateStatus } =
        await PlaidTransactionSyncWorkflow.runSync(connectionId);
      total.added += added;
      total.modified += modified;
      total.removed += removed;

      const current =
        await PlaidTransactionSyncWorkflow.readLastSuccessfulUpdate(connectionId);
      if (isPullComplete({ updateStatus, baseline, current })) return total;

      DBOS.logger.info(
        `Connection ${connectionId}: upstream pull not complete ` +
          `(status=${updateStatus ?? "unknown"})`,
      );
    }

    // Never report success on a pull that never finished — that is what
    // made an unfinished sync indistinguishable from an empty one. The
    // code is deliberately not a disconnect code, so the poller keeps
    // retrying and no reconnect email or prompt is raised.
    throw new SyncFailure(UPSTREAM_NOT_READY_MESSAGE, "UPSTREAM_NOT_READY");
  }

  @DBOS.workflow()
  static async run(input: PlaidSyncInput): Promise<SyncDelta | null> {
    const { connectionId, awaitUpstreamPull } = input;

    return runSyncJob(input, async ({ transactionCursor }) => {
      // No freshness check right after Link: the Item legitimately looks stale
      // until Plaid's first post-reauth pull lands.
      if (awaitUpstreamPull) {
        return PlaidTransactionSyncWorkflow.syncUntilPulled(
          connectionId,
          transactionCursor,
        );
      }

      const result = await PlaidTransactionSyncWorkflow.runSync(connectionId);

      // Nor on an initial sync: Plaid hasn't run a background pull yet, so
      // last_successful_update may be unset.
      if (transactionCursor !== null) {
        await PlaidTransactionSyncWorkflow.checkItemFreshness(connectionId);
      }

      return result;
    });
  }
}
