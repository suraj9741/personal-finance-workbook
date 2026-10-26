# Complete environment migration to a new server

An end-to-end runbook for moving the expense tracker, with all its data, from the machine it
runs on now (the **old machine**, today a Mac) to a new one (the **new machine**: another Mac,
or a Linux server). It reuses the [deployment guide](deployment-guide.md) for the install,
and the [backup guide](backup-guide.md) and [restore guide](restore-guide.md) for the data.
The commands alone are in the [quick reference](quick-reference-commands.md#5-migrate-to-a-new-server).

Commands run from `expense-tracker/` on the machine named in the step. Marks: **Safe**
(read-only or repeatable), **Your values** (replace `<placeholders>`), **Destructive**
(deletes or replaces data).

![Old Mac: freeze writes, final dump, copy over an encrypted channel; new machine: make up, make restore, validate, then switch users over; rollback path back to the old machine](diagrams/environment-migration.drawio.svg)

Source: [diagrams/environment-migration.drawio.svg](diagrams/environment-migration.drawio.svg).

## How the move works, and what it can't do

- All state is one Postgres database plus `.env`. The move is: freeze writes on the old
  machine, take a final `pg_dump`, copy it, restore it on the new machine, check it, and
  then point people at the new address.
- **There is downtime.** There is one database with no replication, so for a consistent copy
  nothing may write while the final dump is taken and restored. With a rehearsal done
  beforehand, the window is the time to dump, copy, restore and check a database of tens of
  KB: minutes rather than hours. That estimate is a guess; time your rehearsal. Zero downtime
  isn't possible with this setup.
- The old machine is kept, stopped but intact, until the new one is accepted. That's the
  rollback.

Roles used below: **Owner** decides and approves (Suraj). **Operator** runs the commands.
They can be the same person.

## Phase 1: Discovery and assessment

On the **old machine**, record the current state (**Safe**, read-only). Keep the output with
the migration notes, but don't paste the password anywhere:

```sh
hostname
git -C .. log --oneline -1                     # deployed commit
git -C .. status --short                       # local changes that aren't in git (should be empty)
docker version --format '{{.Server.Version}}'; docker compose version
docker compose ps --format '{{.Service}} {{.Image}} {{.Status}}'
docker image ls 'expense-tracker-*'
docker volume ls | grep expense-tracker
docker system df
grep -v '^POSTGRES_PASSWORD=' .env             # non-secret settings: ports, PUBLIC_BASE_URL, COOKIE_SECURE, BACKUP_KEEP
ls -lt backups/ | head
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT version_num FROM alembic_version; SELECT count(*) FROM users; SELECT count(*) FROM households; SELECT count(*) FROM accounts; SELECT count(*) FROM transactions"'
docker compose exec -T db psql --version
launchctl list | grep -i expense; crontab -l 2>/dev/null | grep -i expense   # scheduled jobs outside Docker (none in the repo)
tailscale status 2>/dev/null | head -3         # if Tailscale is used
```

Inventory:

| Item | Old machine value | Notes |
| --- | --- | --- |
| Deployed commit | `<commit>` | Deploy the same commit on the new machine first |
| Docker and Compose versions | `<versions>` | |
| Postgres version | 16.x (`postgres:16-alpine`) | Must be 16 on both sides |
| Alembic revision and row counts | `<rev>`, `<counts>` | The validation baseline |
| Ports and bind addresses | `FRONTEND_PORT`, `BACKEND_PORT`, `0.0.0.0` or `127.0.0.1` for the app | |
| `PUBLIC_BASE_URL`, `COOKIE_SECURE` | `<values>` | Change them for the new address |
| How users reach it | `localhost` / Tailscale name / `tailscale serve` | Decides the cutover |
| Scheduled jobs | the `backup` loop in Compose; launchd or cron jobs, if any | Recreate them on the new machine, then disable them on the old |
| Off-machine backups | `<where, or none>` | |
| External integrations | none at runtime; Docker Hub, PyPI, npm and GitHub at build | |

**Stateful components:** the `expense-tracker_pgdata` volume and `.env`. Everything else is in
git or rebuilt.

**Risks:**

| Risk | Mitigation |
| --- | --- |
| Writes during the final dump are lost | Freeze writes first (phase 6) |
| Both machines take writes (split brain) | The old machine is `make down`'d before cutover and stays down |
| The new machine runs different code or migrations | Deploy the old machine's commit, not `main` |
| The dump is damaged in transfer | SHA-256 checksum on both ends |
| The new address breaks links and bookmarks | Keep the old Tailscale name, or tell everyone the new one; reissue invite links |
| The new machine's port binding exposes the app on its network | Decide the bind address before the first start (deployment guide §6) |

## Phase 2: Target environment preparation

On the **new machine**, follow the [deployment guide](deployment-guide.md) sections 3 to 7:
install Docker, set it to start on boot or login, clone, and run `make env`. Then:

```sh
git checkout <commit from phase 1>                          # Your values: same code as the old machine
```

Edit `.env` from the phase 1 inventory (**Your values**): ports, `BACKUP_KEEP`,
`PUBLIC_BASE_URL` (the **new** address), and `COOKIE_SECURE`. Keep the new random
`POSTGRES_PASSWORD`. The dump doesn't need the old one.

Start it (**Safe** on a new machine):

```sh
make up
make ps                       # db, backend, frontend healthy
```

Don't run `make create-admin`. The users arrive with the dump.

Networking and access: Tailscale signed in (if used), firewall, and the app port binding as
decided. Linux note (unconfirmed): published Docker ports skip `ufw`, so restrict them with the
bind address in `docker-compose.yml`.

## Phase 3: Migration planning

| Decision | Choose |
| --- | --- |
| Migrate | The database (dump and restore) and the `.env` values (copied by hand) |
| Recreate | Containers, images, the volume, Tailscale sign-in, any launchd jobs |
| Don't migrate | Old `backups/` (keep them on the old machine, or archive them off-machine), the Docker image cache |
| Sync strategy | One rehearsal dump (old machine live), then a final dump after the freeze. No live sync exists |
| Downtime window | `<date and time>`, when nobody is entering data. Tell the household beforehand |
| Rollback deadline | `<date>` (to agree; suggestion: 7 days after cutover) |
| Go/no-go owner | Owner |
| Acceptance criteria | Phase 5 checks pass, and the counts match the frozen old machine |

**Rehearsal** (recommended, **Safe** for the old machine): take a `make backup` on the old
machine while it's live, copy it over (phase 4), and `make restore` it on the new machine.
Run the phase 5 checks. This proves the path and times it. The new machine's data gets
replaced again at cutover.

## Phase 4: Data and configuration migration

### Back up the source

On the **old machine** (**Safe**):

```sh
make backup
f=$(ls -t backups/*-manual.dump | head -1); echo "$f"; ls -l "$f"    # not 0 bytes
shasum -a 256 "$f"
```

Check the dump (see [the backup guide](backup-guide.md#verify-a-backup)).

### Transfer it securely

Choose one, and keep the dump encrypted outside the two machines:

| Method | Command (examples, **Your values**; need confirming) |
| --- | --- |
| Over Tailscale with SSH (Remote Login enabled on the new machine) | `scp "$f" <user>@<new-host>:<repo-dir>/expense-tracker/backups/` |
| External disk or AirDrop | Copy the file. Encrypt it first if the disk isn't encrypted: `openssl enc -aes-256-cbc -pbkdf2 -salt -in "$f" -out "$f.enc"` |
| Cloud folder | Only the encrypted `.enc` file, never the plain dump |

On the **new machine**, check that it arrived intact (**Safe**):

```sh
shasum -a 256 backups/<file>.dump              # same hash as on the old machine
```

### Restore the database

On the **new machine**. **Destructive** for the new machine's database, which is empty or a
rehearsal copy:

```sh
make restore FILE=backups/<file>.dump          # type yes
```

That also brings the schema up to the new machine's code, and applies `config/seed.yaml`
(add-only). Roles, permissions and ownership need nothing more: `--no-owner` gives everything
to the new machine's database user.

### Configuration, jobs, monitoring and integrations

- `.env` values: set in phase 2. Check with `grep -v '^POSTGRES_PASSWORD=' .env`.
- Scheduled jobs: the `backup` loop comes with Compose. Recreate any launchd job from the
  [backup guide](backup-guide.md#recommended-improvements) on the new machine. Disable it on
  the old one at cutover.
- Monitoring: none to move.
- Integrations: none at runtime. Sign in to Tailscale if used.
- Ownership and permissions: `chmod 600 .env`. The `backups/` files belong to the user who
  runs Docker.

## Phase 5: Deployment and validation

On the **new machine** (**Safe**):

```sh
make ps                                                                       # healthy / Exited (0) / Up
curl -s http://localhost:8000/readyz                                          # {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/api/v1/auth/me # 401
docker compose logs --tail=30 backend migrate seed                            # no errors
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT version_num FROM alembic_version; SELECT count(*) FROM users; SELECT count(*) FROM households; SELECT count(*) FROM accounts; SELECT count(*) FROM transactions"'
make backup && ls -lt backups | head -3                                       # backups work here
```

- Counts must equal the old machine's counts **taken after the freeze**, and the revision must
  equal the code's newest migration.
- In the browser: log in as each user, check the Dashboard totals and a known bank balance
  for this month, open a few transactions, add and delete a test entry, and check Budgets,
  Settings and Admin.
- From another device: open the new `PUBLIC_BASE_URL` and log in.
- Authentication: logins work with the existing passwords. Old browser sessions only carry
  over if the address is the same.
- Storage and external integrations: none to test beyond the database.

## Phase 6: Cutover

**Needs the owner's go-ahead, and a time when nobody is entering data.**

1. **Tell users** the app is read-only for the next `<minutes>` minutes.
2. **Freeze writes** on the old machine, keeping the database up for the dump:

   ```sh
   docker compose stop frontend backend           # old machine: nobody can write now
   docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM users; SELECT count(*) FROM transactions; SELECT max(created_at) FROM transactions"'
   ```

   Record these counts. They are the baseline.
3. **Final dump** on the old machine: `make backup`, check it isn't 0 bytes, and take the
   SHA-256.
4. **Stop the old machine completely.** This keeps the volume:

   ```sh
   make down                                     # removes the containers, so they don't come back on a reboot
   ```

   Also unload any launchd backup job on the old machine.
   From here on, **don't run `make up` on the old machine** unless you are rolling back.
5. **Transfer and restore** the final dump on the new machine (phase 4).
6. **Go/no-go**, with every item a yes:

   | Check | Yes/No |
   | --- | --- |
   | `make ps` healthy on the new machine | |
   | Revision is the code's newest | |
   | Counts equal the step 2 baseline | |
   | Owner logged in and checked this month's Dashboard | |
   | Another device reaches the new address | |
   | `make backup` works on the new machine | |
   | The old machine is down (`docker compose ps` is empty there) | |

7. **Switch users over.** There is no DNS or load balancer, so "traffic" means the address
   people open:
   - Same Tailscale name: in the Tailscale admin console, rename the old machine, then give
     the new machine the old name. The URL stays the same. Renaming steps are in Tailscale's
     own docs.
   - New address: send everyone the new URL. `PUBLIC_BASE_URL` already points at it.
   - Invite and password-reset links created before the move point at the old address.
     Create new ones from the Admin page.
8. **Tell users** it's back.

Why this prevents split brain and duplicate jobs: writes stop before the final dump, and the
old machine's containers, including its `backup` loop, are removed before the new one goes
live. Only one database accepts writes at any time.

## Phase 7: Rollback

Decide before the rollback deadline from phase 3.

**Rollback triggers** (any one): a go/no-go item fails and can't be fixed in the window;
data on the new machine is wrong; the new machine is unstable.

**Before anyone wrote to the new machine:**

```sh
make down              # new machine
make up                # old machine: its volume is exactly as it was at the freeze
```

Switch the address back (undo step 7), and tell users.

**After people wrote to the new machine:** those writes exist only there. Carry them back,
or they're lost:

```sh
docker compose stop frontend backend          # new machine: freeze
make backup                                   # new machine: check it, take the SHA-256, copy it to the old machine
make down                                     # new machine
make up                                       # old machine
make restore FILE=backups/<dump from new>     # old machine. Destructive: replaces the old data with the newer data
```

Then validate on the old machine as in phase 5. Never run both machines with users on them.

**Keep the old machine safe until acceptance:** don't delete its volume, `.env` or
`backups/`. Don't run `make up` there, and don't upgrade Docker Desktop in a way that resets
its data.

## Phase 8: Decommissioning

Only after the owner accepts the new machine, and after the agreed retention period has
passed (to agree; suggestion: 14 days with no rollback).

1. Confirm that the new machine has been stable and that its backups run. At least one
   checked backup must be copied off the new machine.
2. Archive the old machine's final dump, encrypted, off both machines.
3. **Owner approval required.** On the **old machine**, check where you are, then remove the
   data. **Destructive, and can't be undone:**

   ```sh
   hostname                                     # must be the OLD machine
   docker compose ps                            # must be empty
   docker volume rm expense-tracker_pgdata      # deletes the old database
   rm -f .env && rm -rf backups/                # deletes the old secrets and dumps
   ```

4. Remove the old machine from the tailnet, if it was on it.
5. Record the outcome: the date, the commit, the counts before and after, how long the
   downtime lasted, problems, and where the archived dump is. Update the
   [architecture overview](architecture-overview.md) if anything changed (for example, a
   Linux host or a new address).

## Migration checklist

| # | Step | Owner | Status | How to check |
| --- | --- | --- | --- | --- |
| 1 | Inventory recorded (phase 1) | Operator | ☐ | Table filled in |
| 2 | Downtime window and rollback deadline agreed | Owner | ☐ | Written down |
| 3 | New machine installed at the old commit, `make up` healthy | Operator | ☐ | `make ps` |
| 4 | `.env` values set for the new address | Operator | ☐ | `grep -v '^POSTGRES_PASSWORD=' .env` |
| 5 | Rehearsal restore passed and was timed | Operator | ☐ | Phase 5 checks |
| 6 | Users told about the window | Owner | ☐ | |
| 7 | Writes frozen, baseline counts recorded | Operator | ☐ | Counts saved |
| 8 | Final dump taken, checksum recorded | Operator | ☐ | Size > 0, SHA-256 |
| 9 | Old machine `make down` | Operator | ☐ | `docker compose ps` empty |
| 10 | Dump transferred, checksum matches | Operator | ☐ | Same SHA-256 |
| 11 | Restored on new machine | Operator | ☐ | `make restore` finished |
| 12 | Go/no-go passed | Owner | ☐ | Table in phase 6 |
| 13 | Users switched to the new address | Operator | ☐ | Another device logs in |
| 14 | Backups (and off-machine copies) running on new machine | Operator | ☐ | New file in `backups/` |
| 15 | Acceptance after the agreed period | Owner | ☐ | |
| 16 | Old machine decommissioned | Owner approves, Operator runs | ☐ | Phase 8 |
