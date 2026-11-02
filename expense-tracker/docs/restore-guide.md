# Backup restoration and disaster recovery guide

How to get the expense tracker back after lost or wrong data, a broken database, a lost
machine or a failed deploy. Backups themselves are covered in the
[backup guide](backup-guide.md), and the commands alone are in the
[quick reference](quick-reference-commands.md#4-restore-a-backup).

> **The live app runs on the server.** For a restore there, use
> [On the server (production)](#on-the-server-production). The rest of this guide is
> written for the Mac, where `make` and a clone of the repository exist.

Commands run from `expense-tracker/` unless stated. Marks: **Safe** (read-only or
repeatable), **Your values** (replace `<placeholders>`), **Destructive** (deletes or
replaces data).

## Read this before restoring anything

- **`make restore` replaces the entire database.** Every user, household and entry made
  after the dump was taken is gone, including entries other household members made. There
  is no merge.
- Before restoring into the live app, check three things: which machine you are on, which
  Compose project you are using, and how much data will be lost. Tell anyone else in the
  household first.
- **Always run `make backup` right before a restore.** That dump is how you undo the
  restore.
- **Never run `docker compose down -v`** to "start clean". It deletes the volume. The restore
  itself already starts from an empty schema.
- No passwords or tokens are needed for a restore, and none belong in these docs. The dump
  holds the users' password hashes, so everyone logs in with the password they had when the
  dump was taken.

Check where you are (**Safe**):

```sh
hostname; pwd                                   # the machine and folder you expect
echo "${COMPOSE_PROJECT_NAME:-expense-tracker}" # expense-tracker is the live app
docker compose ps --format '{{.Name}} {{.Status}}'
```

## On the server (production)

The live app runs on the droplet. The server has no clone of the repository and no `make`,
so `make restore` and the other `make` commands in this guide don't exist there. Use the
steps below instead. They do what `make restore` does, plus a few safety steps the server
needs. Server setup and the meaning of **root** and **deploy** are in the
[server setup guide](server-setup-guide.md).

| Situation | Use |
| --- | --- |
| Entries deleted or changed by mistake, or the data is wrong | [Restore on the running server](#restore-on-the-running-server) |
| A deploy's migration broke the app | [Server setup guide, Part C, "Roll back"](server-setup-guide.md#part-c-every-deploy-after-that): the same restore, then `scripts/deploy.sh` with the previous tag |
| The droplet is lost or won't boot | [The server is lost](#the-server-is-lost) |
| Moving on purpose to a new droplet | [Server setup guide, Move to another server](server-setup-guide.md#move-to-another-server) |

### Restore on the running server

**Destructive.** This replaces all data in the server's database, for every member of the
household. Everything entered after the dump was taken is gone. Run everything as
**deploy** (from **root**: `su - deploy`), in `~/expense-tracker`. `.env` there sets
`COMPOSE_FILE=docker-compose.deploy.yml`, so plain `docker compose` talks to the live stack.

1. **Check where you are (Safe).**

   ```sh
   cd ~/expense-tracker && hostname && docker compose ps --format '{{.Name}} {{.Status}}'
   ```

   Expect the droplet's name, and `expense-tracker-db-1`, `-backend-1`, `-frontend-1` and
   `-caddy-1` up.

2. **Pick a dump (Safe).** The server keeps its own copies, so most of the time nothing needs
   downloading:

   ```sh
   ls -lt backups/expense-*.dump | head            # on the server, newest first
   scripts/backup.sh list-drive                    # the encrypted copies in Google Drive
   ```

   Take the newest dump from **before** the problem started. Names are in UTC
   (`expense-YYYYMMDD-HHMMSSZ[-manual].dump`). Every deploy writes a `-manual` dump just
   before it starts.

3. **Put the chosen dump out of the pruning's reach.** Step 5 takes another manual dump, and
   only the newest 3 manual dumps are kept, so the one you picked could be deleted.
   `backups/fetched/` is never pruned.

   ```sh
   mkdir -p backups/fetched
   cp backups/<file>.dump backups/fetched/          # from the server's own copies, or:
   scripts/backup.sh fetch <file>.dump              # from Drive, decrypted into backups/fetched/
   ```

   `fetch` stops with "isn't a Postgres dump" when the passphrase or salt in `rclone.conf` is
   wrong. "Drive isn't set up" means **deploy** can't read its `rclone.conf`
   ([server setup guide, Part A step 9](server-setup-guide.md#part-a-the-server-one-time)).

4. **Check the dump (Safe).** It goes into a scratch database, not the live one:

   ```sh
   f=backups/fetched/<file>.dump
   ls -l "$f"; head -c 5 "$f"; echo                 # not 0 bytes; PGDMP
   docker compose exec -T db sh -c 'createdb -U "$POSTGRES_USER" restore_check'
   docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d restore_check --no-owner --exit-on-error' < "$f"; echo $?   # 0
   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d restore_check -Atc "SELECT version_num FROM alembic_version; SELECT count(*) FROM users; SELECT count(*) FROM transactions; SELECT max(date) FROM transactions"'
   docker compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" restore_check'
   ```

   Write down the revision and the counts. If `pg_restore` doesn't exit with `0`, pick the
   next older dump. If the revision is newer than the one the server runs (`docker compose
   exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT version_num FROM
   alembic_version"'`), deploy newer code first: `migrate` can upgrade an older dump but not
   downgrade a newer one.

5. **Freeze and take the undo point.**

   ```sh
   crontab -l > ~/crontab.before-restore && crontab -r         # pause the hourly backup
   docker compose stop backend frontend                        # the app goes offline
   scripts/backup.sh manual                                    # the undo point, also copied to Drive
   ls -t backups/expense-*-manual.dump | head -n 1             # note this name
   ```

   The hourly job is paused so it can't dump a half-restored database and count it as a good
   daily backup. If `backup.sh manual` fails, stop here: start the app again with
   `docker compose start backend frontend` and `crontab ~/crontab.before-restore`, then find
   out why.

6. **Restore. Destructive.**

   ```sh
   f=backups/fetched/<file>.dump                               # the file you checked in step 4
   docker compose exec -T db sh -c 'psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public"'
   docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error' < "$f"; echo $?   # 0
   docker compose up -d --wait                                 # re-runs migrate and seed, then starts the app
   ```

   `NOTICE: drop cascades to ... other objects` after the first line is expected. If
   `pg_restore` fails, the app stays stopped and the database is partly restored: run the two
   lines again with the same file or an older one. They start from an empty schema each time.
   **Never** use `docker compose down -v` to "start clean": it deletes the database volume.

7. **Check it (Safe).**

   ```sh
   docker compose ps -a                                        # db, backend, frontend, caddy healthy or up; migrate, seed Exited (0)
   docker compose logs --tail=20 migrate seed backend          # no errors
   curl -s http://127.0.0.1:8080/nginx-health                  # ok
   curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/api/v1/auth/me   # 401
   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT version_num FROM alembic_version; SELECT count(*) FROM users; SELECT count(*) FROM transactions; SELECT max(date) FROM transactions"'
   ```

   The counts must match step 4. The revision may be newer than step 4's if `migrate`
   upgraded the dump; that is expected. In the **Browser**, open `https://<name>.duckdns.org`,
   log in, and check the Dashboard, the latest transactions and one bank balance you know.
   Everyone logs in with the password they had when the dump was taken.

8. **Turn the hourly backup back on and take a fresh dump.**

   ```sh
   crontab ~/crontab.before-restore && crontab -l              # the backup.sh line is back
   scripts/backup.sh manual && scripts/backup.sh status
   ```

**Undo the restore. Destructive:** repeat steps 5 to 8 with the undo-point dump you noted in
step 5 (copy it into `backups/fetched/` first, as in step 3).

When it's done, delete the copies you no longer need from `backups/fetched/`, and re-enter
anything made after the dump.

### The server is lost

The data is safe as long as Google Drive and the passphrase and salt in Bitwarden are. You
lose everything entered after the newest copy in Drive: up to about a day, because the daily
dump runs once every 23 hours (plus a manual dump on every deploy).

1. **New droplet.** Either:
   - **From a weekly droplet backup**, if those are turned on: on the droplet's Backups tab,
     create a new droplet from the newest backup image. Docker, `.env`, `rclone.conf`, the
     crontab and the deploy key come with it. Then restore the newest Drive dump onto it
     with [Restore on the running server](#restore-on-the-running-server), because the
     image can be a week old.
   - **From scratch:** [server setup guide](server-setup-guide.md), Part A steps 1 to 6.
     Use the same `IMAGE_TAG` the old server ran (the last successful deploy in GitHub
     Actions shows it). A fresh `POSTGRES_PASSWORD` is fine: the dump doesn't depend on it.
2. **rclone (from scratch only).** Part A step 9 without the cron line. Copy `rclone.conf`
   from the Mac if it still has one. If no machine has it, recreate it as in the
   [backup guide](backup-guide.md#set-up-the-drive-copy-once-per-mac), with the OAuth client
   ID and secret and the passphrase and salt from Bitwarden, then copy it to
   `/home/deploy/.config/rclone/rclone.conf` (mode 600, owned by deploy).
3. **Data.** As **deploy**: `scripts/backup.sh list-drive`, then
   `scripts/backup.sh fetch <newest>.dump`, then run the 7A restore block of
   [Part A step 7](server-setup-guide.md#part-a-the-server-one-time) with
   `backups/fetched/<newest>.dump` as the file.
4. **Backups.** The crontab line from Part A step 9.
5. **Name and GitHub.** Point the DuckDNS name at the new IP (Part D); Caddy gets a
   certificate by itself. In GitHub, update the secrets `DEPLOY_HOST` and
   `DEPLOY_KNOWN_HOSTS` (Part B step 3). From scratch, the old deploy key's private half is
   only in GitHub, so do all of Part B again with a new key.
6. **Deploy once from GitHub** with the current tag, to prove the path works.
7. **Sign everyone out**, since the restored database still accepts old sessions. This
   deletes logins only, not data:

   ```sh
   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DELETE FROM sessions"'
   ```

8. **Destroy the old droplet** in DigitalOcean once the new one works, if it still exists,
   so it can't come back up with stale data and the same name.

## Recovery scenarios

| Scenario | Use | Data lost |
| --- | --- | --- |
| A. Some entries were deleted or changed by mistake | [A](#a-entries-deleted-or-changed-by-mistake): look them up in a scratch copy and re-enter, or restore everything | Nothing if re-entered; everything after the dump if fully restored |
| B. The database volume is gone (`down -v`, Docker Desktop reset) | [B](#b-the-database-volume-is-gone) | Everything after the newest dump |
| C. A deploy failed (bad code or migration) | [C](#c-a-deploy-failed) | Usually nothing; entries made after the pre-deploy dump if the database is rolled back |
| D. The Mac is lost, stolen or its disk died | [D](#d-the-machine-is-lost) | Everything after the newest **off-Mac** copy. Today there may be none |
| E. Postgres won't start, or the data is corrupt | [E](#e-the-database-is-corrupt-or-wont-start) | Everything after the newest dump |

### Whole environment or one component

| Restore | When | How |
| --- | --- | --- |
| Whole environment | New machine, or everything is gone | [Deployment guide](deployment-guide.md) to install, then `make restore` |
| Database only | Data loss or corruption, the app is fine | `make restore` |
| Some rows only | A few entries lost | Scratch database, then re-enter by hand (scenario A). There is no supported partial restore |
| Configuration only | `.env` lost | Recreate it from your saved copy, or `make env` plus the values in the [deployment guide](deployment-guide.md#7-environment-variables-and-secrets). Keep the old password if the volume still exists |
| Code only | Bad deploy without a migration | `git checkout <good-commit>`, then `make up` |

## Prerequisites

- Docker running, and the repository cloned on the machine you restore to.
- A dump file (`*.dump`, `pg_dump` custom format) from the [backup guide](backup-guide.md).
- For a copy from Google Drive: rclone, and the passphrase and salt from Bitwarden.

## 1. Choose a backup

```sh
ls -lt backups/ | head                          # Safe: newest first, on this Mac
make backup-list-drive                          # Safe: the copies in Google Drive
```

- Pick the newest dump taken **before** the problem started. For a bad deploy, that's the
  dump you took before `git pull`.
- Names are in UTC (`expense-YYYYMMDD-HHMMSSZ[-manual].dump`). Dumps from before October 2026
  have no `Z`, and their manual names are in local time, so go by `ls -lt` (file time), not
  by the name (see the
  [backup guide](backup-guide.md#where-backups-are-stored-and-how-they-are-named)).
- Files dated before that change may include 0-byte failed manual dumps or a tiny dump of
  an empty new install. Skip them. The backup script no longer writes either.

## 2. Check it before you use it

Run [Verify a backup](backup-guide.md#verify-a-backup), steps 1 and 2. If either fails, pick
the next older dump. Note the counts and the Alembic revision the scratch restore printed,
so you can compare them after the real restore.

Compatibility:

- **Postgres version.** Dumps come from Postgres 16 and restore into the `postgres:16-alpine`
  container. Restoring into an older major version is not supported.
- **Schema version.** A dump from an **older** migration is upgraded on its own: when
  `make restore` starts the backend again, Compose re-runs `migrate`. That was tested with a
  dump at 0008 against code at 0009. A dump from a **newer** migration than the checked-out
  code fails with `Can't locate revision`. Check out code at least as new as the dump, then
  restore.

## 3. Prepare the machine

- **Same machine, app running:** nothing to prepare. `make restore` needs the `db` container
  up.
- **Same machine, volume gone:** run `make up` first. It creates an empty database with the
  current schema, which the restore then replaces.
- **New or recovery machine:** follow the [deployment guide](deployment-guide.md) through
  section 11 (`make up`). Skip `make create-admin`, because the users come from the dump.
  Then fetch the dump from Google Drive (**Your values**):

```sh
brew install rclone
make backup-drive-setup              # sign in to Google; answer y and paste the passphrase and salt from Bitwarden
make backup-list-drive               # pick a file
make backup-fetch FILE=<file>.dump   # decrypts into backups/fetched/<file>.dump
```

  `backup-fetch` checks that the result is a Postgres dump. "isn't a Postgres dump" means the
  passphrase or salt is wrong: run `rclone config delete expense-drive-crypt` and
  `make backup-drive-setup` again. Restore from `backups/fetched/<file>.dump` in step 4.

To test a restore without touching the live app, use a separate Compose project on other
ports, as in
[the backup guide](backup-guide.md#test-a-restore-in-a-separate-environment).

## 4. Restore the database

**Destructive.** This replaces all data in the current Compose project's database.

```sh
make backup                                       # the undo point; check the file isn't 0 bytes
make restore FILE=backups/<file>.dump             # type yes
```

What `make restore` does (`Makefile`):

1. Checks the file exists, and asks you to type `yes`.
2. `docker compose stop backend frontend`. The app goes offline. A scheduled backup that
   runs now only reads.
3. `DROP SCHEMA public CASCADE; CREATE SCHEMA public`, which empties the database. Postgres
   prints `NOTICE: drop cascades to 17 other objects` and lists them. That is expected.
4. `pg_restore --no-owner` from the file. `--no-owner` makes the target's own user own
   everything, so the dump works on a machine with a different user or password.
5. `docker compose start backend frontend`. Compose also re-runs `migrate` and `seed`, so
   the schema is brought up to date and `config/seed.yaml` additions are applied (add-only;
   `seed_log` comes back with the dump, so deleted items stay deleted).

Expect the last lines to be `Container expense-tracker-backend-1 Healthy` and
`Container expense-tracker-frontend-1 Started`.

Roles, permissions and extensions need no separate step. There is one role, created by the
Postgres image from `.env`, and no extensions.

If it fails:

| Where | What you see | What to do |
| --- | --- | --- |
| Before step 2 | `Usage: make restore FILE=...` | Wrong path. Nothing changed |
| Step 4 | `pg_restore: error: ...` and make stops | The app stays stopped and the database is partly restored. Run `make restore` again with the same file or another one; it starts from an empty schema each time |
| Step 5 | `service "migrate" didn't complete successfully` | The dump is newer than the code. Check out newer code and run `make up` |

## 5. Restore files and object storage

Not applicable. The app keeps no files outside Postgres.

## 6. Restore configuration and secrets

- `.env` is the only machine-local config. On the same machine, keep the existing one. On a
  new machine, `make env` makes a fresh one with a new random password. That's fine: the
  dump doesn't depend on the old password. Then set `PUBLIC_BASE_URL`, `COOKIE_SECURE`,
  ports and the `BACKUP_*` settings from your saved copy.
- **Don't change `POSTGRES_PASSWORD` on an existing volume.** Postgres keeps the password it
  was created with, and the backend would fail `/readyz`.
- Keep `.env` out of git and out of chat (`chmod 600 .env`).

## 7. Restore infrastructure and service configuration

Nothing beyond the repository: `docker-compose.yml`, `nginx.conf` and the Dockerfiles come
from git. On a new machine, also:

- Set Docker Desktop to start at login.
- Sign in to Tailscale if other devices use the app, and check the frontend port binding
  (see the [deployment guide](deployment-guide.md#6-network-firewall-dns-tls-and-access)).

## 8. Restart the application

`make restore` restarts it. If you stopped other services along the way, run `make up`. It
is safe and repeatable, and it keeps the data.

## 9. Validate

**Health (Safe):**

```sh
make ps                                                     # db, backend, frontend healthy; migrate, seed Exited (0); backup Up
curl -s http://localhost:8000/readyz                        # {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/api/v1/auth/me   # 401
docker compose logs --tail=20 backend migrate seed          # no errors
```

**Data (Safe):** compare with the scratch-restore numbers from step 2:

```sh
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT version_num FROM alembic_version; SELECT count(*) FROM users; SELECT count(*) FROM households; SELECT count(*) FROM accounts; SELECT count(*) FROM transactions; SELECT max(date) FROM transactions"'
```

The revision should be the newest migration in the code, and the counts the same as the
dump's. `max(date)` tells you the last day with entries. Everything after it needs
re-entering.

**Features (in the browser):**

1. Log in as the admin, and as one other member if there is one.
2. Dashboard: the month's totals and account balances look right. Check a bank balance you
   know.
3. Transactions: the latest entries are there. Add one and delete it.
4. Budgets and Settings (rules, categories) are as expected.
5. Admin: users and households are listed.

**Background and scheduled jobs:** the only ones are `migrate` and `seed` (they exited 0
above) and the launchd backup job. Run `make backup`, then `make backup-status`: the new
dump has a plausible size and "last upload" is now.

**Networking:** from another device, open `PUBLIC_BASE_URL`, if other devices use the app.

## 10. Switch traffic

Usually not needed: on the same machine, the URL doesn't change. After restoring onto a
different machine, people need to open the new address. Follow the cutover steps in the
[migration guide](environment-migration-guide.md#phase-6-cutover). Unused invite and
password-reset links from the dump point at the old `PUBLIC_BASE_URL`. Create new ones.

## 11. Roll back a failed recovery

If the restored data is wrong, or the app misbehaves after a restore:

```sh
make restore FILE=backups/<the dump you took in step 4>    # Destructive: puts back what was there before
```

Then check again (step 9). If that dump was 0 bytes or missing, stop. Don't restore
anything else until you have worked out which dump is the newest good one.

## Scenario details

### A. Entries deleted or changed by mistake

Restoring everything throws away all later work. Usually it is better to look up the old
rows in a scratch copy and re-enter them:

```sh
docker compose exec -T db sh -c 'createdb -U "$POSTGRES_USER" restore_check'                    # Safe
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d restore_check --no-owner' < backups/<file>.dump
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d restore_check -c "SELECT date, amount, type, description FROM transactions WHERE date >= '"'"'<YYYY-MM-DD>'"'"' ORDER BY date"'
docker compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" restore_check'
```

Re-enter what's missing in the app. If too much is wrong, do a full restore (steps 1 to 9).

### B. The database volume is gone

```sh
docker volume ls | grep pgdata          # Safe: no expense-tracker_pgdata
make up                                 # creates an empty database with the current schema
make restore FILE=backups/<newest good dump>
```

Then validate (step 9).

### C. A deploy failed

**No migration in the failed change:** `git checkout <good-commit>`, then `make up`. Data is
untouched.

**A migration ran.** The database is ahead of the old code, so `make up` on the old code
fails with `Can't locate revision`. Use the dump you took before `git pull`. **Destructive:**
entries made since that dump are lost, so note them first. This sequence was tested with a
throwaway migration:

```sh
make backup                                       # the current state, in case you need it
make down                                         # stop everything; the volume is kept
git checkout <good-commit>
docker compose build                              # old-code images; nothing starts yet
docker compose up -d db                           # only the database
docker compose exec -T db sh -c 'psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public"'
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error' < backups/<pre-deploy dump>
make up                                           # migrate finds the old revision; backend starts
```

Why not plain `make restore` here: it restarts the existing containers, which still hold the
new code, and their `migrate` would upgrade the database again.

Alternative without losing data: `alembic downgrade`. Some migrations refuse to downgrade
when that would lose data (0006 does), so this only suits simple cases, and it has to run
with the **new** code checked out:

```sh
docker compose run --rm migrate alembic downgrade <previous-revision>   # Destructive for the dropped columns
git checkout <good-commit> && make up
```

### D. The machine is lost

1. Get the passphrase and salt from Bitwarden. Without them the Drive copies can't be
   decrypted, and the data can't be recovered.
2. On the new machine, follow the [deployment guide](deployment-guide.md) to `make up`.
3. Fetch the newest dump from Drive (step 3), check and restore it (steps 2 to 4), then
   validate (step 9).
4. Set `PUBLIC_BASE_URL` and Tailscale again, run `make backup-schedule`, then follow the cutover in
   the [migration guide](environment-migration-guide.md#phase-6-cutover).
5. Remove the lost Mac from the tailnet in the Tailscale admin console. The restored
   database still accepts the old sessions, so sign everyone out. This deletes logins only,
   not data:

   ```sh
   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DELETE FROM sessions"'
   ```

   A thief with the disk also has the dumps, and with them the password hashes. Ask everyone
   to change their password.

### E. The database is corrupt or won't start

1. Look first: `docker compose logs --tail=100 db`. A full disk (`docker system df`,
   `df -h`) or Docker Desktop's VM disk limit is more common than real corruption. Free
   space and run `make up`.
2. If the data really is corrupt, keep a copy of the broken volume before you change
   anything (example, check the path first):

   ```sh
   make down
   docker run --rm -v expense-tracker_pgdata:/from:ro -v "$PWD/pgdata-broken":/to alpine cp -a /from/. /to/
   ```

3. **Destructive, needs a deliberate decision:** remove the volume, then do scenario B.

   ```sh
   docker volume rm expense-tracker_pgdata
   make up
   make restore FILE=backups/<newest good dump>
   ```

## Recovery objectives

No recovery point objective (RPO) or recovery time objective (RTO) has been agreed for this
app. The values below describe what the current setup can do. They are not targets.

| | Current reality | To agree |
| --- | --- | --- |
| RPO, same machine | About 24 hours: the launchd job takes a daily dump. Longer if the Mac is off or Docker Desktop is closed | Proposed: 24 hours |
| RPO, machine lost | The same: each dump is copied to Google Drive in the same run | Proposed: 24 hours |
| How far back | The newest 7 daily dumps, about a week | Raise `BACKUP_KEEP_DAILY` for longer |
| RTO, database only | A ~55 KB dump restored in seconds in a test. Allow 15 minutes including checks | Proposed: 1 hour |
| RTO, new machine | Docker install plus first image build plus restore. Not measured end to end | Proposed: 1 day |

## After recovery

- [ ] Step 9 checks all pass.
- [ ] Re-enter anything made after the dump, if needed.
- [ ] Take a fresh `make backup`, and copy it off the Mac.
- [ ] Watch `make logs` for errors for a day. Check that `make ps` stays healthy.
- [ ] Delete scratch databases and test stacks you created.
- [ ] Write down what happened, which dump was used, and how much was lost.
- [ ] Sign-off: the owner (Suraj) confirms the data is right and the app is back in use.
