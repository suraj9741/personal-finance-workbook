#!/usr/bin/env bash
# shellcheck disable=SC2010,SC2012  # dump names are made by backup.sh (expense-<date>-<time>[Z][-manual].dump), so ls is safe
# Tests for scripts/backup.sh. Needs rclone. Uses a throwaway folder as "Google Drive" (through a
# real rclone crypt remote) and a fake dump command, so it touches neither Drive nor the database.
#
#   make backup-test

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/backup.sh"
command -v rclone >/dev/null 2>&1 || { echo "rclone is needed: brew install rclone" >&2; exit 1; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

export BACKUP_DIR="$WORK/backups"
export RCLONE_CONFIG="$WORK/rclone.conf"
export BACKUP_REMOTE="testcrypt:"
export BACKUP_KEEP_DAILY=7
export BACKUP_KEEP_MANUAL=3
export BACKUP_DUMP_CMD="printf 'PGDMP fake dump %s' \$\$"
DRIVE="$WORK/drive"
mkdir -p "$DRIVE"
touch "$RCLONE_CONFIG"

rclone config create testlocal local >/dev/null
rclone config create testcrypt crypt remote="testlocal:$DRIVE/expense-backups" \
  password=test-passphrase password2=test-salt --obscure >/dev/null

failures=0
check() {
  local what=$1; shift
  if "$@"; then echo "ok   $what"; else echo "FAIL $what"; failures=$((failures + 1)); fi
}
equals() { [ "$1" = "$2" ] || { echo "     expected '$2', got '$1'"; return 1; }; }

run() { "$SCRIPT" "$@" >>"$WORK/out.log" 2>&1; }
local_daily() { (cd "$BACKUP_DIR" && ls -1 expense-*.dump 2>/dev/null | grep -vc -- '-manual\.dump$'); }
local_manual() { (cd "$BACKUP_DIR" && ls -1 expense-*-manual.dump 2>/dev/null | grep -c .); }
drive_names() { rclone lsf testcrypt: --files-only | sort; }
drive_daily() { drive_names | grep -vc -- '-manual\.dump$'; }
drive_manual() { drive_names | grep -c -- '-manual\.dump$'; }

# Old dumps, named and dated in the past. $1 = how many, $2 = "" or "-manual", $3 = day offset.
make_old() {
  local i name
  for i in $(seq 1 "$1"); do
    name=$(printf 'expense-202609%02d-0%d0000%s.dump' "$((i + $3))" 1 "$2")
    printf 'PGDMP old %s' "$name" >"$BACKUP_DIR/$name"
    touch -t "202609$(printf %02d "$((i + $3))")0100" "$BACKUP_DIR/$name"
  done
}

echo "1. First run takes a daily dump and uploads it, encrypted"
run auto
check "one daily dump on the Mac" equals "$(local_daily)" 1
check "one daily dump in Drive" equals "$(drive_daily)" 1
check "Drive file names are encrypted" equals "$(find "$DRIVE" -type f -name 'expense-*' | wc -l | tr -d ' ')" 0
check "nothing waiting to upload" test ! -f "$BACKUP_DIR/.upload-pending"
check "no .tmp left behind" equals "$(find "$BACKUP_DIR" -name '*.tmp' | wc -l | tr -d ' ')" 0

echo "2. A second run within 23 hours takes no new dump"
run auto
check "still one daily dump" equals "$(local_daily)" 1

echo "3. Only the newest 7 daily and 3 manual dumps are kept, on both sides"
make_old 10 "" 0
make_old 5 -manual 12
"$SCRIPT" manual >>"$WORK/out.log" 2>&1
check "7 daily on the Mac" equals "$(local_daily)" 7
check "3 manual on the Mac" equals "$(local_manual)" 3
check "7 daily in Drive" equals "$(drive_daily)" 7
check "3 manual in Drive" equals "$(drive_manual)" 3
check "today's daily dump survived" test -n "$(cd "$BACKUP_DIR" && ls expense-*Z.dump 2>/dev/null)"
check "oldest daily dumps were the ones deleted" test ! -f "$BACKUP_DIR/expense-20260901-010000.dump"
check "a burst of manual dumps didn't touch the daily ones" equals "$(local_daily)" 7

echo "4. A failed dump leaves nothing that looks like a backup"
before=$(ls "$BACKUP_DIR" | sort)
BACKUP_DUMP_CMD="true" run manual
check "the run reports failure" test "$(tail -n 1 "$BACKUP_DIR/backup.log" | grep -c FAILED)" = 1
check "no new file and no .tmp" equals "$(ls "$BACKUP_DIR" | sort)" "$before"
BACKUP_DUMP_CMD="echo not-a-dump" run manual
check "a non-Postgres file is refused too" equals "$(ls "$BACKUP_DIR" | sort)" "$before"

echo "5. A failed upload is retried on the next run"
BACKUP_REMOTE="missing-remote:" run manual
check "upload marked as waiting" test -f "$BACKUP_DIR/.upload-pending"
check "nothing deleted on the Mac while Drive lacks a copy" equals "$(local_manual)" 4
run auto
check "next run uploaded it" test ! -f "$BACKUP_DIR/.upload-pending"
check "then the Mac was pruned to 3 manual" equals "$(local_manual)" 3
check "Drive matches the Mac" equals "$(drive_names)" "$(cd "$BACKUP_DIR" && ls -1 expense-*.dump | sort)"

echo "6. Losing the Mac's folder never deletes the Drive copies"
drive_before=$(drive_daily)
rm -f "$BACKUP_DIR"/expense-*.dump
run manual
check "Drive still has every daily dump" equals "$(drive_daily)" "$drive_before"
check "Drive still keeps 3 manual dumps" equals "$(drive_manual)" 3

echo "7. A dump fetched from Drive decrypts to the same bytes"
name=$(cd "$BACKUP_DIR" && ls -1 expense-*-manual.dump | head -n 1)
cp "$BACKUP_DIR/$name" "$WORK/original"
run fetch "$name"
check "fetched copy matches" cmp -s "$WORK/original" "$BACKUP_DIR/fetched/$name"

echo "8. BACKUP_REMOTE=none keeps backups on the Mac only"
drive_before=$(drive_names)
BACKUP_REMOTE=none run manual
check "the run succeeds" test "$(tail -n 1 "$BACKUP_DIR/backup.log" | grep -c 'dump written')" = 1
check "Drive unchanged" equals "$(drive_names)" "$drive_before"

echo "9. Older local-time names are ordered by file time, not by name"
legacy="expense-20991231-235959-manual.dump"   # name sorts newest, file time is oldest
printf 'PGDMP legacy' >"$BACKUP_DIR/$legacy"
touch -t 202601010000 "$BACKUP_DIR/$legacy"
BACKUP_REMOTE=none run manual
check "the oldest file was deleted, whatever its name" test ! -f "$BACKUP_DIR/$legacy"
check "still 3 manual on the Mac" equals "$(local_manual)" 3
check "old dumps are made private" equals "$(find "$BACKUP_DIR" -maxdepth 1 -name 'expense-*.dump' -perm -044 | wc -l | tr -d ' ')" 0

if [ "$failures" -gt 0 ]; then
  echo
  echo "$failures check(s) failed. Script output:"
  cat "$WORK/out.log"
  exit 1
fi
echo
echo "All backup checks passed."
