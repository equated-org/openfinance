#!/usr/bin/env tsx

import "../env.js";
import { Command } from "commander";
import { plaidService } from "$lib/sync/plaid.service.js";
import { db } from "../db";
import { accountConnections, institutionRegistry, user } from "../schema";
import { eq } from "drizzle-orm";

const program = new Command();

program
  .name("sync-accounts")
  .description("List connected accounts and trigger transaction syncs");

program
  .command("list")
  .description("List account connections for a user")
  .argument("<userIdOrEmail>", "User ID or email to list connections for")
  .action(async (userIdOrEmail: string) => {
    try {
      let userId = userIdOrEmail;

      if (userIdOrEmail.includes("@")) {
        const [found] = await db
          .select({ id: user.id })
          .from(user)
          .where(eq(user.email, userIdOrEmail))
          .limit(1);

        if (!found) {
          console.error(`No user found with email: ${userIdOrEmail}`);
          process.exit(1);
        }
        userId = found.id;
      }

      const connections = await db
        .select({
          id: accountConnections.id,
          provider: accountConnections.provider,
          status: accountConnections.status,
          lastSyncedAt: accountConnections.lastSyncedAt,
          transactionCursor: accountConnections.transactionCursor,
          institutionName: institutionRegistry.name,
        })
        .from(accountConnections)
        .leftJoin(
          institutionRegistry,
          eq(accountConnections.institutionRegistryId, institutionRegistry.id),
        )
        .where(eq(accountConnections.userId, userId));

      if (connections.length === 0) {
        console.log(`No connections found for user: ${userId}`);
        process.exit(0);
      }

      console.log(
        `Found ${connections.length} connection(s) for user: ${userId}\n`,
      );

      for (const conn of connections) {
        console.log(`  ID:           ${conn.id}`);
        console.log(`  Institution:  ${conn.institutionName ?? "Unknown"}`);
        console.log(`  Provider:     ${conn.provider}`);
        console.log(`  Status:       ${conn.status}`);
        console.log(
          `  Last Synced:  ${conn.lastSyncedAt?.toISOString() ?? "Never"}`,
        );
        console.log(`  Has Cursor:   ${conn.transactionCursor ? "Yes" : "No"}`);
        console.log();
      }

      process.exit(0);
    } catch (error) {
      console.error("Failed to list connections:", error);
      process.exit(1);
    }
  });

program
  .command("sync")
  .description("Trigger transaction sync for a connection")
  .argument("<connectionId>", "Connection ID to sync")
  .action(async (connectionIdStr: string) => {
    const connectionId = parseInt(connectionIdStr, 10);
    if (Number.isNaN(connectionId) || connectionId <= 0) {
      console.error("Invalid connection ID. Must be a positive integer.");
      process.exit(1);
    }

    try {
      const [connection] = await db
        .select({
          id: accountConnections.id,
          plaidAccessToken: accountConnections.plaidAccessToken,
          transactionCursor: accountConnections.transactionCursor,
        })
        .from(accountConnections)
        .where(eq(accountConnections.id, connectionId))
        .limit(1);

      if (!connection) {
        console.error(`Connection ${connectionId} not found.`);
        process.exit(1);
      }

      if (!connection.plaidAccessToken) {
        console.error(`Connection ${connectionId} has no Plaid access token.`);
        process.exit(1);
      }

      console.log(`Syncing transactions for connection ${connectionId}...`);

      const result = await plaidService.syncTransactions(connection.id);

      console.log(`\nSync complete:`);
      console.log(`  Added:    ${result.added}`);
      console.log(`  Modified: ${result.modified}`);
      console.log(`  Removed:  ${result.removed}`);
      console.log(`  Cursor:   ${result.nextCursor}`);

      process.exit(0);
    } catch (error) {
      console.error("Sync failed:", error);
      process.exit(1);
    }
  });

program.parse();
