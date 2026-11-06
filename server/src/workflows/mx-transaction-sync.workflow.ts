import { DBOS } from "@dbos-inc/dbos-sdk";
import { db } from "../db";
import { accountConnections, syncJobs } from "../schema";
import { eq } from "drizzle-orm";
import { mxService } from "../lib/sync/mx.service";
import { notificationService } from "../lib/notification.service";

const BAD_MEMBER_STATUSES = [
  "EXPIRED",
  "DENIED",
  "DISABLED",
  "IMPEDED",
  "DISCONNECTED",
  "REJECTED",
  "CHALLENGED",
  "CLOSED",
];

export class MxTransactionSyncWorkflow {
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
    userGuid: string;
    memberGuid: string;
    fromDate?: string;
  }) {
    return mxService.syncTransactions(params);
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

  /**
   * Checks MX member connection status. Returns the bad status string
   * (e.g. "EXPIRED") if the member is in a non-syncable state, or null
   * if the member is healthy.
   */
  @DBOS.step()
  static async checkMemberStatus(
    userGuid: string,
    memberGuid: string,
  ): Promise<string | null> {
    const member = await mxService.getMemberStatus(userGuid, memberGuid);
    if (BAD_MEMBER_STATUSES.includes(member.connection_status)) {
      return member.connection_status;
    }
    return null;
  }

  @DBOS.step()
  static async getUserGuid(userId: string): Promise<string | null> {
    const { user: userTable } = await import("../schema");
    const [row] = await db
      .select({ mxUserGuid: userTable.mxUserGuid })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1);
    return row?.mxUserGuid ?? null;
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

    await MxTransactionSyncWorkflow.markStarted(syncJobId);

    const connection =
      await MxTransactionSyncWorkflow.fetchConnection(connectionId);

    if (!connection || !connection.mxMemberGuid) {
      await MxTransactionSyncWorkflow.markError(
        syncJobId,
        "Connection not found or missing MX member GUID",
      );
      return null;
    }

    const userGuid = await MxTransactionSyncWorkflow.getUserGuid(userId);
    if (!userGuid) {
      await MxTransactionSyncWorkflow.markError(
        syncJobId,
        "User does not have an MX user GUID",
      );
      return null;
    }

    // Check MX member status before attempting sync
    try {
      const badStatus = await MxTransactionSyncWorkflow.checkMemberStatus(
        userGuid,
        connection.mxMemberGuid,
      );

      if (badStatus) {
        const message = `MX member ${badStatus}`;
        const errorCode =
          badStatus === "CHALLENGED"
            ? "ITEM_LOGIN_REQUIRED"
            : "CONNECTION_EXPIRED";
        await MxTransactionSyncWorkflow.markError(
          syncJobId,
          message,
          errorCode,
        );
        await MxTransactionSyncWorkflow.notifyDisconnect(
          userId,
          connectionId,
          message,
        );
        return null;
      }
    } catch (err) {
      DBOS.logger.warn(
        `Failed to check MX member status for connection ${connectionId}, proceeding with sync: ${err}`,
      );
    }

    try {
      // Use lastSyncedAt as fromDate for incremental syncs
      const fromDate = connection.lastSyncedAt
        ? connection.lastSyncedAt.toISOString().split("T")[0]
        : undefined;

      const result = await MxTransactionSyncWorkflow.runSync({
        connectionId,
        userGuid,
        memberGuid: connection.mxMemberGuid,
        fromDate,
      });

      await MxTransactionSyncWorkflow.markComplete(syncJobId, result.added);
      if (result.added > 0) {
        await MxTransactionSyncWorkflow.notifySync(
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
      await MxTransactionSyncWorkflow.markError(syncJobId, message);
      DBOS.logger.error(
        `MX transaction sync failed for connection ${connectionId}: ${message}`,
      );

      return null;
    }
  }
}
