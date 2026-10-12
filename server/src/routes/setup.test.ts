import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import setupRoutes from "./setup";

const app = new Hono();
app.route("/setup.md", setupRoutes);

describe("GET /setup.md", () => {
  it("gives agents markdown with this server's MCP URL", async () => {
    const res = await app.request("/setup.md");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "text/markdown; charset=utf-8",
    );
    const guide = await res.text();
    expect(guide).toContain(
      "claude mcp add --scope user --transport http openfinance http://localhost:3000/mcp",
    );
    expect(guide).not.toContain("{{");
    // OpenClaw fills this in from the gateway's environment, so it stays.
    expect(guide).toContain('"Bearer ${OPENFINANCE_API_KEY}"');
  });

  it("shows browsers plain text instead of downloading it", async () => {
    const res = await app.request("/setup.md", {
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    expect(res.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
  });
});
