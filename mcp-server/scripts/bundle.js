// Packs openfinance.mcpb from a staging directory that holds only the files
// the extension runs from, so nothing else in mcp-server/ can end up in it.
// Packing mcp-server/ directly once shipped mcp-publisher and its registry
// tokens in the bundle. build/ is self-contained because tsup inlines the
// dependencies, and package.json marks build/*.js as ES modules.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BUNDLE_FILES = ["manifest.json", "package.json", "build"];

const packageDir = fileURLToPath(new URL("..", import.meta.url));
const stagingDir = mkdtempSync(join(tmpdir(), "openfinance-mcpb-"));

try {
  for (const file of BUNDLE_FILES) {
    cpSync(join(packageDir, file), join(stagingDir, file), { recursive: true });
  }
  // Run from the staging directory so mcpb lists the archive paths correctly.
  execFileSync("mcpb", ["pack", ".", join(packageDir, "openfinance.mcpb")], {
    cwd: stagingDir,
    stdio: "inherit",
  });
} finally {
  rmSync(stagingDir, { recursive: true, force: true });
}
