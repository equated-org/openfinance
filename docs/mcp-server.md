# MCP Server

## Overview

The API hosts the MCP server at `https://api.openfinance.sh/mcp`, over
streamable HTTP. Clients add it by URL, so there's nothing to install or
publish: the tools ship with every API deploy.

The tools live in `server/src/mcp/server.ts` and call the same services as the
REST API:

- `get_accounts`
- `create_reconnect_link`
- `get_transactions`
- `query_transactions`

The endpoint is stateless. Each request builds a server for the signed-in user
(`server/src/routes/mcp.ts`), and responses come back as JSON rather than an
event stream, so `GET /mcp` answers 405.

## Authentication

`/mcp` accepts either credential as `Authorization: Bearer <token>`:

- **OAuth access token.** Apps that only take a URL (Claude, ChatGPT) sign in
  with OAuth 2.1, served by better-auth's `mcp()` plugin in `server/src/auth.ts`.
  Clients register themselves, use PKCE, and get one-hour access tokens that
  refresh for 90 days. Every authorize request goes through the consent page at
  `/oauth/consent` in the app (`server/src/routes/auth.ts` forces it). Clients
  find the server through `/.well-known/oauth-protected-resource` and
  `/.well-known/oauth-authorization-server`, which the 401 challenge from `/mcp`
  points to.
- **API key.** The same read-only `sk-` key as the REST API, for clients that
  can't do OAuth: bots on the xAI API, OpenClaw, or headless setups.

Session cookies aren't accepted, so a web page can't call the tools on a
signed-in user's behalf. OAuth tokens only work at `/mcp`, not on the REST API.

## Connecting clients

The app's Connect tab has per-client steps. Agents that can set themselves up
(Claude Code, Codex, Cursor, OpenClaw) can follow `/setup.md`
(`server/src/mcp/setup.md`), which the Connect tab offers as a one-line
prompt:

```text
Read https://api.openfinance.sh/setup.md and follow it to connect OpenFinance.
```

Muse doesn't support MCP yet. Users paste their API key into its OpenFinance
connector instead.

## Testing

The server tests run in CI on every push and pull request:

- `server/src/routes/mcp.test.ts` covers the tools, API keys, and which
  requests are turned away.
- `mcp-oauth.test.ts` runs the whole connector sign-in against the real
  better-auth setup: registration, authorize, the consent page, the PKCE code
  exchange, refresh, expiry, and declining.
- `mcp-client.test.ts` connects with the MCP SDK's own client, the code Claude
  Code and many other clients are built on. With OAuth it starts from the 401
  challenge and finds, registers, signs in, and refreshes by itself.

After a deploy, check the live endpoint with your API key:

```sh
cd server
OPENFINANCE_API_KEY=sk-... npx tsx src/scripts/mcp-smoke.ts
```

It checks the OAuth challenge and discovery documents, then connects with the
SDK client and calls `get_accounts`. Pass a URL to check another instance, such
as `http://localhost:3000/mcp`. The apps' own UIs (Claude, ChatGPT) can't be
driven from a script, so add the connector in one of them once after changing
the sign-in.

## Legacy: the local package

`mcp-server/` is the original stdio server, published to npm as
[`@openfinance-sh/mcp`](https://www.npmjs.com/package/@openfinance-sh/mcp) and
packed into `openfinance.mcpb` for Claude Desktop. Since 0.2.0 it's a bridge:
it forwards MCP messages from stdio to `/mcp` with the API key, so it serves
the hosted tools and never needs a release when they change. Configs that use
it keep the same `OPENFINANCE_API_KEY` and `OPENFINANCE_URL`, and the Connect
tab still offers it under "Legacy". It's also listed in the
[MCP registry](https://registry.modelcontextprotocol.io), which points clients
at the npm package. Versions before 0.2.0 called the REST API directly and
still work.

### Publishing the package

#### 1. Bump version

Update the version in all three files:
- `mcp-server/package.json`
- `mcp-server/server.json` (top-level `version` + `packages[0].version`)
- `mcp-server/manifest.json`

#### 2. Publish to npm

```sh
cd mcp-server
npm publish --access public
```

Requires an OTP from your authenticator app. The `prepack` script runs `pnpm bundle`, which rebuilds and packs `openfinance.mcpb` from a staging directory that holds only `manifest.json`, `package.json`, and `build/`. Nothing else in `mcp-server/` can end up in the bundle. Before entering the OTP, check that the archive contents it prints are only those files.

#### 3. Update registry

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

Publishing under `io.github.Openfinanceorg` needs an owner of that GitHub organization. The browser login may only grant your personal namespace; if `publish` returns 403, log in with a classic personal access token that has only the `read:org` scope: `mcp-publisher login github --token <token>`.

#### Verify

```sh
# Check npm metadata
npm view @openfinance-sh/mcp repository.url

# Check registry
curl -s https://registry.modelcontextprotocol.io/servers/io.github.Openfinanceorg/openfinance | jq .version
```
