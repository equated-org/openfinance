import { DBOS, SchedulerMode } from "@dbos-inc/dbos-sdk";
import { PlaidInstitutionSyncer } from "$lib/sync/plaid-institution-syncer.js";
import { MXInstitutionSyncer } from "$lib/sync/mx-institution-syncer.js";
import { isMxConfigured } from "$lib/sync/mx.client.js";
import { scheduledJobsDisabled } from "$lib/utils.js";

interface InstitutionSyncResult {
  success: boolean;
  message: string;
  providersRefreshed: string[];
  healthStatusUpdated: boolean;
  errors?: string[];
  timestamp: string;
}

export class InstitutionSyncWorkflow {
  /**
   * Scheduled workflow: runs every 48 hours at 3 AM UTC
   */
  @DBOS.scheduled({
    crontab: "0 3 */2 * *",
    mode: SchedulerMode.ExactlyOncePerIntervalWhenActive,
  })
  @DBOS.workflow()
  static async syncInstitutionsWorkflow(
    schedTime?: Date,
    _atTime?: Date,
  ): Promise<InstitutionSyncResult> {
    if (schedTime && scheduledJobsDisabled()) {
      DBOS.logger.info(
        "Skipping scheduled institution sync: DISABLE_SCHEDULED_JOBS is set",
      );
      return {
        success: true,
        message: "Skipped: scheduled jobs are disabled",
        providersRefreshed: [],
        healthStatusUpdated: false,
        timestamp: new Date().toISOString(),
      };
    }

    DBOS.logger.info(
      `Starting institution sync workflow (scheduled: ${schedTime?.toISOString() ?? "manual"})`,
    );

    // Add jitter delay for scheduled runs to avoid API overload
    if (schedTime) {
      const jitterMs = (Math.floor(Math.random() * 16) + 5) * 60 * 1000; // 5–20 minutes
      DBOS.logger.info(
        `Applying jitter delay of ${Math.round(jitterMs / 60000)} minutes for scheduled run`,
      );
      await DBOS.sleep(jitterMs);
    }

    const errors: string[] = [];
    const providersRefreshed: string[] = [];
    let healthStatusUpdated = false;

    // Step 1: Refresh institutions from Plaid
    try {
      await InstitutionSyncWorkflow.refreshPlaidInstitutions();
      providersRefreshed.push("plaid");
    } catch (error: any) {
      const errorMessage = `Failed to refresh Plaid institutions: ${error.message}`;
      DBOS.logger.error(errorMessage);
      errors.push(errorMessage);
    }

    // Step 2: Refresh institutions from MX (skip if not configured)
    if (isMxConfigured()) {
      try {
        await InstitutionSyncWorkflow.refreshMxInstitutions();
        providersRefreshed.push("mx");
      } catch (error: any) {
        const errorMessage = `Failed to refresh MX institutions: ${error.message}`;
        DBOS.logger.error(errorMessage);
        errors.push(errorMessage);
      }
    } else {
      DBOS.logger.info("Skipping MX institution sync: MX is not configured");
    }

    // Step 3: Update connection health status
    try {
      await InstitutionSyncWorkflow.updateConnectionHealthStatus();
      healthStatusUpdated = true;
    } catch (error: any) {
      const errorMessage = `Failed to update connection health status: ${error.message}`;
      DBOS.logger.error(errorMessage);
      errors.push(errorMessage);
    }

    const success = errors.length === 0;

    const result: InstitutionSyncResult = {
      success,
      message: success
        ? "Institution sync completed successfully"
        : `Partial failure: ${errors.length} error(s) occurred`,
      providersRefreshed,
      healthStatusUpdated,
      errors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString(),
    };

    DBOS.logger.info(
      `Institution sync workflow completed: success=${success}, providers=${providersRefreshed.join(",")}, healthUpdated=${healthStatusUpdated}, errors=${errors.length}`,
    );

    return result;
  }

  @DBOS.step()
  static async refreshPlaidInstitutions(): Promise<void> {
    const syncer = new PlaidInstitutionSyncer();
    await syncer.refreshInstitutions();
  }

  @DBOS.step()
  static async refreshMxInstitutions(): Promise<void> {
    const syncer = new MXInstitutionSyncer();
    await syncer.refreshInstitutions();
  }

  @DBOS.step()
  static async updateConnectionHealthStatus(): Promise<void> {
    const syncer = new PlaidInstitutionSyncer();
    await syncer.updateConnectionHealthStatus();
  }
}
