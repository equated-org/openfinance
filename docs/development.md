# Development

## Getting started

### Prerequisites

- Node.js 22+
- pnpm 10.12.4 (the version pinned in `package.json`)
- Docker with Docker Compose

### 1. Install dependencies

```sh
pnpm install
```

### 2. Configure environment

```sh
cp .env.example .env
```

Fill in your Google OAuth credentials (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`). Get these from [Google Cloud Console](https://console.cloud.google.com/apis/credentials) — add `http://localhost:3000/api/auth/callback/google` as an authorized redirect URI.

Set `BETTER_AUTH_SECRET` to a random secret and keep `APP_URL=http://localhost:6100` for the local web app. Configure the provider credentials in `.env` for the connections you want to use: Plaid, MX, or Quiltt. These require your own provider accounts; cloning the repository does not supply bank connectivity.

Follow the [provider setup guide](providers.md) for Plaid, MX, and Mastercard via Quiltt, including environment variables, institution imports, sandbox tests, and production access.

### 3. Start the app

```sh
docker compose up -d db
pnpm db:migrate
pnpm dev
```

Start Postgres before running migrations; wait until it is accepting connections. `pnpm dev` then starts the Docker Compose services, the API server on `:3000`, SvelteKit on `:6100` (proxies `/api` to the server), and Storybook on `:6006`.

### Adding shadcn-svelte components

We use [shadcn-svelte](https://next.shadcn-svelte.com/). To add a new component:

```sh
cd client
pnpm dlx shadcn-svelte@latest add <component-name>
```

Components are installed to `src/lib/components/ui/<component-name>/`.

## Running scripts (development only)

From the repo root:

```sh
cd server
npx tsx src/scripts/sync-accounts.ts list <email>
```

Other scripts live under `server/src/scripts/` and can be run the same way: `npx tsx src/scripts/<script-name>.ts <args>`.

## Testing

### Vitest

Start the dedicated test database, then run the server tests from the repo root:

```sh
docker compose up -d test-db
pnpm --filter server test
```

The test setup uses the `openfin_test` database on port `5433` by default. Keep it separate from your development or production database; tests reset their database state.

From `server/`, run tests matching a filename:

```sh
pnpm vitest run billing
```

Run a specific test by name with `-t "pattern"`:

```sh
pnpm vitest run -t "blocks mutation queries"
```

### Stripe testing

1. Install the [Stripe CLI](https://docs.stripe.com/stripe-cli).
2. Login: `stripe login`
3. Forward webhooks to the local server:

```sh
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

4. Copy the webhook signing secret (`whsec_...`) into your `.env` as `STRIPE_WEBHOOK_SECRET`.
