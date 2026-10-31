# Application and infrastructure backup guide

What to back up, how backups are taken today, how to check that one is usable, and what is
still missing. To get data back from a backup, use the [restore guide](restore-guide.md).
The commands alone are in the [quick reference](quick-reference-commands.md#3-take-a-backup).

Commands run from `expense-tracker/` on the machine that runs the app. Marks: **Safe**
(read-only or repeatable), **Your values** (replace `<placeholders>`), **Destructive**
(deletes or replaces data).

## The short version

- Everything that matters is in one Postgres database. A `pg_dump` file is a complete
  backup of it.
- A launchd job on the Mac checks every hour and takes a daily dump when the newest one is
  23 hours old or more. `make backup` takes a manual one at any time.
- Each dump is checked, kept in `~/expense-tracker-backups` (`expense-tracker/backups` links
  there), encrypted with rclone and copied
  to Google Drive. The newest **7 daily** and **3 manual** dumps are kept, on the Mac and in
  Drive. Older ones are deleted.
- `make backup-status` shows the newest dumps, the last upload and whether the schedule is on.
  A failure shows a macOS notification.
- The Drive copies can only be opened with the passphrase and salt saved in Bitwarden.
- Take a backup before every deploy, restore or migration.

![launchd and make backup run scripts/backup.sh, which dumps the db, writes ./backups, encrypts with rclone crypt and copies to Google Drive; restore from ./backups on the same machine or fetch from Drive on a recovery machine](diagrams/backup-restore-architecture.drawio.svg)

Source: [diagrams/backup-restore-architecture.drawio.svg](diagrams/backup-restore-architecture.drawio.svg).

## Kinds of backup

| Kind | What it means | Here |
| --- | --- | --- |
| Database backup | The rows, the schema and the migration version | `pg_dump --format=custom` of the one database. This is the only backup that can't be recreated |
| Application-data backup | Files the app stores outside the database (uploads, attachments) | None exist. The app stores nothing outside Postgres |
| Configuration backup | Settings that live on the machine, not in git | `.env`, and the rclone config that holds the Drive sign-in. Everything else is in git |
| Infrastructure-state backup | Terraform state, cluster manifests, cloud resources | Not applicable. There is no IaC and no cloud. The "infrastructure" is a Mac with Docker installed |

## What to back up

| Component | Back up? | Why | How |
| --- | --- | --- | --- |
| Database `expense` in volume `expense-tracker_pgdata` | **Yes, always** | All users, entries, budgets, rules, sessions, invites | `scripts/backup.sh` (below) |
| Database roles, permissions, extensions | No separate step | There is one role, the container's superuser, created from `.env`. No extensions are used. Restores use `--no-owner`, so the target's own user owns everything | covered by the dump plus `.env` |
| `expense-tracker/.env` | **Yes, once, and after each change** | Ports, `PUBLIC_BASE_URL`, `COOKIE_SECURE`, the `BACKUP_*` settings. The password in it isn't needed to restore a dump onto a new machine | copy it to Bitwarden |
| Drive passphrase and salt | **Yes, once** | Without them the Drive copies can't be decrypted. There is no reset | saved in Bitwarden by `make backup-drive-setup` (you copy them in) |
| `~/.config/rclone/rclone.conf` | No | The Drive sign-in token and the passphrase in obscured (not encrypted) form. Recreated by `make backup-drive-setup` | not applicable |
| Code, migrations, `config/seed.yaml`, compose and nginx config | No | In git on GitHub | note the deployed commit (`git log --oneline -1`) with each backup |
| Docker images | No | Rebuilt from source by `make up`. There is no registry | not applicable |
| Tailscale setup | No | Lives in the Tailscale app and admin console, not in the repo | sign in again on a new machine |
| Uploaded files, object storage, Kubernetes, Helm, IaC state, DNS, load balancers, certificates, monitoring config | Not applicable | None of them exist | none |

## How backups are taken

Everything goes through one script, `scripts/backup.sh`. It runs on the Mac, not in a
container, and reaches the database with `docker exec <db container> pg_dump`. It finds the
container by its Compose labels (project `expense-tracker`, service `db`), so it needs no
compose file.

### Daily: the launchd job

macOS doesn't let a background job open anything in `~/Documents` (or Desktop or Downloads).
The app folder usually sits there, so the job never touches it. When it did, launchd gave up
before the script started: `launchctl print` showed `last exit code = 78: EX_CONFIG` and
nothing reached the log. `make backup-schedule` (`scripts/backup.sh install`) sets up the
job outside the app folder:

1. Moves `backups/` to `~/expense-tracker-backups` and leaves `backups` as a link to it, so
   `backups/...` paths in these guides still work. It never overwrites a file. If a name
   already exists on both sides it stops and moves nothing more. Skipped when `BACKUP_DIR` in
   `.env` names a folder of your own.
2. Copies `scripts/backup.sh` and the backup settings from `.env` into
   `~/.local/share/expense-tracker/`.
3. Installs `~/Library/LaunchAgents/com.expense-tracker.backup.plist`, which runs that copy.

`make up` refreshes the copy when the schedule is on, so a deploy that changes the script
reaches the job. `make backup-status` says when the copy is out of date. Run
`make backup-schedule` again after changing a `BACKUP_` setting in `.env`.

launchd runs the copy with `auto` every hour and when you log in. Each run:

1. Takes a dump only if the newest daily dump is 23 hours old or more. So a Mac that slept or
   was switched off catches up within an hour of waking, and the dump time doesn't drift.
2. Writes the dump to a `.tmp` file, then checks it starts with `PGDMP` and that
   `pg_restore --list` can read it. Only then does it get its `.dump` name. A failed dump is
   deleted, never left looking like a backup.
3. Copies the dumps Drive doesn't have yet, then keeps the newest 7 daily and 3 manual dumps
   in Drive. Drive is pruned from its own file list, so losing the local folder never deletes
   anything in Drive.
4. Only after a successful upload, keeps the newest 7 daily and 3 manual dumps on the Mac and
   deletes the rest. While Drive is not set up or an upload keeps failing, nothing on the Mac
   is deleted.
5. Appends what it did to `backup.log` in the backups folder. On a failure it also shows a macOS
   notification (at most one every 6 hours) and the next hourly run tries again.

An hourly run with nothing to do takes no dump and makes no network call.

What it needs:

- **Docker Desktop running.** If it isn't, the run fails with "Docker or the database isn't
  running" and retries an hour later. Turn on "Start Docker Desktop when you sign in".
- **The Mac powered on.** Nothing runs while it is off. The first check after it starts
  catches up.

Turn it on or off (**Safe**):

```sh
make backup-schedule      # on
make backup-unschedule    # off
make backup-status        # "Schedule: on (hourly check)"
```

If the status says "on, but the last run FAILED (exit code N)", the job is loaded but its
last run failed. Exit code 1 is a backup failure; the log says which. Exit code 78 means
launchd couldn't start the job at all: run `make backup-schedule` again from the app folder.

### Manual: `make backup`

```sh
make backup        # Safe
```

Runs `scripts/backup.sh manual`: always takes a dump, named `...-manual.dump`, then does
steps 2 to 5 above. Manual dumps are counted separately from daily ones, so a burst of
`make backup` runs never pushes a daily dump out.

### When to take one

| Moment | How |
| --- | --- |
| Before `git pull` and `make up` | `make backup` |
| Before `make restore` | `make backup`, so the restore itself can be undone |
| Before a migration to a new machine | `make backup` after freezing writes (see the [migration guide](environment-migration-guide.md)) |
| After a large data-entry session | `make backup` |
| Daily | Automatic, once `make backup-schedule` has been run |

## Set up the Drive copy (once per Mac)

**Your values**, on the Mac, from `expense-tracker/`:

```sh
brew install rclone
make backup-drive-setup
```

1. A browser opens. Sign in to Google and allow access. rclone asks only for `drive.file`,
   so it can see the files it creates and nothing else in your Drive.
2. Answer `N` to "Reuse a passphrase and salt from Bitwarden?". The script makes a random
   passphrase and salt, creates the encrypted remote `expense-drive-crypt:` over the Drive
   folder `expense-backups`, and prints both values once. (`y` is only for a new machine: it
   asks you to paste the saved values, with hidden input, and refuses empty ones.)
3. **Save the passphrase and salt in Bitwarden now.** Without them the Drive copies are
   unreadable, and there is no way to reset them.
4. `make backup-schedule`, then `make backup`, then `make backup-status`. Expect "Drive copy:
   expense-drive-crypt:, last upload <just now>".

Answered the prompt wrongly? Run `rclone config delete expense-drive-crypt` and
`make backup-drive-setup` again. The Google sign-in is kept. If `make backup` already ran with
the wrong key, empty the `expense-backups` folder in Drive first: the new key can't read
those files.

To keep backups on the Mac only, set `BACKUP_REMOTE=none` in `.env`.

## Where backups are stored and how they are named

| Item | Current |
| --- | --- |
| On the Mac | `~/expense-tracker-backups`, mode 700, with `expense-tracker/backups` (gitignored) linking to it. Also holds `backup.log` and the `.last-upload` and `.upload-pending` markers |
| Scheduled copy | `~/.local/share/expense-tracker/`: the script launchd runs, its settings and the job file. Rebuilt by `make backup-schedule` |
| In Drive | Folder `expense-backups` in My Drive. File names and contents are encrypted, so Drive shows random names |
| Daily name | `expense-YYYYMMDD-HHMMSSZ.dump` (UTC) |
| Manual name | `expense-YYYYMMDD-HHMMSSZ-manual.dump` (UTC) |
| Older names | `expense-YYYYMMDD-HHMMSS.dump` (UTC) and `...-manual.dump` (local time) from before October 2026. They are counted and pruned the same way, newest by file time |
| Format | `pg_dump` custom format, gzip-compressed, version 1.15 (Postgres 16) |
| Copies | Two: the Mac and Google Drive |

List them, newest first (**Safe**):

```sh
ls -lt backups/ | head
make backup-list-drive
```

## Encryption and access

| Where | Protection |
| --- | --- |
| On the Mac | None beyond the Mac itself (FileVault, the login password). Files are mode 600 |
| In Drive | rclone `crypt`: file contents with XSalsa20-Poly1305, names with EME, keys from the passphrase and salt via scrypt. Encrypted on the Mac before upload |
| Passphrase and salt | Bitwarden, plus an obscured (not encrypted) copy in `~/.config/rclone/rclone.conf` on the Mac |

The dumps contain every entry, email address, password hash and session token hash, so treat
them as sensitive.

Rules:

- Never commit a dump. `backups/` is gitignored; keep it that way.
- Never attach a dump to an issue, chat or email.
- Never copy the passphrase into the repo, `.env` or a note next to the files.

## Retention and cleanup

| Item | Current |
| --- | --- |
| Policy | The newest `BACKUP_KEEP_DAILY` (7) daily and `BACKUP_KEEP_MANUAL` (3) manual dumps, by count. Change them in `.env` |
| Where | On the Mac and in Drive, each pruned from its own list |
| When | Every run that takes a dump or uploads. The Mac is pruned only after Drive has a copy (or when `BACKUP_REMOTE=none`) |
| Newest means | By file modification time, not by name, so older local-time names sort correctly |
| Why by count, not by age | A Mac left off for two weeks still has 7 copies when it comes back |
| Deleted in Drive | Go to the Drive bin, which Google empties after 30 days. They are encrypted there too |

With daily dumps, 7 daily copies cover about a week. A mistake noticed later than that has no
clean copy left, so raise `BACKUP_KEEP_DAILY` if you want a longer window. At about 55 KB a
dump, storage isn't a limit.

To keep a dump out of the rotation, copy it with a different name, for example
`cp backups/<file>.dump backups/keep-<file>.dump`. The rotation only matches `expense-*`.

## Verify a backup

Do all three for any dump you might rely on. None of them touch the live data.

**1. The file is a complete custom-format dump (Safe):**

```sh
f=backups/<file>.dump
ls -l "$f"                                          # not 0 bytes
head -c 5 "$f"; echo                                # PGDMP
docker compose exec -T db pg_restore --list < "$f" | head -12
```

Expect a header with `Format: CUSTOM` and `Dumped from database version: 16.x`. Then check
that every table has data in the table of contents:

```sh
docker compose exec -T db pg_restore --list < "$f" | grep -c 'TABLE DATA'    # 17 at migration 0009
```

**2. It restores cleanly into a scratch database (Safe; it creates and then drops
`restore_check`, not the live database):**

```sh
docker compose exec -T db sh -c 'createdb -U "$POSTGRES_USER" restore_check'
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d restore_check --no-owner --exit-on-error' < "$f"
echo $?                                              # 0
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d restore_check -Atc "SELECT version_num FROM alembic_version; SELECT count(*) FROM users; SELECT count(*) FROM transactions"'
docker compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" restore_check'
```

**3. The counts look right.** Compare the scratch counts with the live ones, or with what
you expect. A dump taken a few minutes ago should match the live database:

```sh
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM users; SELECT count(*) FROM transactions"'
```

## Record and monitor backup results

- `backups/backup.log` (in `~/expense-tracker-backups`): one line per dump, deletion and upload, and every failure. It keeps
  its last 1000 lines.
- A macOS notification on any failure, at most one every 6 hours.
- `make backup-status` (**Safe**):

```text
Folder:        /Users/.../expense-tracker/backups
Newest daily:  expense-20261031-073000Z.dump (7 kept, limit 7)
Newest manual: expense-20261030-201500Z-manual.dump (3 kept, limit 3)
Daily dump:    taken in the last 23 hours
Drive copy:    expense-drive-crypt:, last upload 2026-10-31T07:30:04Z
Schedule:      on (hourly check)
```

"DUE", "NOT SET UP", "OFF" or "an upload is waiting to be retried" in that output need a look.

## Test a restore in a separate environment

Run this once a month, and after any change to the backup setup. Two options:

- **Scratch database** (quick): step 2 of [Verify a backup](#verify-a-backup).
- **A full second stack** (closest to a real recovery). It runs beside the live app on other
  ports with its own volume. **Your values:**

```sh
git clone https://github.com/suraj9741/personal-finance-workbook.git /tmp/restore-test
cd /tmp/restore-test/expense-tracker
export COMPOSE_PROJECT_NAME=expense-tracker-restoretest   # own containers and volume; the live stack is untouched
make env
sed -i.bak 's/^FRONTEND_PORT=.*/FRONTEND_PORT=18080/; s/^BACKEND_PORT=.*/BACKEND_PORT=18000/' .env && rm .env.bak
echo BACKUP_REMOTE=none >> .env                            # never upload test dumps: they would count toward the 7 in Drive
make up
mkdir -p backups && cp <repo-dir>/expense-tracker/backups/<file>.dump backups/
make restore FILE=backups/<file>.dump                     # type yes; this replaces only the test stack's empty database
curl -s http://localhost:18000/readyz                     # {"status":"ok"}
```

Log in at `http://localhost:18080` with a real account and spot-check a few months. Then
remove the test stack. **Destructive, for the test stack only.** Check `COMPOSE_PROJECT_NAME`
first:

```sh
echo "$COMPOSE_PROJECT_NAME"                               # must print expense-tracker-restoretest
docker compose down -v                                    # deletes the TEST volume only
cd / && rm -rf /tmp/restore-test
```

Without `COMPOSE_PROJECT_NAME`, `docker compose down -v` would delete the **live** volume.
If in doubt, run `docker volume ls` first. Only `expense-tracker-restoretest_pgdata` should
go.

## Known gaps

| Gap | Risk | Suggested fix |
| --- | --- | --- |
| No dump while the Mac is off or Docker Desktop is closed | Gaps of days if the Mac stays off | Start Docker Desktop at login. The hourly check catches up once both are running |
| 7 daily copies cover about a week | A mistake noticed later has no clean copy | Raise `BACKUP_KEEP_DAILY`, or keep a weekly copy longer |
| One off-Mac copy, in one Google account | Losing that account loses the off-Mac copies | Accept for now; add a second remote later if needed |
| The passphrase is only in Bitwarden and the Mac | Losing both makes the Drive copies useless | Check once that Bitwarden has it |
| No automatic restore test | A broken dump is found only when it's needed | Each dump is checked with `pg_restore --list`; also run the monthly test restore (above) |
| `.env` isn't copied automatically | A new Mac needs it rebuilt by hand | Keep a copy in Bitwarden |

## Change history

- October 2026: the `backup` container loop was replaced by `scripts/backup.sh` and a launchd
  job, with encrypted Google Drive copies and count-based retention (7 daily, 3 manual). This
  fixed: no off-Mac copy, the timer that reset on restarts, manual dumps counting toward the
  limit, 0-byte files from a failed `make backup`, the empty first dump on a new install, and
  mixed local and UTC names.
- 31 October 2026: the launchd job never ran, because macOS blocked it from the app folder in
  `~/Documents` (exit code 78). The job now runs a copy of the script from
  `~/.local/share/expense-tracker`, and the dumps moved to `~/expense-tracker-backups`.
  `make backup-status` now reports a failing schedule instead of "on".
