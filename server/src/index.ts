import "./env.js";
import { DBOS } from "@dbos-inc/dbos-sdk";
import "./workflows/index.js";
import { Hono } from "hono";
import { logger } from "hono/logger";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import authRoutes from "./routes/auth.js";
import institutionRoutes from "./routes/institutions.js";
import plaidRoutes from "./routes/plaid.js";
import mxRoutes from "./routes/mx.js";
import quilttRoutes from "./routes/quiltt.js";
import accountRoutes from "./routes/accounts.js";
import transactionRoutes from "./routes/transactions.js";
import keyRoutes from "./routes/keys.js";
import meRoutes from "./routes/me.js";
import mcpBundleRoutes from "./routes/mcp-bundle.js";
import skillRoutes from "./routes/skill.js";
import taskRoutes from "./routes/tasks.js";
import billingRoutes from "./routes/billing.js";
import stripeWebhookRoutes from "./routes/stripe-webhook.js";
import notificationRoutes from "./routes/notifications.js";
import reconnectLinkRoutes from "./routes/reconnect-links.js";

const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: process.env.APP_URL || "http://localhost:6100",
    credentials: true,
  }),
);

// API routes
app.route("/api/auth", authRoutes);
app.route("/api/institutions", institutionRoutes);
app.route("/api/plaid", plaidRoutes);
app.route("/api/mx", mxRoutes);
app.route("/api/quiltt", quilttRoutes);
app.route("/api/accounts", accountRoutes);
app.route("/api/transactions", transactionRoutes);
app.route("/api/keys", keyRoutes);
app.route("/api/me", meRoutes);
app.route("/api/mcp-bundle", mcpBundleRoutes);
app.route("/api/skill", skillRoutes);
app.route("/api/tasks", taskRoutes);
app.route("/api/billing", billingRoutes);
app.route("/api/stripe", stripeWebhookRoutes);
app.route("/api/notifications", notificationRoutes);
app.route("/api/reconnect-links", reconnectLinkRoutes);

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/", (c) => c.text("ImATeapot", 418));

const port = parseInt(process.env.PORT || "3000");

(async () => {
  DBOS.setConfig({
    name: "openfin-server",
    systemDatabaseUrl: process.env.DATABASE_URL,
  });
  await DBOS.launch();

  console.log(`Server running on port ${port}`);
  serve({ fetch: app.fetch, port });
})();
