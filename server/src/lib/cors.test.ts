import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { corsMiddleware } from "./cors";

const app = new Hono();
app.use("*", corsMiddleware);
app.all("*", (c) => c.text("ok"));

function preflight(path: string, origin: string) {
  return app.request(path, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type",
    },
  });
}

describe("CORS", () => {
  it.each([
    "/mcp",
    "/setup.md",
    "/.well-known/oauth-protected-resource",
    "/api/auth/mcp/token",
  ])("lets any origin call %s without credentials", async (path) => {
    const res = await preflight(path, "https://claude.ai");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("exposes the sign-in challenge to browser MCP clients", async () => {
    const res = await app.request("/mcp", {
      method: "POST",
      headers: { Origin: "https://claude.ai" },
    });
    expect(res.headers.get("Access-Control-Expose-Headers")).toContain(
      "WWW-Authenticate",
    );
  });

  it("keeps the rest of the API to the web app, with cookies", async () => {
    const res = await preflight("/api/accounts", "http://localhost:6100");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "http://localhost:6100",
    );
    expect(res.headers.get("Access-Control-Allow-Credentials")).toBe("true");

    const other = await preflight("/api/auth/oauth2/consent", "https://evil.example");
    expect(other.headers.get("Access-Control-Allow-Origin")).not.toBe(
      "https://evil.example",
    );
  });
});
