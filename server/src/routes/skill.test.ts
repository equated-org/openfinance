import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import skillRoutes from "./skill";

const app = new Hono();
app.route("/skill.md", skillRoutes);
app.route("/api/skill", skillRoutes);

describe("the skill", () => {
  it.each(["/skill.md", "/api/skill"])("is served as markdown at %s", async (path) => {
    const res = await app.request(path);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(await res.text()).toMatch(/^---\nname: openfinance\n/);
  });
});
