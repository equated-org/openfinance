import { DBOS } from "@dbos-inc/dbos-sdk";
import { db } from "../db";
import { accountConnections, syncJobs } from "../schema";
import { eq } from "drizzle-orm";
import { quilttService } from "../lib/sync/quiltt.service";
import { notificationService } from "../lib/notification.service";

export class QuilttTransactionSyncWorkflow {
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
  static async getQuilttProfileId(userId: string): Promise<string | null> {
    const { user: userTable } = await import("../schema");
    const [row] = await db
      .select({ quilttProfileId: userTable.quilttProfileId })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1);
    return row?.quilttProfileId ?? null;
  }

  @DBOS.step()
  static async waitForSync(
    profileId: string,
    quilttConnectionId: string,
  ): Promise<{ status: string; ready: boolean }> {
    return quilttService.waitForConnectionSync(
      profileId,
      quilttConnectionId,
      { maxAttempts: 60, intervalMs: 5000 }, // Wait up to 5 minutes
    );
  }

  @DBOS.step()
  static async runSync(params: {
    connectionId: number;
    quilttConnectionId: string;
    quilttProfileId: string;
  }) {
    return quilttService.syncTransactions(params);
  }

  @DBOS.step()
  static async markStarted(syncJobId: number) {
    await db
      .update(syncJobs)
      .set({ startedAt: new Date(), updatedAt: new Date() })
      .where(eq(syncJobs.id, syncJobId));
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
  }): Promise<{ added: number; modified: number; removed: number } | null> {
    const { connectionId, userId, syncJobId } = input;

    await QuilttTransactionSyncWorkflow.markStarted(syncJobId);

    const connection =
      await QuilttTransactionSyncWorkflow.fetchConnection(connectionId);

    if (!connection || !connection.quilttConnectionId) {
      await QuilttTransactionSyncWorkflow.markError(
        syncJobId,
        "Connection not found or missing Quiltt connection ID",
      );
      return null;
    }

    const profileId =
      await QuilttTransactionSyncWorkflow.getQuilttProfileId(userId);
    if (!profileId) {
      await QuilttTransactionSyncWorkflow.markError(
        syncJobId,
        "User does not have a Quiltt profile ID",
      );
      return null;
    }

    // Wait for Quiltt connection to finish syncing with upstream provider
    try {
      const syncStatus = await QuilttTransactionSyncWorkflow.waitForSync(
        profileId,
        connection.quilttConnectionId,
      );

      if (!syncStatus.ready) {
        const isRepairable = syncStatus.status === "ERROR_REPAIRABLE";
        const errorCode = isRepairable ? "CONNECTION_EXPIRED" : "SYNC_ERROR";
        const message = isRepairable
          ? "Your bank connection needs attention. Please reconnect your account."
          : `Connection sync failed with status: ${syncStatus.status}`;

        await QuilttTransactionSyncWorkflow.markError(
          syncJobId,
          message,
          errorCode,
        );

        if (isRepairable) {
          await QuilttTransactionSyncWorkflow.notifyDisconnect(
            userId,
            connectionId,
            message,
          );
        }

        return null;
      }
    } catch (err) {
      DBOS.logger.warn(
        `Failed to check Quiltt connection status for connection ${connectionId}, proceeding with sync: ${err}`,
      );
    }

    try {
      const result = await QuilttTransactionSyncWorkflow.runSync({
        connectionId,
        quilttConnectionId: connection.quilttConnectionId,
        quilttProfileId: profileId,
      });

      await QuilttTransactionSyncWorkflow.markComplete(syncJobId, result.added);
      if (result.added > 0) {
        await QuilttTransactionSyncWorkflow.notifySync(
          userId,
          connectionId,
          result.added,
          0,
          0,
        );
      }
      return { added: result.added, modified: 0, removed: 0 };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown sync error";
      await QuilttTransactionSyncWorkflow.markError(syncJobId, message);
      DBOS.logger.error(
        `Quiltt transaction sync failed for connection ${connectionId}: ${message}`,
      );

      return null;
    }
  }
}
