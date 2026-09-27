/**
 * Transaction Poll Workflow
 *
 * Scheduled workflow that runs every 30 minutes to sync transactions for all
 * active account connections. Dispatches to provider-specific sync workflows
 * (Plaid cursor-based, MX date-filtered) with jitter to spread API load.
 */
import { DBOS, SchedulerMode } from "@dbos-inc/dbos-sdk";
import { db } from "../db";
import { accountConnections, syncJobs } from "../schema";
import { desc, eq, inArray } from "drizzle-orm";
import { PlaidTransactionSyncWorkflow } from "./plaid-transaction-sync.workflow";
import { MxTransactionSyncWorkflow } from "./mx-transaction-sync.workflow";
import { QuilttTransactionSyncWorkflow } from "./quiltt-transaction-sync.workflow";
import { shouldStopPolling } from "../lib/sync/disconnect-codes";
import { scheduledJobsDisabled } from "../lib/utils";

interface PollResult {
  connectionsProcessed: number;
  errors: string[];
}

interface ConnectionSyncDelta {
  added: number;
  modified: number;
  removed: number;
}

interface AggregateDeltas {
  added: number;
  modified: number;
  removed: number;
  changedConnections: number;
}

export class TransactionPollWorkflow {
  @DBOS.scheduled({
    crontab: "*/30 * * * *",
    mode: SchedulerMode.ExactlyOncePerIntervalWhenActive,
  })
  @DBOS.workflow()
  static async pollTransactions(
    schedTime?: Date,
    _atTime?: Date,
  ): Promise<PollResult> {
    if (schedTime && scheduledJobsDisabled()) {
      DBOS.logger.info(
        "Skipping scheduled transaction poll: DISABLE_SCHEDULED_JOBS is set",
      );
      return { connectionsProcessed: 0, errors: [] };
    }

    DBOS.logger.debug(
      `Starting transaction poll workflow (scheduled: ${schedTime?.toISOString() ?? "manual"})`,
    );

    // Add jitter (0–5 min) to spread API load
    if (schedTime) {
      const jitterMs = Math.floor(Math.random() * 5 * 60 * 1000);
      DBOS.logger.debug(
        `Applying jitter delay of ${Math.round(jitterMs / 1000)}s`,
      );
      await DBOS.sleep(jitterMs);
    }

    const connections = await TransactionPollWorkflow.fetchActiveConnections();

    const errors: string[] = [];
    const deltas: ConnectionSyncDelta[] = [];

    for (const connection of connections) {
      try {
        const syncJob = await TransactionPollWorkflow.createSyncJob(connection);

        if (connection.provider === "plaid") {
          const handle = await DBOS.startWorkflow(
            PlaidTransactionSyncWorkflow,
          ).run({
            connectionId: connection.id,
            userId: connection.userId,
            syncJobId: syncJob.id,
          });
          const result = await handle.getResult();
          if (result) deltas.push(result);
        } else if (connection.provider === "mx") {
          const handle = await DBOS.startWorkflow(
            MxTransactionSyncWorkflow,
          ).run({
            connectionId: connection.id,
            userId: connection.userId,
            syncJobId: syncJob.id,
          });
          const result = await handle.getResult();
          if (result) deltas.push(result);
        } else if (connection.provider === "quiltt") {
          const handle = await DBOS.startWorkflow(
            QuilttTransactionSyncWorkflow,
          ).run({
            connectionId: connection.id,
            userId: connection.userId,
            syncJobId: syncJob.id,
          });
          const result = await handle.getResult();
          if (result) deltas.push(result);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        errors.push(
          `Connection ${connection.id} (${connection.provider}): ${message}`,
        );
        DBOS.logger.error(
          `Failed to dispatch sync for connection ${connection.id}: ${message}`,
        );
      }
    }

    const totals = deltas.reduce<AggregateDeltas>(
      (acc, delta) => {
        acc.added += delta.added;
        acc.modified += delta.modified;
        acc.removed += delta.removed;
        if (delta.added > 0 || delta.modified > 0 || delta.removed > 0) {
          acc.changedConnections += 1;
        }
        return acc;
      },
      { added: 0, modified: 0, removed: 0, changedConnections: 0 },
    );

    if (totals.changedConnections === 0) {
      DBOS.logger.info(
        `Transaction poll: no transaction changes across ${connections.length} processed connections (${errors.length} errors)`,
      );
    } else {
      DBOS.logger.info(
        `Transaction poll: +${totals.added} ~${totals.modified} -${totals.removed} across ${totals.changedConnections} changed of ${connections.length} processed (${errors.length} errors)`,
      );
    }

    return { connectionsProcessed: connections.length, errors };
  }

  @DBOS.step()
  static async fetchActiveConnections() {
    const active = await db
      .select()
      .from(accountConnections)
      .where(eq(accountConnections.status, "active"));

    if (active.length === 0) return active;

    const connectionIds = active.map((c) => c.id);

    const latestJobs = await db
      .selectDistinctOn([syncJobs.accountConnectionId], {
        accountConnectionId: syncJobs.accountConnectionId,
        status: syncJobs.status,
        errorCode: syncJobs.errorCode,
      })
      .from(syncJobs)
      .where(inArray(syncJobs.accountConnectionId, connectionIds))
      .orderBy(
        syncJobs.accountConnectionId,
        desc(syncJobs.createdAt),
        desc(syncJobs.id),
      );

    const skipIds = new Set(
      latestJobs
        .filter(
          (j) =>
            j.status === "pending" ||
            (j.status === "error" && shouldStopPolling(j.errorCode)),
        )
        .map((j) => j.accountConnectionId),
    );

    if (skipIds.size > 0) {
      DBOS.logger.info(
        `Skipping ${skipIds.size} connection(s) (pending or disconnected): ${[...skipIds].join(", ")}`,
      );
    }

    return active.filter((c) => !skipIds.has(c.id));
  }

  @DBOS.step()
  static async createSyncJob(
    connection: typeof accountConnections.$inferSelect,
  ) {
    const [syncJob] = await db
      .insert(syncJobs)
      .values({
        userId: connection.userId,
        accountConnectionId: connection.id,
        provider: connection.provider,
        jobType: "transactions",
        status: "pending",
      })
      .returning();

    return syncJob;
  }
}
