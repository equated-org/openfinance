import { Hono } from "hono";
import { requireSession, type AuthEnv } from "../lib/middleware";
import { financialAccountService } from "../lib/financial-account.service";

export interface Task {
  id: string;
  type: "account_disconnected";
  title: string;
  description: string;
  accountId: number;
  institutionName: string;
}

const taskRoutes = new Hono<AuthEnv>();

taskRoutes.use("*", requireSession);

taskRoutes.get("/", async (c) => {
  const user = c.get("user");
  const accounts = await financialAccountService.getAccountsByUserId(user.id);

  const erroredAccounts = accounts.filter((a) => a.syncError != null);

  // Deduplicate by connectionId so multiple accounts on the same connection
  // produce only one reconnect task. Show one task at a time.
  const seenConnections = new Set<number>();
  const tasks: Task[] = [];
  for (const a of erroredAccounts) {
    if (seenConnections.has(a.connectionId)) continue;
    seenConnections.add(a.connectionId);
    tasks.push({
      id: `sync_error:${a.id}`,
      type: "account_disconnected" as const,
      title: `Reconnect ${a.institutionName}`,
      description: "This account lost connection and needs to be re-linked.",
      accountId: a.id,
      institutionName: a.institutionName,
    });
  }
  return c.json({ tasks });
});

export default taskRoutes;
