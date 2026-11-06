# Contributing

Thanks for contributing to OpenFinance.

## Report a bug or suggest a change

[Open an issue](https://github.com/equated-org/openfinance/issues) with what you expected, what happened, and steps to reproduce it. Include the affected client or financial provider and whether you use the hosted app or a self-hosted instance.

Remove API keys, access tokens, bank account details, and personal transaction data from logs and screenshots before posting.

## Make a contribution

1. Follow the [development guide](docs/development.md) to run the app locally.
2. Keep your change focused and update the relevant docs when behavior changes.
3. Run the checks for the part of the app you changed:

   ```sh
   # Server changes: start the dedicated test database, then run tests.
   docker compose up -d test-db
   pnpm --filter server test

   # Client changes: run Svelte's checks and build the app.
   pnpm --filter client check
   pnpm --filter client build
   ```

   For documentation-only changes, check links, commands, and the rendered Markdown.

4. Open a pull request describing the problem, the change, and how you checked it. Include screenshots for visible UI changes.

Server tests also run in GitHub Actions on pushes and pull requests to `main`.

## Repository map

| Path | Purpose |
| --- | --- |
| `client/` | SvelteKit web app and component stories |
| `server/` | Hono API, hosted MCP server, provider sync, and tests |
| `shared/` | Types shared by the client and server |
| `mcp-server/` | Local stdio bridge to the hosted MCP server |
| `skill/` | Agent Skill and REST API usage reference |
| `docs/` | Development and deployment guides |

## License for Contributions

By submitting a contribution (code, docs, tests, or other material), you agree that your contribution is licensed under the same license as this project: `AGPL-3.0-only`.

## DCO / Sign-off

When appropriate, maintainers may request Signed-off-by lines in commits for provenance.
