import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { appUrl, serverUrl } from "../lib/origins.js";

// GET /setup.md — the guide an agent reads to connect itself, from a prompt
// like "Read <url>/setup.md and follow it". Public, because agents fetch it
// before they have a credential. It names this instance's URLs.
const guide = readFileSync(new URL("../mcp/setup.md", import.meta.url), "utf8")
  .replaceAll("{{mcpUrl}}", `${serverUrl}/mcp`)
  .replaceAll("{{serverUrl}}", serverUrl)
  .replaceAll("{{appUrl}}", appUrl);

const setupRoutes = new Hono();

setupRoutes.get("/", (c) => {
  // Browsers show text/plain inline; agents get markdown.
  const wantsHtml = c.req.header("Accept")?.includes("text/html") ?? false;
  return c.text(guide, 200, {
    "Content-Type": wantsHtml
      ? "text/plain; charset=utf-8"
      : "text/markdown; charset=utf-8",
  });
});

export default setupRoutes;
