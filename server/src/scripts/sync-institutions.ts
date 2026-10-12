#!/usr/bin/env tsx

import "../env.js";
import { Command } from "commander";
import { PlaidInstitutionSyncer } from "$lib/sync/plaid-institution-syncer.js";
import { MXInstitutionSyncer } from "$lib/sync/mx-institution-syncer.js";

type Provider = "plaid" | "mx" | "update-status";

const program = new Command();

program
  .name("sync-institutions")
  .description("Sync financial institutions from Plaid to the database")
  .argument(
    "[provider]",
    "Provider to sync from: plaid (default), mx, update-status",
    "plaid",
  )
  .option(
    "-l, --limit <number>",
    "Limit the number of institutions to sync (for testing)",
  )
  .addHelpText(
    "after",
    `
Examples:
  tsx server/src/scripts/sync-institutions.ts plaid --limit 10
  tsx server/src/scripts/sync-institutions.ts mx --limit 10
  tsx server/src/scripts/sync-institutions.ts update-status
`,
  )
  .action(async (provider: Provider, options) => {
    console.log(`Starting institution sync from: ${provider.toUpperCase()}`);

    const limit = options.limit ? parseInt(options.limit, 10) : undefined;
    if (options.limit && (Number.isNaN(limit) || limit! <= 0)) {
      console.error("Invalid --limit. Must be a positive integer.");
      process.exit(1);
    }

    if (limit) {
      console.log(`Limited to: ${limit} institutions`);
    }
    console.log(`Started at: ${new Date().toISOString()}`);
    console.log("-".repeat(60));

    const startTime = Date.now();

    const plaidSyncer = new PlaidInstitutionSyncer();

    try {
      switch (provider) {
        case "plaid":
          console.log("Syncing Plaid institutions...");
          await plaidSyncer.refreshInstitutions(limit);
          break;
        case "mx": {
          console.log("Syncing MX institutions...");
          const mxSyncer = new MXInstitutionSyncer();
          await mxSyncer.refreshInstitutions(limit);
          break;
        }
        case "update-status":
          console.log("Updating connection status for Plaid institutions...");
          await plaidSyncer.updateConnectionHealthStatus();
          break;
      }

      const duration = Date.now() - startTime;
      const minutes = Math.floor(duration / 60000);
      const seconds = Math.floor((duration % 60000) / 1000);

      console.log("-".repeat(60));
      console.log(`Sync completed successfully!`);
      console.log(`Total time: ${minutes}m ${seconds}s`);
      process.exit(0);
    } catch (error) {
      const duration = Date.now() - startTime;
      const minutes = Math.floor(duration / 60000);
      const seconds = Math.floor((duration % 60000) / 1000);

      console.log("-".repeat(60));
      console.error(`Sync failed after ${minutes}m ${seconds}s`);
      console.error(`Failed at: ${new Date().toISOString()}`);
      console.error("Error details:", error);
      process.exit(1);
    }
  });

program.parse();
