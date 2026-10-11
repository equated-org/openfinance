# MCP Server

## Overview

The MCP server lives in `mcp-server/` and is published as [`@openfinance-sh/mcp`](https://www.npmjs.com/package/@openfinance-sh/mcp) on npm. It's also registered in the [MCP registry](https://registry.modelcontextprotocol.io) so MCP clients (Claude Desktop, Claude Code, etc.) can discover it automatically.

## How the registry works

The MCP registry is a centralized directory maintained by Anthropic. It doesn't host code — it's a catalog that points clients to the npm package.

- **npm** hosts the actual package (installed by users)
- **MCP registry** stores metadata (`server.json`) — name, description, tools, env vars, and a pointer to the npm package

When someone adds the server in an MCP client, the client looks it up in the registry, finds the npm package, and installs it.

## Publishing

### 1. Bump version

Update the version in all three files:
- `mcp-server/package.json`
- `mcp-server/server.json` (top-level `version` + `packages[0].version`)
- `mcp-server/manifest.json`

### 2. Publish to npm

```sh
cd mcp-server
npm publish --access public
```

Requires an OTP from your authenticator app. The `prepack` script runs `pnpm bundle`, which rebuilds and packs `openfinance.mcpb` from a staging directory that holds only `manifest.json`, `package.json`, and `build/`. Nothing else in `mcp-server/` can end up in the bundle. Before entering the OTP, check that the archive contents it prints are only those files.

### 3. Update registry

Install `mcp-publisher` with Homebrew rather than downloading the binary into the repo:

```sh
brew install mcp-publisher
```

Then publish from `mcp-server/`:

```sh
cd mcp-server
mcp-publisher login github
mcp-publisher publish
```

Current releases store the login token in `~/.config/mcp-publisher/`. Older releases wrote `.mcpregistry_*` token files to the working directory, so those files are gitignored.

### Verify

```sh
# Check npm metadata
npm view @openfinance-sh/mcp repository.url

# Check registry
curl -s https://registry.modelcontextprotocol.io/servers/io.github.Openfinanceorg/openfinance | jq .version
```
