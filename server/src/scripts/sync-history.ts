#!/usr/bin/env tsx

import "../env.js";
import { Command } from "commander";
import { plaidService } from "$lib/sync/plaid.service.js";
import { mxService } from "$lib/sync/mx.service.js";
import { db } from "../db";
import { accountConnections, institutionRegistry, user } from "../schema";
import { eq } from "drizzle-orm";

const program = new Command();

program
  .name("sync-history")
  .description("Sync full transaction history for a user")
  .argument("<email>", "User email to sync transactions for")
  .action(async (email: string) => {
    try {
      const [found] = await db
        .select({ id: user.id, mxUserGuid: user.mxUserGuid })
        .from(user)
        .where(eq(user.email, email))
        .limit(1);

      if (!found) {
        console.error(`No user found with email: ${email}`);
        process.exit(1);
      }

      const connections = await db
        .select({
          id: accountConnections.id,
          provider: accountConnections.provider,
          status: accountConnections.status,
          plaidAccessToken: accountConnections.plaidAccessToken,
          mxMemberGuid: accountConnections.mxMemberGuid,
          transactionCursor: accountConnections.transactionCursor,
          institutionName: institutionRegistry.name,
        })
        .from(accountConnections)
        .leftJoin(
          institutionRegistry,
          eq(accountConnections.institutionRegistryId, institutionRegistry.id),
        )
        .where(eq(accountConnections.userId, found.id));

      if (connections.length === 0) {
        console.log(`No connections found for user: ${email}`);
        process.exit(0);
      }

      console.log(
        `Found ${connections.length} connection(s) for user: ${email}\n`,
      );

      for (const conn of connections) {
        const label = `${conn.institutionName ?? "Unknown"} (${conn.provider})`;

        if (conn.status !== "active") {
          console.log(`⚠ Skipping ${label} — status: ${conn.status}`);
          continue;
        }

        if (conn.provider === "plaid") {
          if (!conn.plaidAccessToken) {
            console.log(`⚠ Skipping ${label} — missing plaidAccessToken`);
            continue;
          }

          // Reset cursor to null for full history sync
          await db
            .update(accountConnections)
            .set({ transactionCursor: null, updatedAt: new Date() })
            .where(eq(accountConnections.id, conn.id));

          console.log(`Syncing ${label}...`);
          const result = await plaidService.syncTransactions(conn.id);

          console.log(
            `  Added: ${result.added}, Modified: ${result.modified}, Removed: ${result.removed}`,
          );
        } else if (conn.provider === "mx") {
          if (!conn.mxMemberGuid) {
            console.log(`⚠ Skipping ${label} — missing mxMemberGuid`);
            continue;
          }
          if (!found.mxUserGuid) {
            console.log(`⚠ Skipping ${label} — missing mxUserGuid on user`);
            continue;
          }

          console.log(`Syncing ${label}...`);
          const result = await mxService.syncTransactions({
            connectionId: conn.id,
            userGuid: found.mxUserGuid,
            memberGuid: conn.mxMemberGuid,
          });

          console.log(`  Added: ${result.added}`);
        }
      }

      console.log("\nDone.");
      process.exit(0);
    } catch (error) {
      console.error("Sync failed:", error);
      process.exit(1);
    }
  });

program.parse();
