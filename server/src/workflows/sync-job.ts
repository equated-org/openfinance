/**
 * The life of a sync job, shared by every provider workflow. A provider only
 * says how to sync, and fails by throwing. The failure's code then decides what
 * happens next, so that rule lives here once.
 */
import { DBOS } from "@dbos-inc/dbos-sdk";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { accountConnections, syncJobs, type AccountConnection } from "../schema";
import {
  needsUserAction,
  readFailure,
  SyncFailure,
} from "../lib/sync/disconnect-codes";
import { notificationService } from "../lib/notification.service";

export interface SyncJobInput {
  connectionId: number;
  userId: string;
  syncJobId: number;
}

export interface SyncDelta {
  added: number;
  modified: number;
  removed: number;
}

type SyncConnection = Pick<
  AccountConnection,
  "transactionCursor" | "mxMemberGuid" | "quilttConnectionId" | "lastSyncedAt"
>;

class SyncJobSteps {
  /** Named columns: DBOS stores this result, and the row holds access tokens. */
  @DBOS.step()
  static async fetchConnection(
    connectionId: number,
  ): Promise<SyncConnection | null> {
    const rows = await db
      .select({
        transactionCursor: accountConnections.transactionCursor,
        mxMemberGuid: accountConnections.mxMemberGuid,
        quilttConnectionId: accountConnections.quilttConnectionId,
        lastSyncedAt: accountConnections.lastSyncedAt,
      })
      .from(accountConnections)
      .where(eq(accountConnections.id, connectionId))
      .limit(1);
    return rows[0] ?? null;
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
    errorMessage: string,
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
    delta: SyncDelta,
  ) {
    try {
      await notificationService.logTransactionSync({
        userId,
        connectionId,
        ...delta,
      });
    } catch (e) {
      DBOS.logger.error(
        `Failed to log sync notification for connection ${connectionId}: ${e}`,
      );
    }
  }
}

/** Runs `sync` as a job, returning what changed or null if it failed. */
export async function runSyncJob(
  input: SyncJobInput,
  sync: (connection: SyncConnection) => Promise<SyncDelta>,
): Promise<SyncDelta | null> {
  const { connectionId, userId, syncJobId } = input;

  await SyncJobSteps.markStarted(syncJobId);

  try {
    const connection = await SyncJobSteps.fetchConnection(connectionId);
    if (!connection) throw new SyncFailure("Connection not found");

    const { added, modified, removed } = await sync(connection);
    const delta = { added, modified, removed };
    const total = added + modified + removed;

    await SyncJobSteps.markComplete(syncJobId, total);
    if (total > 0) {
      await SyncJobSteps.notifySync(userId, connectionId, delta);
    }
    return delta;
  } catch (err) {
    const { errorCode, message } = readFailure(err);

    await SyncJobSteps.markError(syncJobId, message, errorCode);
    DBOS.logger.error(
      `Sync failed for connection ${connectionId}: ` +
        `${errorCode ?? "UNKNOWN"} — ${message}`,
    );

    if (needsUserAction(errorCode)) {
      await SyncJobSteps.notifyDisconnect(userId, connectionId, message);
    }

    return null;
  }
}
