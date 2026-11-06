import { DBOS } from "@dbos-inc/dbos-sdk";
import { db } from "../db";
import { user as userTable } from "../schema";
import { eq } from "drizzle-orm";
import { SyncFailure } from "../lib/sync/disconnect-codes";
import { quilttService } from "../lib/sync/quiltt.service";
import { runSyncJob, type SyncDelta, type SyncJobInput } from "./sync-job";

export class QuilttTransactionSyncWorkflow {
  @DBOS.step()
  static async getQuilttProfileId(userId: string): Promise<string | null> {
    const [row] = await db
      .select({ quilttProfileId: userTable.quilttProfileId })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1);
    return row?.quilttProfileId ?? null;
  }

  /** Waits for Quiltt to finish with the bank. A failed check isn't a failed sync. */
  @DBOS.step()
  static async waitForSync(
    connectionId: number,
    profileId: string,
    quilttConnectionId: string,
  ): Promise<{ status: string; ready: boolean }> {
    try {
      return await quilttService.waitForConnectionSync(
        profileId,
        quilttConnectionId,
        { maxAttempts: 60, intervalMs: 5000 }, // Wait up to 5 minutes
      );
    } catch (err) {
      DBOS.logger.warn(
        `Failed to check Quiltt connection status for connection ${connectionId}, proceeding with sync: ${err}`,
      );
      return { status: "UNKNOWN", ready: true };
    }
  }

  @DBOS.step()
  static async runSync(params: {
    connectionId: number;
    quilttConnectionId: string;
    quilttProfileId: string;
  }) {
    return quilttService.syncTransactions(params);
  }

  @DBOS.workflow()
  static async run(input: SyncJobInput): Promise<SyncDelta | null> {
    const { connectionId, userId } = input;

    return runSyncJob(input, async ({ quilttConnectionId }) => {
      if (!quilttConnectionId) {
        throw new SyncFailure("Connection is missing its Quiltt connection ID");
      }

      const quilttProfileId =
        await QuilttTransactionSyncWorkflow.getQuilttProfileId(userId);
      if (!quilttProfileId) {
        throw new SyncFailure("User does not have a Quiltt profile ID");
      }

      const { status, ready } = await QuilttTransactionSyncWorkflow.waitForSync(
        connectionId,
        quilttProfileId,
        quilttConnectionId,
      );
      if (!ready) {
        throw status === "ERROR_REPAIRABLE"
          ? new SyncFailure(
              "Your bank connection needs attention. Please reconnect your account.",
              "CONNECTION_EXPIRED",
            )
          : new SyncFailure(
              `Connection sync failed with status: ${status}`,
              "SYNC_ERROR",
            );
      }

      const { added } = await QuilttTransactionSyncWorkflow.runSync({
        connectionId,
        quilttConnectionId,
        quilttProfileId,
      });

      return { added, modified: 0, removed: 0 };
    });
  }
}
