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
#   scripts/backup.sh install      copy this script and its settings out of the app folder for launchd
#
# Every dump is checked, the newest BACKUP_KEEP_DAILY daily and BACKUP_KEEP_MANUAL manual dumps
# are kept (on the Mac and in Drive, counted separately on each side), and new dumps are copied
# to BACKUP_REMOTE, an rclone crypt remote. Settings come from the environment, then .env.
#
# The scheduled job runs a copy installed in ~/.local/share/expense-tracker, and the dumps live in
# ~/expense-tracker-backups (backups/ links there). macOS won't let a background job open anything
# in ~/Documents, where the app folder usually sits, so the job never touches the app folder.
#
# Written for the bash 3.2 and BSD tools that ship with macOS; also runs on Linux.

set -uo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
SELF="$APP_DIR/scripts/$(basename "${BASH_SOURCE[0]}")"
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
# The database container is found by its Compose labels, so no compose file is needed.
COMPOSE_PROJECT=$(setting BACKUP_COMPOSE_PROJECT expense-tracker)
# Tests replace the database dump with their own command. Unset in normal use.
DUMP_CMD=$(printenv BACKUP_DUMP_CMD || true)

DAILY_AGE_MINUTES=1380   # 23 hours, so an hourly check doesn't push the dump time later each day
NOTIFY_EVERY_MINUTES=360 # at most one macOS notification per 6 hours
LAUNCHD_LABEL=com.expense-tracker.backup
GDRIVE_REMOTE=expense-gdrive
CRYPT_REMOTE=expense-drive-crypt
DRIVE_FOLDER=expense-backups
# Where `install` puts the copy launchd runs, and the backups folder outside the app folder.
RUNNER_DIR="$HOME/.local/share/expense-tracker"
RUNNER="$RUNNER_DIR/scripts/backup.sh"
OUTSIDE_DIR="$HOME/expense-tracker-backups"

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

# Dump names, newest first by modification time. Not by name: dumps from before October 2026
# have manual names in local time, which sort wrongly against the UTC ones.
list_daily() { (cd "$BACKUP_DIR" && ls -1t expense-*.dump 2>/dev/null | grep -v -- '-manual\.dump$'); }
list_manual() { (cd "$BACKUP_DIR" && ls -1t expense-*-manual.dump 2>/dev/null); }

recent_daily_exists() {
  [ -n "$(find "$BACKUP_DIR" -maxdepth 1 -name 'expense-*.dump' ! -name '*-manual.dump' -mmin -"$DAILY_AGE_MINUTES")" ]
}

# The running database container's id, or nothing.
db_container() {
  command -v docker >/dev/null 2>&1 || return 0
  docker ps -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" \
    --filter label=com.docker.compose.service=db --filter status=running 2>/dev/null | head -n 1
}

# Write a dump to $1. It is checked before it gets its final name, so a failed dump is never
# mistaken for a backup.
take_dump() {
  local file=$1 tmp="$1.tmp" db=""
  if [ -n "$DUMP_CMD" ]; then
    sh -c "$DUMP_CMD" >"$tmp" 2>>"$LOG" || { rm -f "$tmp"; fail "the dump command failed"; return 1; }
  else
    db=$(db_container)
    [ -n "$db" ] || { fail "Docker or the database isn't running, so no backup was taken"; return 1; }
    docker exec -i "$db" sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' \
      >"$tmp" 2>>"$LOG" || { rm -f "$tmp"; fail "pg_dump failed"; return 1; }
  fi
  if [ ! -s "$tmp" ] || [ "$(head -c 5 "$tmp")" != PGDMP ]; then
    rm -f "$tmp"
    fail "the dump was empty or not a Postgres dump"
    return 1
  fi
  if [ -n "$db" ] && ! docker exec -i "$db" pg_restore --list <"$tmp" >/dev/null 2>>"$LOG"; then
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
  chmod 600 "$BACKUP_DIR"/expense-*.dump 2>/dev/null || true
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
  # "modtime|name" lines, newest first, then just the names.
  local names
  names=$(rclone lsf "$REMOTE" --files-only --include 'expense-*.dump' --format tp --separator '|' 2>>"$LOG" |
    sort -r | cut -d '|' -f 2) || {
    fail "couldn't list the backups in Google Drive"
    return 1
  }
  echo "$names" | grep -v -- '-manual\.dump$' | delete_beyond remote "$KEEP_DAILY"
  echo "$names" | grep -- '-manual\.dump$' | delete_beyond remote "$KEEP_MANUAL"
  rm -f "$PENDING"
  now >"$LAST_UPLOAD"
  log "Drive is up to date"
}

# A new dump name, never an existing one: two dumps in the same second would overwrite.
new_name() {
  local file
  file="$BACKUP_DIR/expense-$(date -u +%Y%m%d-%H%M%SZ)$1.dump"
  while [ -e "$file" ]; do
    sleep 1
    file="$BACKUP_DIR/expense-$(date -u +%Y%m%d-%H%M%SZ)$1.dump"
  done
  echo "$file"
}

# Upload first, and prune this Mac only once Drive has a copy, so old dumps are never deleted
# while the only other copy is missing.
upload_then_prune() {
  if upload; then
    prune_local
  else
    log "kept the older dumps on this Mac until Drive has a copy"
    return 1
  fi
}

cmd_auto() {
  lock
  trim_log
  if ! recent_daily_exists; then
    take_dump "$(new_name "")" || return 1
  fi
  upload_then_prune
}

cmd_manual() {
  lock
  trim_log
  take_dump "$(new_name -manual)" || return 1
  upload_then_prune
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
    local job exit_code
    if job=$(launchctl print "gui/$(id -u)/$LAUNCHD_LABEL" 2>/dev/null); then
      exit_code=$(echo "$job" | sed -n 's/.*last exit code = \([0-9]*\).*/\1/p' | head -n 1)
      if [ -n "$exit_code" ] && [ "$exit_code" != 0 ]; then
        echo "Schedule:      on, but the last run FAILED (exit code $exit_code; see the log below)"
      else
        echo "Schedule:      on (hourly check)"
      fi
    else
      echo "Schedule:      OFF (run make backup-schedule)"
    fi
  fi
  if [ -f "$RUNNER" ] && [ "$SELF" != "$RUNNER" ] && ! cmp -s "$SELF" "$RUNNER"; then
    echo "               the scheduled copy is out of date (run make backup-schedule)"
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
  echo
  echo "First setup: answer N, and a new passphrase and salt are made and printed for Bitwarden."
  echo "Answer y only on a new machine, to reuse the passphrase and salt already in Bitwarden."
  read -r -p "Reuse a passphrase and salt from Bitwarden? [y/N] " answer
  if [ "$answer" = y ] || [ "$answer" = Y ]; then
    read -r -s -p "Paste the passphrase from Bitwarden (hidden): " pass; echo
    read -r -s -p "Paste the salt from Bitwarden (hidden): " salt; echo
    if [ -z "$pass" ] || [ -z "$salt" ]; then
      echo "The passphrase and salt can't be empty. Nothing was set up; run make backup-drive-setup again." >&2
      return 1
    fi
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

# Prepare everything the scheduled job needs outside the app folder:
#  1. the backups folder: backups/ moves to ~/expense-tracker-backups and becomes a link to it
#     (skipped when BACKUP_DIR is set to a folder of your own);
#  2. a copy of this script, with the backup settings from .env, in ~/.local/share/expense-tracker;
#  3. the launchd job file, written next to that copy for `make backup-schedule` to load.
# Safe to run again: it refreshes the copy and settings.
cmd_install() {
  local target entry
  if [ "$SELF" = "$RUNNER" ]; then
    echo "Run install from the app folder (make backup-schedule), not from the scheduled copy." >&2
    return 1
  fi
  if [ "$BACKUP_DIR" != "$APP_DIR/backups" ]; then
    target=$BACKUP_DIR
  elif [ -L backups ]; then
    target=$(cd backups && pwd -P)
  else
    if [ -d backups/.lock ]; then
      echo "A backup is running. Try again in a minute (or remove backups/.lock if it is stale)." >&2
      return 1
    fi
    target=$OUTSIDE_DIR
    mkdir -p "$target" && chmod 700 "$target" || return 1
    # Move everything over, never overwriting, then swap the folder for a link.
    for entry in backups/* backups/.[!.]*; do
      [ -e "$entry" ] || continue
      mv -n "$entry" "$target/" 2>/dev/null || true
    done
    if ! rmdir backups 2>/dev/null; then
      echo "Some files in backups/ already exist in $target, so nothing more was moved." >&2
      echo "Compare the two folders, move what's left by hand, then run this again." >&2
      return 1
    fi
    ln -s "$target" backups
    echo "Moved the backups to $target (backups/ now links there)."
  fi
  mkdir -p "$RUNNER_DIR/scripts" || return 1
  cp "$SELF" "$RUNNER.tmp" && chmod 700 "$RUNNER.tmp" && mv "$RUNNER.tmp" "$RUNNER" || return 1
  {
    echo "# Written by make backup-schedule from $APP_DIR/.env. Run it again after changing backup settings."
    echo "BACKUP_DIR=$target"
    echo "BACKUP_KEEP_DAILY=$KEEP_DAILY"
    echo "BACKUP_KEEP_MANUAL=$KEEP_MANUAL"
    echo "BACKUP_REMOTE=${REMOTE:-none}"
    echo "BACKUP_COMPOSE_PROJECT=$COMPOSE_PROJECT"
  } >"$RUNNER_DIR/.env"
  chmod 600 "$RUNNER_DIR/.env"
  sed -e "s|@RUNNER@|$RUNNER|g" -e "s|@BACKUP_DIR@|$target|g" \
    "$APP_DIR/scripts/launchd/$LAUNCHD_LABEL.plist" >"$RUNNER_DIR/$LAUNCHD_LABEL.plist" || return 1
  echo "Installed the scheduled copy in $RUNNER_DIR."
}

case "${1:-}" in
  auto) cmd_auto ;;
  manual) cmd_manual ;;
  status) cmd_status ;;
  list-drive) cmd_list_drive ;;
  fetch) cmd_fetch "${2:-}" ;;
  drive-setup) cmd_drive_setup ;;
  install) cmd_install ;;
  *)
    sed -n '4,11p' "$0" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
