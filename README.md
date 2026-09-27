# OpenFinance

Open-source financial data for any AI.

OpenFinance lets you connect your financial accounts once and use that data with
Claude, ChatGPT, OpenClaw, Cursor, local agents, or any MCP client. Ask about
spending, subscriptions, balances, merchants, rewards, and trends without
locking your financial data into one platform.

OpenFinance is not an AI provider. It gives AI tools read-only access to your
accounts and transactions.

## How it works

1. Connect accounts through providers such as Plaid, MX, and
   Quiltt/Mastercard-backed connections.
2. OpenFinance syncs normalized accounts, balances, and transactions into your
   database.
3. Your AI reads that data through a Skill, MCP server, or REST API.

## What you can ask

- How much did I spend on food last month?
- What are my biggest recurring subscriptions?
- Which merchants did I spend the most with this quarter?
- Which card should I use for better rewards?
- What large or unusual transactions happened recently?

OpenFinance exposes accounts, balances, transaction names, merchants, amounts,
dates, pending status, currency, and read-only SQL queries over transactions.

## Connect your AI

Use one of:

- **Skill** - copy it from the app's Connect tab
- **MCP** - use
  [`@openfinance-sh/mcp`](https://www.npmjs.com/package/@openfinance-sh/mcp)
- **REST API** - call OpenFinance directly with an API key

See [skill/SKILL.md](skill/SKILL.md) and
[docs/mcp-server.md](docs/mcp-server.md).

## Quick start

Hosted app:

1. Go to [app.openfinance.sh](https://app.openfinance.sh).
2. Connect a financial account.
3. Copy your Skill, MCP config, or API key from the Connect tab.
4. Ask your AI about your finances.

Self-hosted development:

```sh
pnpm install
cp .env.example .env
docker compose up -d
pnpm db:migrate
pnpm dev
```

The API runs on `:3000`. The SvelteKit client runs on `:5173`.

## Docs

- [Development](docs/development.md)
- [Deploying to Fly.io](docs/deploy-fly.md)
- [Deploying with Docker Compose](docs/deploy-docker-compose.md)
- [MCP server](docs/mcp-server.md)
- [Skill/API examples](skill/SKILL.md)

## Stack

Hono, SvelteKit, Drizzle ORM, Better Auth, PostgreSQL, Docker, MCP.

## Security and privacy

- Bank auth is handled by financial data providers; bank credentials do not
  touch OpenFinance servers.
- API keys control read access to your financial data.
- You can use the hosted app or self-host the app and database.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

`AGPL-3.0-only`. See [LICENSE](LICENSE).
