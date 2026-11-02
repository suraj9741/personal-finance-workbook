#!/usr/bin/env bash
# Deploys one image tag on the server:  scripts/deploy.sh sha-<7-char commit>
#
# The Expense tracker deploy workflow runs this over SSH. It also works by hand on the server,
# from the app folder (the one with docker-compose.deploy.yml and .env). In order, it:
#   1. takes a backup (a failed Drive upload only warns; the hourly job retries it),
#   2. pulls the images for the tag, and stops if they don't exist,
#   3. writes IMAGE_TAG to .env and restarts, waiting for every health check,
#   4. removes images older than the previous tag, to keep the small disk free.
# It never removes volumes. Rolling back = running it again with the previous tag, unless
# the new version ran a migration (then see the restore guide).

set -euo pipefail

TAG=${1:-}
if ! [[ "$TAG" =~ ^sha-[0-9a-f]{7}$ ]]; then
  echo "Usage: scripts/deploy.sh sha-<7-char commit>" >&2
  exit 2
fi

cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [ ! -f .env ] || ! grep -q '^COMPOSE_FILE=docker-compose.deploy.yml' .env; then
  echo "No .env with COMPOSE_FILE=docker-compose.deploy.yml in $PWD. Do the one-time server setup first." >&2
  exit 1
fi

env_value() { sed -n "s/^$1=//p" .env | tail -n 1; }
previous=$(env_value IMAGE_TAG)
port=$(env_value FRONTEND_PORT)
port=${port:-8080}
backup_dir=$(env_value BACKUP_DIR)
backup_dir=${backup_dir:-backups}

echo "==> Deploying $TAG (running now: ${previous:-nothing})"

echo "==> Backup"
if [ -n "$(docker compose ps -q db 2>/dev/null)" ]; then
  if ! scripts/backup.sh manual; then
    if [ -z "$(find "$backup_dir" -maxdepth 1 -name 'expense-*-manual.dump' -mmin -10 2>/dev/null)" ]; then
      echo "The backup failed, so nothing was deployed. See $backup_dir/backup.log." >&2
      exit 1
    fi
    echo "Warning: the backup was taken but not copied to Drive. The hourly job retries the upload." >&2
  fi
else
  echo "No database running yet, so there is nothing to back up."
fi

echo "==> Pull"
# Only the app images. Postgres keeps the image it has, so a deploy never upgrades it.
IMAGE_TAG=$TAG docker compose pull --quiet migrate backend frontend

if grep -q '^IMAGE_TAG=' .env; then
  sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=$TAG/" .env
else
  echo "IMAGE_TAG=$TAG" >>.env
fi

echo "==> Start"
if ! docker compose up -d --remove-orphans --wait --wait-timeout 300; then
  docker compose ps -a
  docker compose logs --tail=40 migrate seed backend frontend || true
  echo "The deploy of $TAG failed. To roll back: scripts/deploy.sh ${previous:-<previous tag>}" >&2
  echo "If a migration ran, restore the backup taken above instead (restore guide)." >&2
  exit 1
fi

echo "==> Check"
curl -fsS "http://127.0.0.1:$port/nginx-health" >/dev/null
api=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/api/v1/auth/me")
if [ "$api" != 401 ]; then
  echo "The API answered $api through nginx, expected 401 (not logged in)." >&2
  exit 1
fi
docker compose ps

echo "==> Tidy"
# Keep the images for this tag and the previous one (for a quick rollback).
docker images --format '{{.Repository}}:{{.Tag}}' |
  grep -E '/expense-tracker-(backend|frontend):sha-[0-9a-f]{7}$' |
  grep -v -e ":$TAG\$" ${previous:+-e ":$previous\$"} |
  xargs -r docker rmi >/dev/null 2>&1 || true

echo "==> Deployed $TAG (previous: ${previous:-none})"
