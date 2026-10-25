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
- `make backup` writes one now. The `backup` container also writes one when it starts, then
  every 24 hours that it keeps running.
- Both go to `expense-tracker/backups/` on the same Mac, unencrypted. **If the Mac's disk is
  lost, the backups go with it.** Copying them somewhere else is a manual step today.
- Take a backup before every deploy, restore or migration.

![The db volume is dumped by the backup loop and by make backup into ./backups on the Mac; the recommended part copies them, encrypted, off the Mac; make restore or the scratch-database check restores them](diagrams/backup-restore-architecture.drawio.svg)

Source: [diagrams/backup-restore-architecture.drawio.svg](diagrams/backup-restore-architecture.drawio.svg).
Dashed boxes are recommended, not built.

## Kinds of backup

| Kind | What it means | Here |
| --- | --- | --- |
| Database backup | The rows, the schema and the migration version | `pg_dump --format=custom` of the one database. This is the only backup that can't be recreated |
| Application-data backup | Files the app stores outside the database (uploads, attachments) | None exist. The app stores nothing outside Postgres |
| Configuration backup | Settings that live on the machine, not in git | `.env`. Everything else (`docker-compose.yml`, `config/seed.yaml`, `nginx.conf`) is in git |
| Infrastructure-state backup | Terraform state, cluster manifests, cloud resources | Not applicable. There is no IaC and no cloud. The "infrastructure" is a Mac with Docker installed |

## What to back up

| Component | Back up? | Why | How |
| --- | --- | --- | --- |
| Database `expense` in volume `expense-tracker_pgdata` | **Yes, always** | All users, entries, budgets, rules, sessions, invites | `pg_dump` (below) |
| Database roles, permissions, extensions | No separate step | There is one role, the container's superuser, created from `.env`. No extensions are used. Restores use `--no-owner`, so the target's own user owns everything | covered by the dump plus `.env` |
| `expense-tracker/.env` | **Yes, once, and after each change** | Ports, `PUBLIC_BASE_URL`, `COOKIE_SECURE`, `BACKUP_KEEP`. The password in it isn't needed to restore a dump onto a new machine | copy it to a password manager or the encrypted off-Mac location |
| Code, migrations, `config/seed.yaml`, compose and nginx config | No | In git on GitHub | note the deployed commit (`git log --oneline -1`) with each backup |
| Docker images | No | Rebuilt from source by `make up`. There is no registry | not applicable |
| Tailscale setup | No | Lives in the Tailscale app and admin console, not in the repo | sign in again on a new machine |
| Uploaded files, object storage, Kubernetes, Helm, IaC state, DNS, load balancers, certificates, cron jobs, monitoring config | Not applicable | None of them exist | none |

## How backups are taken today

### Automatic: the `backup` service

Defined in `docker-compose.yml`. It is a `postgres:16-alpine` container running this loop:

1. `pg_dump --format=custom --file=/backups/expense-<UTC date>-<UTC time>.dump.tmp`
2. If that succeeds, it renames the file to `.dump` and logs `backup written: <path>`.
   Otherwise it deletes the `.tmp` file and logs `backup FAILED`.
3. It keeps the newest `BACKUP_KEEP` (default 14) files matching `expense-*.dump`, newest by
   modification time, and deletes the rest.
4. It sleeps 86400 seconds, then repeats.

What this means in practice:

- The first dump is taken the moment the container starts. On a brand-new install, that is
  before migrations finish, so the first file is an empty database (well under 1 KB).
- "Every 24 hours" counts from the last container start. If Docker restarts, the timer starts
  over. While the Mac sleeps or Docker Desktop is stopped, nothing runs. On the Mac this
  folder held only 2 automatic dumps between 18 and 25 October 2026, 64 hours apart. Do not
  rely on this loop alone.
- File names use the container's clock, which is UTC.

Check that it is running (**Safe**):

```sh
make ps                                        # the backup service should be "Up"
docker compose logs --tail=20 backup           # "backup written: /backups/expense-....dump" lines
```

### Manual: `make backup`

```sh
make backup        # Safe
```

What it does: `docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom'`,
with the output redirected to `backups/expense-<local date>-<local time>-manual.dump` on the
host. Then it lists the newest three files.

Expect a new file of tens of KB or more for a real database. A dump of the live database was
about 55 KB in October 2026. Check its size: a 0-byte file means it failed.

- Needs the `db` container to be running.
- The name uses the **host's local time**, so on a Mac set to IST, a manual dump taken at
  00:41 IST is named `...-004113-manual.dump`, while an automatic dump taken at the same
  moment would be named with 19:11 UTC.
- If `pg_dump` fails, make reports an error **and leaves a 0-byte file behind**. Delete it
  so it isn't mistaken for a backup (see [known gaps](#known-gaps)).

### When to take one

| Moment | How |
| --- | --- |
| Before `git pull` and `make up` | `make backup` |
| Before `make restore` | `make backup`, so the restore itself can be undone |
| Before a migration to a new machine | `make backup` after freezing writes (see the [migration guide](environment-migration-guide.md)) |
| After a large data-entry session | `make backup` |
| Daily | Recommended: a scheduled `make backup` ([below](#recommended-improvements)) |

## Where backups are stored and how they are named

| Item | Current |
| --- | --- |
| Location | `expense-tracker/backups/` on the Mac (bind-mounted into the `backup` container as `/backups`). Gitignored |
| Automatic name | `expense-YYYYMMDD-HHMMSS.dump` (UTC) |
| Manual name | `expense-YYYYMMDD-HHMMSS-manual.dump` (host local time) |
| Format | `pg_dump` custom format, gzip-compressed, version 1.15 (Postgres 16) |
| Versioning | One file per backup. There is no version history beyond the retained files |
| Copies | One. **Nothing copies backups off the Mac** |

List them, newest first (**Safe**):

```sh
ls -lt backups/ | head
```

## Encryption and access

Current: none. Dumps are plain files on the Mac's disk, readable by the macOS user, and only
as safe as the Mac (FileVault, the login password). They contain every entry, email
address, password hash and session token hash, so treat them as sensitive.

Rules:

- Never commit a dump. `backups/` is gitignored; keep it that way.
- Never attach a dump to an issue, chat or email.
- Encrypt any copy that leaves the Mac. Keep the passphrase in a password manager, never in
  the repo or next to the file.

## Retention and cleanup

| Item | Current |
| --- | --- |
| Policy | The `backup` loop keeps the newest `BACKUP_KEEP` (14) files matching `expense-*.dump`, and deletes older ones each time it runs |
| Manual dumps | **Count toward the 14.** Many `make backup` runs push the automatic dumps out |
| When cleanup runs | Only when the loop runs. Between runs, the folder can hold more than 14 files |
| Off-Mac copies | No policy (none exist) |

To keep a dump out of the rotation, copy it with a different name, for example
`cp backups/<file>.dump backups/keep-<file>.dump`. The rotation only matches `expense-*`.

Recommended retention (to agree): 14 daily dumps on the Mac, plus one dump a week for
3 months and one a month for a year, off the Mac. The data is small, at around 55 KB a dump,
so storage cost isn't a limit.

## Copy backups off the Mac

Not automated today. This manual procedure uses only `openssl`, which `make env` already
needs. It is an **example that needs confirming** before you rely on it: decide where the
copies go, and test a decrypt.

**Your values:**

```sh
f=backups/<file>.dump
openssl enc -aes-256-cbc -pbkdf2 -salt -in "$f" -out "$f.enc"    # asks for a passphrase twice
shasum -a 256 "$f" > "$f.sha256"
cp "$f.enc" "$f.sha256" "<offsite-dir>/"                         # an external disk or a cloud-synced folder
rm "$f.enc"
```

- `-pbkdf2` derives the key from the passphrase properly. Without it, `openssl` uses a weak
  key derivation.
- `<offsite-dir>` must be on a different physical device or service than the Mac's disk.
- Check the copy decrypts and matches:

```sh
openssl enc -d -aes-256-cbc -pbkdf2 -in "<offsite-dir>/<file>.dump.enc" -out /tmp/check.dump
shasum -a 256 /tmp/check.dump        # same hash as <file>.dump.sha256
rm /tmp/check.dump
```

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

Current: the only record is the `backup` container's log (`backup written` or
`backup FAILED`) and the files themselves. Nothing alerts on a failure. The log is lost
when the container is removed by `make down`.

Check freshness by hand (**Safe**):

```sh
ls -lt backups/*.dump | head -1                     # newest dump and its time
find backups -name 'expense-*.dump' -mtime -1       # empty output: no dump in the last 24 hours
find backups -name 'expense-*.dump' -size 0         # any output: failed manual dumps to delete
```

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

Found while writing these docs (October 2026). They are recorded here, not fixed. Code
changes need their own pull request.

| Gap | Risk | Suggested fix |
| --- | --- | --- |
| Backups exist only on the Mac | Disk loss or theft loses the app and every backup | Encrypted off-Mac copy (above), then automate it |
| The 24-hour loop restarts its timer and stalls while the Mac sleeps | Days between automatic dumps | A launchd job running `make backup` daily (below) |
| Manual dumps count toward `BACKUP_KEEP` | A burst of manual dumps deletes the automatic ones | Only rotate files without `-manual`, or write manual dumps to their own folder |
| A failed `make backup` leaves a 0-byte file | It looks like the newest backup | Write to a `.tmp` file and rename on success, as the loop does |
| The first automatic dump on a new install is of an empty database | Takes a retention slot | Make `backup` wait for `seed` to finish |
| Manual names use local time, automatic names use UTC | Names sort in the wrong order | Use UTC (`date -u`) in the Makefile |
| No encryption | A copied dump is readable by anyone who gets it | Encrypt off-Mac copies |
| No alerting or freshness check | A stopped backup goes unnoticed | Daily freshness check with a notification |
| No restore test | A broken dump is found only when it's needed | Monthly test restore (above) |

## Recommended improvements

These are proposals. None of them exist in the repository yet.

1. **Daily `make backup` from launchd** on the Mac instead of relying on the loop. launchd
   runs a missed calendar job when the Mac wakes. Add a LaunchAgent in
   `~/Library/LaunchAgents/` that runs `make -C <repo-dir>/expense-tracker backup` each day
   at a fixed time. It needs Docker running at that time.
2. **Automatic off-Mac copy** of each new dump, encrypted, as in
   [Copy backups off the Mac](#copy-backups-off-the-mac).
3. **Freshness check:** a daily job that fails loudly (for example, a macOS notification
   through `osascript`) when `find backups -name 'expense-*.dump' -mtime -1` is empty.
4. **Fix the Makefile and the backup loop** as listed in [known gaps](#known-gaps).
5. **Agree RPO and RTO** (see the [restore guide](restore-guide.md#recovery-objectives)) and
   set the schedule from them.
