#!/usr/bin/env bash
# Deploys the API on the production host: checks out DEPLOY_REF (origin/main by
# default), builds the image, runs migrations, then replaces the app container.
#
#   /root/openfinance/scripts/deploy.sh
#   DEPLOY_REF=<commit or origin/branch> /root/openfinance/scripts/deploy.sh
#
# GitHub Actions runs it through a forced-command SSH key; see
# docs/deploy-docker-compose.md.
set -euo pipefail

compose() {
  docker compose --env-file .env.prod -f docker-compose.prod.yml "$@"
}

# Everything runs inside main so bash has parsed the whole file before the
# checkout below rewrites it.
main() {
  cd "$(dirname "$0")/.."

  exec 9>/var/lock/openfinance-deploy.lock
  if ! flock -w 600 9; then
    echo "Another deploy is still running" >&2
    exit 1
  fi

  local ref="${DEPLOY_REF:-origin/main}"
  git fetch --quiet --prune origin
  git checkout --quiet --detach "$ref"
  echo "Deploying $(git log -1 --format='%h %s')"

  compose config --quiet
  compose build app
  compose up -d --wait db
  compose run --rm migrate
  compose up -d --wait --wait-timeout 180 app

  # A file bind mount keeps the old inode after git replaces the Caddyfile, so
  # recreate Caddy when the file it sees differs. Otherwise `up` only recreates
  # it when its environment changed.
  if compose exec -T caddy cat /etc/caddy/Caddyfile < /dev/null 2>/dev/null | cmp -s - Caddyfile; then
    compose up -d caddy
  else
    compose up -d --force-recreate caddy
  fi

  docker image prune -f >/dev/null
  echo "Deployed $(git rev-parse --short HEAD)"
}

main "$@"
exit
