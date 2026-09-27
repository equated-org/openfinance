# Deploying to Fly.io

The API runs as a Fly app (`fly.toml`) with Fly Managed Postgres. The web
client (`client/`) deploys separately as a static site, with `VITE_API_URL`
set to the API's URL. To run on your own server instead, see
[Deploying with Docker Compose](deploy-docker-compose.md).

## Setup

Install the [Fly CLI](https://fly.io/docs/flyctl/install/) and log in with
`fly auth login`. Put your production settings in `.env.prod`, starting from
`.env.example`; it's in `.gitignore`. Leave `DATABASE_URL` out, since
`fly mpg attach` sets it.

```bash
fly launch                                        # the app, from fly.toml
fly mpg create --name openfinance-db              # Managed Postgres
fly mpg attach <cluster-id> -a openfinance-app    # sets DATABASE_URL
fly secrets import -a openfinance-app < .env.prod
fly deploy
```

Migrations run before each release, from `release_command` in `fly.toml`.

## Continuous deployment

`.github/workflows/fly-deploy.yml` deploys every push to `main` with the
`FLY_API_TOKEN` repository secret. Turn it off with
`gh workflow disable fly-deploy.yml` when you aren't deploying to Fly: a deploy
starts machines again, even after `fly scale count 0`.

## Operations

```bash
fly logs -a openfinance-app
curl https://openfinance-app.fly.dev/api/health
fly mpg list                                      # find the cluster id
fly mpg connect <cluster-id>                      # psql
fly mpg proxy <cluster-id>                        # localhost:16380 for local tools
```
