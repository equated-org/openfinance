import { DBOS } from "@dbos-inc/dbos-sdk";
import { db } from "../db";
import { user as userTable } from "../schema";
import { eq } from "drizzle-orm";
import { SyncFailure } from "../lib/sync/disconnect-codes";
import { mxService } from "../lib/sync/mx.service";
import { runSyncJob, type SyncDelta, type SyncJobInput } from "./sync-job";

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
  static async runSync(params: {
    connectionId: number;
    userGuid: string;
    memberGuid: string;
    fromDate?: string;
  }) {
    return mxService.syncTransactions(params);
  }

  /**
   * Checks MX member connection status. Returns the bad status string
   * (e.g. "EXPIRED") if the member is in a non-syncable state, or null
   * if the member is healthy or the check failed, so the sync goes ahead.
   */
  @DBOS.step()
  static async checkMemberStatus(
    connectionId: number,
    userGuid: string,
    memberGuid: string,
  ): Promise<string | null> {
    try {
      const member = await mxService.getMemberStatus(userGuid, memberGuid);
      if (BAD_MEMBER_STATUSES.includes(member.connection_status)) {
        return member.connection_status;
      }
    } catch (err) {
      DBOS.logger.warn(
        `Failed to check MX member status for connection ${connectionId}, proceeding with sync: ${err}`,
      );
    }
    return null;
  }

  @DBOS.step()
  static async getUserGuid(userId: string): Promise<string | null> {
    const [row] = await db
      .select({ mxUserGuid: userTable.mxUserGuid })
      .from(userTable)
      .where(eq(userTable.id, userId))
      .limit(1);
    return row?.mxUserGuid ?? null;
  }

  @DBOS.workflow()
  static async run(input: SyncJobInput): Promise<SyncDelta | null> {
    const { connectionId, userId } = input;

    return runSyncJob(input, async ({ mxMemberGuid, lastSyncedAt }) => {
      if (!mxMemberGuid) {
        throw new SyncFailure("Connection is missing its MX member GUID");
      }

      const userGuid = await MxTransactionSyncWorkflow.getUserGuid(userId);
      if (!userGuid) {
        throw new SyncFailure("User does not have an MX user GUID");
      }

      const badStatus = await MxTransactionSyncWorkflow.checkMemberStatus(
        connectionId,
        userGuid,
        mxMemberGuid,
      );
      if (badStatus) {
        throw new SyncFailure(
          `MX member ${badStatus}`,
          badStatus === "CHALLENGED"
            ? "ITEM_LOGIN_REQUIRED"
            : "CONNECTION_EXPIRED",
        );
      }

      const { added } = await MxTransactionSyncWorkflow.runSync({
        connectionId,
        userGuid,
        memberGuid: mxMemberGuid,
        // Use lastSyncedAt as fromDate for incremental syncs
        fromDate: lastSyncedAt?.toISOString().split("T")[0],
      });

      return { added, modified: 0, removed: 0 };
    });
  }
}
