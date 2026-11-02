#!/usr/bin/env bash
# The only thing the GitHub deploy key can run on the server. Install it once, in the deploy
# user's ~/.ssh/authorized_keys, in front of that key:
#
#   command="/home/deploy/expense-tracker/scripts/deploy-gate.sh",restrict ssh-ed25519 AAAA... github-deploy
#
# sshd then runs this script whatever the client asks for, with no shell, pty or forwarding.
# The client's words arrive in SSH_ORIGINAL_COMMAND, and only "deploy sha-<7-char commit>" is
# accepted. So a leaked key can redeploy an image that already exists, and nothing else.
#
# Before deploying it refreshes docker-compose.deploy.yml, backup.sh and deploy.sh from main.
# Never from a commit the client names: GitHub serves forks' commits under this repo's URLs.
# This script itself is not refreshed: update it by hand if it ever changes.

set -euo pipefail

REPO_RAW=https://raw.githubusercontent.com/suraj9741/personal-finance-workbook/main/expense-tracker
APP_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)

read -r -a words <<<"${SSH_ORIGINAL_COMMAND:-}"
if [ "${#words[@]}" -ne 2 ] || [ "${words[0]}" != deploy ] || ! [[ "${words[1]}" =~ ^sha-[0-9a-f]{7}$ ]]; then
  echo "This key can only run: deploy sha-<7-char commit>" >&2
  exit 2
fi
tag=${words[1]}

echo "==> Refreshing the compose file and scripts from main"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
for file in docker-compose.deploy.yml scripts/backup.sh scripts/deploy.sh; do
  mkdir -p "$tmp/$(dirname "$file")"
  curl -fsSL --retry 3 "$REPO_RAW/$file" -o "$tmp/$file"
done
install -m 644 "$tmp/docker-compose.deploy.yml" "$APP_DIR/docker-compose.deploy.yml"
install -m 755 "$tmp/scripts/backup.sh" "$tmp/scripts/deploy.sh" "$APP_DIR/scripts/"

exec "$APP_DIR/scripts/deploy.sh" "$tag"
