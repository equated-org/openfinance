# Connect this agent to OpenFinance

OpenFinance gives AI assistants read access to the user's bank accounts,
balances, and transactions. Its MCP server (streamable HTTP) is at:

```
{{mcpUrl}}
```

Sign-in is OAuth with dynamic client registration, so there's nothing to
configure: the first connection opens a browser where the user signs in to
OpenFinance and approves access. Clients that can't do OAuth can send the
user's API key instead, as `Authorization: Bearer <key>`. The user copies the
key from the Connect tab at {{appUrl}}/connect. Keep it in an environment
variable or the client's secret storage, not in a file you commit.

Check for an existing `openfinance` server before adding one. If its URL
matches and its tools work, skip to "Verify". Follow the section for the
client you're running in.

## Claude Code

```sh
claude mcp add --scope user --transport http openfinance {{mcpUrl}}
```

Keep `--scope user` so the server is available in every project, not just
the current directory. Signing in needs an interactive terminal, so ask the
user to run `/mcp` in their Claude Code session, select `openfinance`, and
choose **Authenticate**. Wait until they say it's done.

To use the API key instead, add
`--header "Authorization: Bearer $OPENFINANCE_API_KEY"` to the command.

## Codex CLI

```sh
codex mcp add openfinance --url {{mcpUrl}}
```

Codex starts the browser sign-in when it adds the server. If it doesn't, ask
the user to run `codex mcp login openfinance`. To use the API key instead,
add `--bearer-token-env-var OPENFINANCE_API_KEY` and make sure that variable
is set wherever Codex runs.

## Cursor

Merge this into `~/.cursor/mcp.json`, keeping any other servers:

```json
{ "mcpServers": { "openfinance": { "url": "{{mcpUrl}}" } } }
```

Then ask the user to sign in from Cursor's MCP settings.

## OpenClaw

With the user's API key in the gateway's `OPENFINANCE_API_KEY` environment
variable:

```sh
openclaw mcp set openfinance '{"url":"{{mcpUrl}}","transport":"streamable-http","headers":{"Authorization":"Bearer ${OPENFINANCE_API_KEY}"}}'
```

To sign in with OAuth instead, set
`{"url":"{{mcpUrl}}","transport":"streamable-http","auth":"oauth"}` and ask the
user to run `openclaw mcp login openfinance`.

## Claude (web, desktop, mobile) and ChatGPT

These apps can't be configured by an agent. Ask the user to add a custom
connector with the URL above and sign in when prompted:

- Claude: Settings → Connectors → Add custom connector.
- ChatGPT: Plugins → Add → Add MCP server.

## Grok (xAI API) and other API-based bots

Pass the server as a remote MCP tool and authenticate with the API key:

```json
{
  "type": "mcp",
  "server_url": "{{mcpUrl}}",
  "server_label": "openfinance",
  "authorization": "Bearer <OPENFINANCE_API_KEY>"
}
```

## Agents without MCP

Use the REST API with the API key. The skill at {{serverUrl}}/api/skill
documents every endpoint.

## Verify

Call `get_accounts` and tell the user how many accounts came back. If none
did, they haven't linked a bank yet; they can do that at {{appUrl}}.
