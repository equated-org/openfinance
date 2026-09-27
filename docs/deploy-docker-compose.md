# Deploying with Docker Compose

`docker-compose.prod.yml` runs the API on your own server: Postgres 17, the
API, and Caddy, which serves HTTPS with certificates from Let's Encrypt. One
server with 1 vCPU and 2 GB of RAM plus swap is enough. The web client
(`client/`) deploys separately as a static site, with `VITE_API_URL` set to
the API's URL. To use Fly instead, see [Deploying to Fly.io](deploy-fly.md).

## Setup

Install [Docker](https://docs.docker.com/engine/install/) with the Compose
plugin, allow ports 80 and 443 through the firewall, and clone the repo:

```bash
git clone https://github.com/equated-org/openfinance.git /root/openfinance
```

Create `/root/openfinance/.env.prod` from `.env.example`, `chmod 600` it, and
fill in:

- `APP_ENV=prod`, `APP_URL` (the web client's origin), `BETTER_AUTH_URL` (the
  API's origin), `BETTER_AUTH_SECRET`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, with the redirect URI
  `<BETTER_AUTH_URL>/api/auth/callback/google`
- `PLAID_CLIENT_ID`, `PLAID_PROD_SECRET`
- `QUILTT_API_SECRET`, `QUILTT_CONNECTOR_ID`
- `RESEND_API_KEY`, `EMAIL_FROM`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- Optional: `MX_API_KEY`, `MX_API_URL` and `MX_CLIENT_ID` (all three, or MX
  stays off), `API_PROXY_URL`, `MCP_BUNDLE_URL`, and
  `DISABLE_SCHEDULED_JOBS=true` to pause the scheduled bank syncs on a copy of
  production

Then add the server's own settings:

```bash
POSTGRES_USER=openfinance
POSTGRES_PASSWORD=            # openssl rand -hex 24; it goes into DATABASE_URL
POSTGRES_DB=openfinance
API_HOSTS=api.openfinance.sh  # every hostname Caddy serves, space separated
```

Compose builds `DATABASE_URL` from the `POSTGRES_*` values, and Postgres only
listens on the server's loopback interface. Point the hostname's A and AAAA
records at the server, then deploy:

```bash
/root/openfinance/scripts/deploy.sh
```

Until DNS points at the server, Caddy serves a self-signed certificate, so you
can try it first:

```bash
curl -k --resolve api.openfinance.sh:443:<server-ip> https://api.openfinance.sh/api/health
```

Behind Cloudflare's proxy, Caddy still gets its certificate from Let's Encrypt
over plain HTTP, so leave "Always Use HTTPS" off (Caddy redirects to HTTPS
itself) and set the SSL/TLS mode to Full (strict).

## Deploy

`scripts/deploy.sh` checks out `origin/main`, builds the image, runs pending
migrations, and replaces the app container once the new one is healthy. Caddy
holds requests while the container restarts. If migrations fail, the running
app isn't touched.

```bash
ssh root@<server> /root/openfinance/scripts/deploy.sh
ssh root@<server> DEPLOY_REF=<commit or origin/branch> /root/openfinance/scripts/deploy.sh
```

`.github/workflows/server-deploy.yml` runs it on every push to `main` once these
repository secrets exist. They're secrets rather than variables so the server's
address stays out of the public Actions logs.

- `DEPLOY_HOST`: the server's address
- `DEPLOY_KNOWN_HOSTS`: its host key, from `ssh-keyscan -t ed25519 <server>`
- `DEPLOY_SSH_KEY`: a private key whose public half the server restricts to
  the deploy script, in `/root/.ssh/authorized_keys`:
  `restrict,command="/root/openfinance/scripts/deploy.sh" ssh-ed25519 AAAA...`

## Operations

```bash
cd /root/openfinance
alias dc='docker compose --env-file .env.prod -f docker-compose.prod.yml'
dc ps
dc logs -f app                                    # or db, caddy
dc exec db psql -U openfinance openfinance
dc exec app npx tsx src/scripts/sync-accounts.ts list <email>
dc up -d                                          # apply .env.prod changes
```

From your machine, reach Postgres through an SSH tunnel:
`ssh -N -L 15432:127.0.0.1:5432 root@<server>`, then connect to
`localhost:15432`.
