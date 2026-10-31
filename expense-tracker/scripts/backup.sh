#!/usr/bin/env bash
# shellcheck disable=SC2010,SC2012  # dump names are made by backup.sh (expense-<date>-<time>[Z][-manual].dump), so ls is safe
# Database backups for the expense tracker.
#
#   scripts/backup.sh auto         daily dump if the newest daily one is 23 hours old or more (launchd runs this hourly)
#   scripts/backup.sh manual       dump now, named ...-manual.dump
#   scripts/backup.sh status       newest dumps, last Drive upload, schedule on or off
#   scripts/backup.sh list-drive   dumps stored in Google Drive
#   scripts/backup.sh fetch FILE   download and decrypt one dump from Drive into backups/fetched/
#   scripts/backup.sh drive-setup  connect Google Drive and create the encrypted remote (once per Mac)
#
# Every dump is checked, the newest BACKUP_KEEP_DAILY daily and BACKUP_KEEP_MANUAL manual dumps
# are kept (on the Mac and in Drive, counted separately on each side), and new dumps are copied
# to BACKUP_REMOTE, an rclone crypt remote. Settings come from the environment, then .env.
#
# Written for the bash 3.2 and BSD tools that ship with macOS; also runs on Linux.

set -uo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR" || exit 1

# A value from the environment, else from .env, else the default.
setting() {
  local name=$1 default=$2 value
  value=$(printenv "$name" || true)
  if [ -z "$value" ] && [ -f .env ]; then
    value=$(sed -n "s/^$name=//p" .env | tail -n 1)
  fi
  echo "${value:-$default}"
}

BACKUP_DIR=$(setting BACKUP_DIR "$APP_DIR/backups")
KEEP_DAILY=$(setting BACKUP_KEEP_DAILY 7)
KEEP_MANUAL=$(setting BACKUP_KEEP_MANUAL 3)
# "none" turns the Drive copy off.
REMOTE=$(setting BACKUP_REMOTE "expense-drive-crypt:")
[ "$REMOTE" = none ] && REMOTE=""
# Tests replace the database dump with their own command. Unset in normal use.
DUMP_CMD=$(printenv BACKUP_DUMP_CMD || true)

DAILY_AGE_MINUTES=1380   # 23 hours, so an hourly check doesn't push the dump time later each day
NOTIFY_EVERY_MINUTES=360 # at most one macOS notification per 6 hours
LAUNCHD_LABEL=com.expense-tracker.backup
GDRIVE_REMOTE=expense-gdrive
CRYPT_REMOTE=expense-drive-crypt
DRIVE_FOLDER=expense-backups

LOG="$BACKUP_DIR/backup.log"
PENDING="$BACKUP_DIR/.upload-pending"
LAST_UPLOAD="$BACKUP_DIR/.last-upload"
LAST_NOTIFY="$BACKUP_DIR/.last-notify"
LOCK="$BACKUP_DIR/.lock"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" 2>/dev/null || true

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

log() {
  local line
  line="$(now) $*"
  echo "$line"
  echo "$line" >>"$LOG"
}

# Keep the log to its last 1000 lines.
trim_log() {
  [ -f "$LOG" ] || return 0
  if [ "$(wc -l <"$LOG")" -gt 1000 ]; then
    tail -n 1000 "$LOG" >"$LOG.tmp" && mv "$LOG.tmp" "$LOG"
  fi
}

notify() {
  command -v osascript >/dev/null 2>&1 || return 0
  if [ -f "$LAST_NOTIFY" ] && [ -n "$(find "$LAST_NOTIFY" -mmin -"$NOTIFY_EVERY_MINUTES")" ]; then
    return 0
  fi
  touch "$LAST_NOTIFY"
  osascript -e "display notification \"$1\" with title \"Expense backup\"" >/dev/null 2>&1 || true
}

fail() {
  log "FAILED: $*"
  notify "$*"
  return 1
}

# Only one run at a time: launchd and make backup can overlap. A lock older than an hour is stale.
lock() {
  if [ -d "$LOCK" ] && [ -n "$(find "$LOCK" -maxdepth 0 -mmin +60)" ]; then
    rmdir "$LOCK" 2>/dev/null || true
  fi
  if ! mkdir "$LOCK" 2>/dev/null; then
    echo "Another backup is running (remove $LOCK if it is stale)." >&2
    exit 1
  fi
  trap 'rmdir "$LOCK" 2>/dev/null' EXIT
}

# Dump names, newest first. Names start with the date, so sorting by name sorts by time.
list_daily() { (cd "$BACKUP_DIR" && ls -1 expense-*.dump 2>/dev/null | grep -v -- '-manual\.dump$' | sort -r); }
list_manual() { (cd "$BACKUP_DIR" && ls -1 expense-*-manual.dump 2>/dev/null | sort -r); }

recent_daily_exists() {
  [ -n "$(find "$BACKUP_DIR" -maxdepth 1 -name 'expense-*.dump' ! -name '*-manual.dump' -mmin -"$DAILY_AGE_MINUTES")" ]
}

compose_db_running() {
  command -v docker >/dev/null 2>&1 || return 1
  docker info >/dev/null 2>&1 || return 1
  [ -n "$(docker compose ps --status running -q db 2>/dev/null)" ]
}

# Write a dump to $1. It is checked before it gets its final name, so a failed dump is never
# mistaken for a backup.
take_dump() {
  local file=$1 tmp="$1.tmp"
  if [ -n "$DUMP_CMD" ]; then
    sh -c "$DUMP_CMD" >"$tmp" 2>>"$LOG" || { rm -f "$tmp"; fail "the dump command failed"; return 1; }
  else
    compose_db_running || { fail "Docker or the database isn't running, so no backup was taken"; return 1; }
    docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
      >"$tmp" 2>>"$LOG" || { rm -f "$tmp"; fail "pg_dump failed"; return 1; }
  fi
  if [ ! -s "$tmp" ] || [ "$(head -c 5 "$tmp")" != PGDMP ]; then
    rm -f "$tmp"
    fail "the dump was empty or not a Postgres dump"
    return 1
  fi
  if [ -z "$DUMP_CMD" ] && ! docker compose exec -T db pg_restore --list <"$tmp" >/dev/null 2>>"$LOG"; then
    rm -f "$tmp"
    fail "pg_restore can't read the new dump"
    return 1
  fi
  chmod 600 "$tmp"
  mv "$tmp" "$file"
  log "dump written: $(basename "$file") ($(wc -c <"$file" | tr -d ' ') bytes)"
  touch "$PENDING"
}

# Delete all but the newest $2 names read from stdin. $1 says where: local or remote.
delete_beyond() {
  local where=$1 keep=$2 name
  tail -n +"$((keep + 1))" | while read -r name; do
    [ -n "$name" ] || continue
    if [ "$where" = local ]; then
      rm -f "$BACKUP_DIR/$name" && log "deleted on this Mac: $name"
    else
      rclone deletefile "$REMOTE$name" 2>>"$LOG" && log "deleted in Drive: $name"
    fi
  done
}

prune_local() {
  list_daily | delete_beyond local "$KEEP_DAILY"
  list_manual | delete_beyond local "$KEEP_MANUAL"
}

remote_ready() {
  command -v rclone >/dev/null 2>&1 || return 1
  rclone listremotes 2>/dev/null | grep -qx "${REMOTE%%:*}:"
}

# Copy dumps Drive doesn't have yet, then keep the newest ones there. Drive's own copies are
# pruned from Drive's own list, so losing the local folder never deletes anything in Drive.
upload() {
  [ -n "$REMOTE" ] || return 0
  [ -f "$PENDING" ] || return 0
  remote_ready || { fail "Drive isn't set up for backups. Run: make backup-drive-setup"; return 1; }
  if ! rclone copy "$BACKUP_DIR" "$REMOTE" --max-depth 1 --include 'expense-*.dump' 2>>"$LOG"; then
    fail "the upload to Google Drive failed (see backups/backup.log)"
    return 1
  fi
  local names
  names=$(rclone lsf "$REMOTE" --files-only --include 'expense-*.dump' 2>>"$LOG") || {
    fail "couldn't list the backups in Google Drive"
    return 1
  }
  echo "$names" | grep -v -- '-manual\.dump$' | sort -r | delete_beyond remote "$KEEP_DAILY"
  echo "$names" | grep -- '-manual\.dump$' | sort -r | delete_beyond remote "$KEEP_MANUAL"
  rm -f "$PENDING"
  now >"$LAST_UPLOAD"
  log "Drive is up to date"
}

new_name() { echo "$BACKUP_DIR/expense-$(date -u +%Y%m%d-%H%M%SZ)$1.dump"; }

cmd_auto() {
  lock
  trim_log
  if ! recent_daily_exists; then
    take_dump "$(new_name "")" || return 1
  fi
  prune_local
  upload
}

cmd_manual() {
  lock
  trim_log
  take_dump "$(new_name -manual)" || return 1
  prune_local
  upload
}

cmd_status() {
  echo "Folder:        $BACKUP_DIR"
  echo "Newest daily:  $(list_daily | head -n 1) ($(list_daily | grep -c . || true) kept, limit $KEEP_DAILY)"
  echo "Newest manual: $(list_manual | head -n 1) ($(list_manual | grep -c . || true) kept, limit $KEEP_MANUAL)"
  if recent_daily_exists; then echo "Daily dump:    taken in the last 23 hours"; else echo "Daily dump:    DUE (none in the last 23 hours)"; fi
  if [ -z "$REMOTE" ]; then
    echo "Drive copy:    off (BACKUP_REMOTE=none)"
  elif ! remote_ready; then
    echo "Drive copy:    NOT SET UP (run make backup-drive-setup)"
  else
    echo "Drive copy:    $REMOTE, last upload $(cat "$LAST_UPLOAD" 2>/dev/null || echo never)"
    [ -f "$PENDING" ] && echo "               an upload is waiting to be retried"
  fi
  if command -v launchctl >/dev/null 2>&1; then
    if launchctl list 2>/dev/null | grep -q "$LAUNCHD_LABEL"; then echo "Schedule:      on (hourly check)"; else echo "Schedule:      OFF (run make backup-schedule)"; fi
  fi
  echo "Last log lines:"
  tail -n 5 "$LOG" 2>/dev/null | sed 's/^/  /'
}

cmd_list_drive() {
  if [ -z "$REMOTE" ] || ! remote_ready; then echo "Drive isn't set up. Run: make backup-drive-setup" >&2; return 1; fi
  rclone lsl "$REMOTE" --include 'expense-*.dump' | sort -k 2,3 -r
}

cmd_fetch() {
  local name=${1:-}
  name=$(basename "$name")
  [ -n "$name" ] || { echo "Usage: make backup-fetch FILE=expense-....dump (see make backup-list-drive)" >&2; return 1; }
  remote_ready || { echo "Drive isn't set up. Run: make backup-drive-setup" >&2; return 1; }
  mkdir -p "$BACKUP_DIR/fetched"
  rclone copyto "$REMOTE$name" "$BACKUP_DIR/fetched/$name" || return 1
  if [ "$(head -c 5 "$BACKUP_DIR/fetched/$name")" != PGDMP ]; then
    echo "The downloaded file isn't a Postgres dump. Is the passphrase right?" >&2
    return 1
  fi
  echo "Saved backups/fetched/$name. Restore it with: make restore FILE=backups/fetched/$name"
}

cmd_drive_setup() {
  command -v rclone >/dev/null 2>&1 || { echo "Install rclone first: brew install rclone" >&2; return 1; }
  if rclone listremotes | grep -qx "$GDRIVE_REMOTE:"; then
    echo "Google Drive is already connected ($GDRIVE_REMOTE)."
  else
    echo "Connecting Google Drive. A browser window opens: sign in and allow access."
    echo "rclone asks only for drive.file, so it sees the files it creates and nothing else."
    rclone config create "$GDRIVE_REMOTE" drive scope=drive.file || return 1
  fi
  if rclone listremotes | grep -qx "$CRYPT_REMOTE:"; then
    echo "The encrypted remote already exists ($CRYPT_REMOTE)."
    return 0
  fi
  local answer pass salt
  read -r -p "Restoring on a new Mac with a passphrase you already saved? [y/N] " answer
  if [ "$answer" = y ] || [ "$answer" = Y ]; then
    read -r -s -p "Passphrase: " pass; echo
    read -r -s -p "Salt: " salt; echo
  else
    pass=$(openssl rand -base64 32)
    salt=$(openssl rand -base64 32)
  fi
  rclone config create "$CRYPT_REMOTE" crypt remote="$GDRIVE_REMOTE:$DRIVE_FOLDER" \
    password="$pass" password2="$salt" --obscure >/dev/null || return 1
  if [ "$answer" != y ] && [ "$answer" != Y ]; then
    echo
    echo "Save these two values in Bitwarden now. Without them the Drive copies can't be opened."
    echo "  Passphrase: $pass"
    echo "  Salt:       $salt"
    echo
  fi
  echo "Done. Drive folder: $DRIVE_FOLDER (file names and contents are encrypted)."
}

case "${1:-}" in
  auto) cmd_auto ;;
  manual) cmd_manual ;;
  status) cmd_status ;;
  list-drive) cmd_list_drive ;;
  fetch) cmd_fetch "${2:-}" ;;
  drive-setup) cmd_drive_setup ;;
  *)
    sed -n '4,10p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
