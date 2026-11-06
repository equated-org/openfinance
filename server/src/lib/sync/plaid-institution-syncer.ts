import { db } from "../../db.js";
import { institutionRegistry } from "$lib/sql/institution-registry.sql";
import { sql, inArray } from "drizzle-orm";
import type { InstitutionSyncer } from "./institution-syncer.interface";
import type { NewInstitutionRegistry } from "$lib/sql/institution-registry.sql";
import {
  buildConflictUpdateColumns,
  getInstitutionRegistryUpdateColumns,
} from "./batch-upsert.helpers.js";
import {
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
}
