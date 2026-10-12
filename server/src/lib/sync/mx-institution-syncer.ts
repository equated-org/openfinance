import { db } from "../../db.js";
import { institutionRegistry } from "$lib/sql/institution-registry.sql.js";
import { sql, inArray } from "drizzle-orm";
import type { InstitutionSyncer } from "./institution-syncer.interface.js";
import {
  buildConflictUpdateColumns,
  getInstitutionRegistryUpdateColumns,
} from "./batch-upsert.helpers.js";
import {
  streamAllMxInstitutions,
  isMxConfigured,
} from "$lib/sync/mx.client.js";

/**
 * Handles syncing institutions from MX to the institution registry
 */
export class MXInstitutionSyncer implements InstitutionSyncer {
  getProviderName(): string {
    return "mx";
  }

  /**
   * Refresh institutions from MX and sync to database using streaming approach
   */
  async refreshInstitutions(limit?: number): Promise<void> {
    if (!isMxConfigured()) {
      console.log("Skipping MX institutions sync: MX is not configured");
      return;
    }

    console.log(
      `Starting MX institutions sync with streaming upsert approach${
        limit ? ` (limited to ${limit} institutions)` : ""
      }...`,
    );

    let totalInstitutions = 0;
    let totalBatches = 0;
    const currentMxInstitutionCodes = new Set<string>();

    try {
      await db.transaction(async (tx) => {
        for await (const mxInstitutionBatch of streamAllMxInstitutions({
          batchSize: 100,
          limit,
          onProgress: (current, total, institutions) => {
            console.log(
              `Fetching MX institutions... Page ${current}/${total} (${institutions} institutions so far)${
                limit ? ` [limited to ${limit}]` : ""
              }`,
            );
          },
        })) {
          const validInstitutions = mxInstitutionBatch
            .filter((institution) => institution.code)
            .map((institution) => {
              const compositeKey = `mx_${institution.code}`;
              currentMxInstitutionCodes.add(institution.code);

              return {
                name: institution.name,
                logo: null,
                primaryColor: null,
                url: institution.url || null,
                countryCode: "US",
                providerCompositeKey: compositeKey,
                plaidData: null,
                mxData: {
                  institutionCode: institution.code,
                  name: institution.name,
                  url: institution.url || null,
                  smallLogoUrl: institution.small_logo_url || null,
                  mediumLogoUrl: institution.medium_logo_url || null,
                  supportsAccountIdentification:
                    institution.supports_account_identification || false,
                  supportsTransactionHistory:
                    institution.supports_transaction_history || false,
                  supportsAccountStatement:
                    institution.supports_account_statement || false,
                  supportsAccountVerification:
                    institution.supports_account_verification || false,
                },
                lastSynced: new Date(),
                updatedAt: new Date(),
              };
            });

          if (validInstitutions.length > 0) {
            await tx
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
          }

          totalBatches++;
        }

        if (limit) {
          console.log(
            `Skipping stale institution deletion because limit=${limit} was set (partial sync)`,
          );
        } else if (currentMxInstitutionCodes.size > 0) {
          const staleInstitutions = await tx
            .select({
              id: institutionRegistry.id,
              mxData: institutionRegistry.mxData,
            })
            .from(institutionRegistry)
            .where(sql`${institutionRegistry.mxData} IS NOT NULL`);

          const staleIds = staleInstitutions
            .filter((inst) => {
              const institutionCode = inst.mxData?.institutionCode;
              return (
                institutionCode &&
                !currentMxInstitutionCodes.has(institutionCode)
              );
            })
            .map((inst) => inst.id);

          if (staleIds.length > 0) {
            await tx
              .delete(institutionRegistry)
              .where(inArray(institutionRegistry.id, staleIds));
            console.log(`Removed ${staleIds.length} stale MX institutions`);
          }
        }
      });

      if (totalInstitutions === 0) {
        throw new Error(
          "No institutions fetched from MX - aborting database update to prevent data loss",
        );
      }

      console.log(
        `Successfully synced ${totalInstitutions} MX institutions to database in ${totalBatches} batches`,
      );
    } catch (error) {
      console.error("Error during MX institutions sync:", error);
      throw new Error(`Failed to sync MX institutions: ${error}`);
    }
  }
}
