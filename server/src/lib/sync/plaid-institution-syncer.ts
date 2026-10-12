import { db } from "../../db.js";
import { institutionRegistry } from "$lib/sql/institution-registry.sql";
import { sql, inArray, eq } from "drizzle-orm";
import { subDays } from "date-fns";
import type { InstitutionSyncer } from "./institution-syncer.interface";
import type { NewInstitutionRegistry } from "$lib/sql/institution-registry.sql";
import {
  buildConflictUpdateColumns,
  getInstitutionRegistryUpdateColumns,
} from "./batch-upsert.helpers.js";
import {
  plaidClient,
  streamAllPlaidInstitutions,
  type PlaidInstitution,
} from "$lib/sync/plaid.client.js";

/**
 * Handles syncing institutions from Plaid to the institution registry
 */
export class PlaidInstitutionSyncer implements InstitutionSyncer {
  getProviderName(): string {
    return "plaid";
  }

  /**
   * Refresh institutions from Plaid and sync to database using streaming approach
   */
  async refreshInstitutions(limit?: number): Promise<void> {
    console.log(
      `Starting Plaid institutions sync with streaming upsert approach${
        limit ? ` (limited to ${limit} institutions)` : ""
      }...`,
    );

    let totalInstitutions = 0;
    let totalBatches = 0;
    const currentPlaidInstitutionIds = new Set<string>();

    try {
      // Upsert each batch outside a transaction to avoid long-lived connections
      for await (const plaidInstitutionBatch of streamAllPlaidInstitutions({
        batchSize: 500,
        limit,
        onProgress: (current, total, institutions) => {
          console.log(
            `Fetching Plaid institutions... Page ${current}/${total} (${institutions} institutions so far)${
              limit ? ` [limited to ${limit}]` : ""
            }`,
          );
        },
      })) {
        const registryRecords = this.convertPlaidInstitutionsToRegistryFormat(
          plaidInstitutionBatch,
        );

        const validInstitutions = registryRecords
          .filter((institution) => institution.plaidData?.institutionId)
          .map((institution) => {
            const compositeKey = `plaid_${institution.plaidData!.institutionId}`;
            currentPlaidInstitutionIds.add(
              institution.plaidData!.institutionId,
            );

            return {
              ...institution,
              providerCompositeKey: compositeKey,
              lastSynced: new Date(),
              updatedAt: new Date(),
            };
          });

        if (validInstitutions.length > 0) {
          await db
            .insert(institutionRegistry)
            .values(validInstitutions)
            .onConflictDoUpdate({
              target: institutionRegistry.providerCompositeKey,
              set: buildConflictUpdateColumns(
                institutionRegistry,
                getInstitutionRegistryUpdateColumns() as any,
              ),
            });

          totalInstitutions += validInstitutions.length;
          console.log(
            `Batch ${totalBatches + 1}: Upserted ${validInstitutions.length} Plaid institutions`,
          );
        }

        totalBatches++;
      }

      // Delete stale institutions in a short transaction
      if (limit) {
        console.log(
          `Skipping stale institution deletion because limit=${limit} was set (partial sync)`,
        );
      } else if (currentPlaidInstitutionIds.size > 0) {
        await db.transaction(async (tx) => {
          const staleInstitutions = await tx
            .select({
              id: institutionRegistry.id,
              plaidData: institutionRegistry.plaidData,
            })
            .from(institutionRegistry)
            .where(sql`${institutionRegistry.plaidData} IS NOT NULL`);

          const staleIds = staleInstitutions
            .filter((inst) => {
              const institutionId = inst.plaidData?.institutionId;
              return (
                institutionId && !currentPlaidInstitutionIds.has(institutionId)
              );
            })
            .map((inst) => inst.id);

          if (staleIds.length > 0) {
            await tx
              .delete(institutionRegistry)
              .where(inArray(institutionRegistry.id, staleIds));
            console.log(`Removed ${staleIds.length} stale Plaid institutions`);
          }
        });
      }

      if (totalInstitutions === 0) {
        throw new Error(
          "No institutions fetched from Plaid - aborting database update to prevent data loss",
        );
      }

      console.log(
        `Successfully synced ${totalInstitutions} Plaid institutions to database in ${totalBatches} batches`,
      );
    } catch (error) {
      console.error("Error during Plaid institutions sync:", error);
      throw new Error(`Failed to sync Plaid institutions: ${error}`);
    }
  }

  /**
   * Convert Plaid institutions to registry format
   */
  private convertPlaidInstitutionsToRegistryFormat(
    institutions: PlaidInstitution[],
  ): NewInstitutionRegistry[] {
    return institutions.map((plaidInstitution) => ({
      name: plaidInstitution.name,
      logo: plaidInstitution.logo || null,
      primaryColor: plaidInstitution.primary_color || null,
      url: plaidInstitution.url || null,
      countryCode: plaidInstitution.country_codes?.[0] || "US",
      providerCompositeKey: `plaid_${plaidInstitution.institution_id}`,
      plaidData: {
        institutionId: plaidInstitution.institution_id,
        countryCodes: plaidInstitution.country_codes,
        oauth: plaidInstitution.oauth || false,
        products: plaidInstitution.products || [],
        routingNumbers: plaidInstitution.routing_numbers || [],
      },
      mxData: null,
      lastSynced: new Date(),
    }));
  }

  /**
   * Update connection status for all plaid institutions
   */
  async updateConnectionHealthStatus(): Promise<void> {
    console.log("Starting status update for all Plaid institutions...");

    try {
      const oneDayAgo = subDays(new Date(), 1);
      const allInstitutions = await db
        .select({
          id: institutionRegistry.id,
          name: institutionRegistry.name,
          plaidData: institutionRegistry.plaidData,
        })
        .from(institutionRegistry)
        .where(
          sql`${institutionRegistry.plaidData} IS NOT NULL AND ${institutionRegistry.updatedAt} <= ${oneDayAgo}`,
        );

      console.log(
        `Found ${allInstitutions.length} Plaid institutions to update status for`,
      );

      let successCount = 0;
      let errorCount = 0;
      const BATCH_DELAY_MS = 500;
      const DATABASE_BATCH_SIZE = 20;
      const RATE_LIMIT_BATCH_SIZE = 10;

      interface UpdateBatch {
        id: number;
        name: string;
        plaidData: any;
        connectionHealth: any;
      }
      let updateBatch: UpdateBatch[] = [];

      for (let index = 0; index < allInstitutions.length; index++) {
        const institution = allInstitutions[index];
        const processed = index + 1;
        const total = allInstitutions.length;

        if (index > 0 && index % RATE_LIMIT_BATCH_SIZE === 0) {
          console.log(
            `Processing institutions: ${processed}/${total} (${Math.ceil(processed / RATE_LIMIT_BATCH_SIZE)}/${Math.ceil(total / RATE_LIMIT_BATCH_SIZE)} batches)`,
          );
          await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
        }

        const plaidData = institution.plaidData as any;
        if (!plaidData?.institutionId) {
          console.warn(
            `Institution ${institution.name} has no Plaid institution ID, skipping`,
          );
          continue;
        }

        try {
          const response = await plaidClient.institutionsGetById({
            institution_id: plaidData.institutionId,
            country_codes: plaidData.countryCodes || ["US"],
            options: {
              include_optional_metadata: true,
              include_status: true,
            },
          });

          const plaidInstitution = response.data.institution;
          const connectionHealth = getConnectionHealth(plaidInstitution);

          if (connectionHealth) {
            updateBatch.push({
              id: institution.id,
              name: institution.name,
              plaidData,
              connectionHealth,
            });

            successCount++;

            if (updateBatch.length >= DATABASE_BATCH_SIZE) {
              await this.flushUpdateBatch(updateBatch);
              updateBatch = [];
            }
          } else {
            console.log(`No status data available for ${institution.name}`);
          }
        } catch (error: any) {
          const errorMessage =
            error.response?.data?.error_message || error.message;
          console.error(
            `Failed to fetch status for ${institution.name}: ${errorMessage}`,
          );
          errorCount++;
        }
      }

      await this.flushUpdateBatch(updateBatch);

      console.log(
        `Status update completed: ${successCount} succeeded, ${errorCount} failed`,
      );
    } catch (error) {
      console.error("Error during status update:", error);
      throw new Error(`Failed to update Plaid institution status: ${error}`);
    }
  }

  private async flushUpdateBatch(
    batch: Array<{
      id: number;
      name: string;
      plaidData: any;
      connectionHealth: any;
    }>,
  ): Promise<void> {
    if (batch.length === 0) return;

    try {
      await db.transaction(async (tx) => {
        for (const update of batch) {
          await tx
            .update(institutionRegistry)
            .set({
              plaidData: {
                ...update.plaidData,
                connectionHealth: update.connectionHealth,
              },
              updatedAt: new Date(),
            })
            .where(eq(institutionRegistry.id, update.id));
        }
      });

      console.log(`Batch updated ${batch.length} institutions in database`);
    } catch (error) {
      console.error(
        `Batch update failed for ${batch.length} institutions:`,
        error,
      );
    }
  }
}

// Extracts the institution connection health from Plaid institution details
// Returns undefined if status is not present
export function getConnectionHealth(plaidInstitution: PlaidInstitution) {
  if (!plaidInstitution?.status) {
    return undefined;
  }

  const status = plaidInstitution.status;

  return {
    item_logins: status.item_logins
      ? {
          status: status.item_logins.status,
          last_status_change: status.item_logins.last_status_change,
          breakdown: {
            success: status.item_logins.breakdown?.success || 0,
            error_institution:
              status.item_logins.breakdown?.error_institution || 0,
            error_plaid: status.item_logins.breakdown?.error_plaid || 0,
          },
        }
      : undefined,
    transactions_updates: status.transactions_updates
      ? {
          status: status.transactions_updates.status,
          last_status_change: status.transactions_updates.last_status_change,
          breakdown: {
            success: status.transactions_updates.breakdown?.success || 0,
            error_institution:
              status.transactions_updates.breakdown?.error_institution || 0,
            error_plaid:
              status.transactions_updates.breakdown?.error_plaid || 0,
            refresh_interval:
              status.transactions_updates.breakdown?.refresh_interval,
          },
        }
      : undefined,
    lastUpdated: new Date().toISOString(),
  };
}
