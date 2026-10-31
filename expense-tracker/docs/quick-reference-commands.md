# Quick reference commands

The commands from the detailed guides, without the explanations. Run them from
`expense-tracker/` on the machine named. If something doesn't behave as described here, go
to the full guide linked in each section.

| Mark | Meaning |
| --- | --- |
| **Safe** | Read-only or repeatable |
| **Your values** | Replace `<placeholders>` first |
| **Destructive** | Deletes or replaces data. Check `hostname` and take a `make backup` first |

**Never run `docker compose down -v`** on the live app. It deletes the database volume.

## 1. Prerequisites

Tools: Docker with Compose v2, `git`, `make`, `openssl`, `curl`. Access: a user who can run
`docker`, and read access to the GitHub repo. Config: `expense-tracker/.env`, created by
`make env`.

```sh
docker version --format '{{.Server.Version}}'    # Safe: Docker is running
docker compose version                           # Safe: v2 or later
git --version; make --version | head -1; openssl version   # Safe
test -f .env && grep -v '^POSTGRES_PASSWORD=' .env          # Safe: settings without the password
```

## 2. Deploy a new environment

Full guide: [deployment-guide.md](deployment-guide.md).

Infrastructure provisioning: not applicable (no IaC or cloud). Preparation: install Docker
and set it to start at login.

```sh
git clone https://github.com/suraj9741/personal-finance-workbook.git   # Safe
cd personal-finance-workbook/expense-tracker
make env                                          # Safe: creates .env with a random DB password (first run only)
$EDITOR .env                                      # Your values: PUBLIC_BASE_URL, COOKIE_SECURE, ports
chmod 600 .env
make up                                           # builds images, migrates, seeds, starts. Ends with "App: http://localhost:8080 ..."
make create-admin EMAIL=<you@example.com> NAME=<Name>   # Your values: first admin, asks for a password
```

Migrations and seed (both also run inside `make up`):

```sh
make migrate                                      # Safe: alembic upgrade head; prints nothing on success
make apply-config                                 # Safe: add-only from config/seed.yaml; prints "Seed: {...}"
```

Start, stop, restart:

```sh
make up                                           # Safe: start or update; keeps data
make down                                         # Safe: stop; keeps data
docker compose restart backend                    # Safe: one service
```

Update a running deploy:

```sh
make backup && git pull && make up
```

Health:

```sh
make ps                                                                       # db/backend/frontend healthy, migrate/seed Exited (0), backup Up
curl -s http://localhost:8000/readyz                                          # {"status":"ok"}
curl -s http://localhost:8080/nginx-health                                    # ok
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/api/v1/auth/me # 401
```

## 3. Take a backup

Full guide: [backup-guide.md](backup-guide.md).

```sh
make backup                                       # Safe: dump now (...-manual.dump), copy to Drive
make backup-status                                # Safe: newest dumps, last upload, schedule on or off
ls -lt backups/ | head                            # Safe: list, newest first
make backup-list-drive                            # Safe: the copies in Google Drive
tail -n 20 backups/backup.log                     # Safe: what the last runs did
```

Daily schedule and Drive, once per Mac (see the [backup guide](backup-guide.md#set-up-the-drive-copy-once-per-mac)):

```sh
brew install rclone
make backup-drive-setup                           # browser sign-in; save the passphrase and salt in Bitwarden
make backup-schedule                              # hourly check, daily dump; make backup-unschedule turns it off
```

Check a dump:

```sh
f=backups/<file>.dump                                                  # Your values
ls -l "$f"; head -c 5 "$f"; echo                                       # not 0 bytes; PGDMP
docker compose exec -T db pg_restore --list < "$f" | grep -c 'TABLE DATA'   # 17 at migration 0009
shasum -a 256 "$f"
```

Restore into a scratch database. Safe: it creates and drops `restore_check` only.

```sh
docker compose exec -T db sh -c 'createdb -U "$POSTGRES_USER" restore_check'
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d restore_check --no-owner --exit-on-error' < "$f"; echo $?   # 0
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d restore_check -Atc "SELECT count(*) FROM transactions"'
docker compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" restore_check'
```

Config backup: save `.env`'s values and the Drive passphrase and salt in Bitwarden. Code and `config/seed.yaml` are in git. There is no infrastructure state to back
up.

Freshness: `make backup-status` says "DUE" when no daily dump was taken in the last 23 hours.

## 4. Restore a backup

Full guide: [restore-guide.md](restore-guide.md).

Prepare the target:

```sh
hostname; echo "${COMPOSE_PROJECT_NAME:-expense-tracker}"   # Safe: the right machine and stack?
make up                                                      # if the volume is gone or the machine is new (no create-admin)
make backup-drive-setup                                      # new machine: answer y, paste the passphrase and salt from Bitwarden
make backup-fetch FILE=<file>.dump                            # Your values: from Drive into backups/fetched/<file>.dump
```

Restore. **Destructive:** this replaces ALL data in this stack's database.

```sh
make backup                                       # undo point
make restore FILE=backups/<file>.dump             # type yes; stops the app, empties the schema, pg_restore, restarts (re-runs migrate and seed)
```

Configuration: keep the existing `.env` on the same machine. On a new machine, `make env`
and set the values. Never change `POSTGRES_PASSWORD` on an existing volume.

Restart, then check:

```sh
make up                                           # Safe: only if something is still stopped
make ps
curl -s http://localhost:8000/readyz              # {"status":"ok"}
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT version_num FROM alembic_version; SELECT count(*) FROM users; SELECT count(*) FROM transactions; SELECT max(date) FROM transactions"'
```

Undo a restore. **Destructive:**

```sh
make restore FILE=backups/<the dump taken just before>
```

Roll back a deploy whose migration already ran. **Destructive**; loses entries made after
the dump. See [restore guide, scenario C](restore-guide.md#c-a-deploy-failed).

```sh
make backup && make down
git checkout <good-commit> && docker compose build
docker compose up -d db
docker compose exec -T db sh -c 'psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public"'
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error' < backups/<pre-deploy dump>
make up
```

## 5. Migrate to a new server

Full guide: [environment-migration-guide.md](environment-migration-guide.md).

Inspect the old machine (Safe):

```sh
git -C .. log --oneline -1; git -C .. status --short
docker compose ps --format '{{.Service}} {{.Status}}'
grep -v '^POSTGRES_PASSWORD=' .env
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT version_num FROM alembic_version; SELECT count(*) FROM users; SELECT count(*) FROM transactions"'
```

Prepare the new machine (Your values):

```sh
git clone https://github.com/suraj9741/personal-finance-workbook.git && cd personal-finance-workbook/expense-tracker
git checkout <old machine's commit>
make env && $EDITOR .env && chmod 600 .env        # new PUBLIC_BASE_URL; keep the new password
make up && make ps
```

Cutover. Needs the owner's go-ahead and a quiet time.

```sh
# old machine
docker compose stop frontend backend              # freeze writes
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM users; SELECT count(*) FROM transactions"'   # baseline
make backup; f=$(ls -t backups/*-manual.dump | head -1); ls -l "$f"; shasum -a 256 "$f"
make down                                         # old machine fully stopped; volume kept for rollback
scp "$f" <user>@<new-host>:<repo-dir>/expense-tracker/backups/   # example; or an encrypted disk copy

# new machine
shasum -a 256 backups/<file>.dump                 # must match
make restore FILE=backups/<file>.dump             # Destructive for the new (empty) database; type yes
make ps; curl -s http://localhost:8000/readyz     # then compare the counts with the baseline
```

Switch users: give the new machine the old Tailscale name, or hand out the new URL. Reissue
invite links.

Roll back:

```sh
# nobody has written to the new machine yet
make down                                         # new machine
make up                                           # old machine

# people wrote to the new machine: carry the data back (Destructive on the old machine)
docker compose stop frontend backend && make backup && make down   # new machine; copy the dump to the old machine
make up && make restore FILE=backups/<dump from new>               # old machine
```

## 6. Verification and troubleshooting

```sh
make ps                                           # Safe: status and health
make logs                                         # Safe: all logs, follow
docker compose logs --tail=50 <service>           # Safe: db, migrate, seed, backend, frontend, backup
docker stats --no-stream                          # Safe: CPU and memory per container
docker system df; df -h                           # Safe: disk
docker compose exec -T db pg_isready              # Safe: "accepting connections"
curl -s http://localhost:8000/healthz             # Safe: backend process up
curl -s http://localhost:8000/readyz              # Safe: backend can reach the database
```

| Symptom | Diagnose | Usual fix |
| --- | --- | --- |
| `Cannot connect to the Docker daemon` | `docker version` | Start Docker Desktop |
| `service "migrate" didn't complete successfully` | `docker compose logs migrate` | `Can't locate revision`: the database is newer than the code. Check out newer code, or follow scenario C |
| `port is already allocated` | `lsof -iTCP:8080 -sTCP:LISTEN` | Free the port, or change `FRONTEND_PORT` / `BACKEND_PORT` |
| `/readyz` returns 503 | `docker compose logs db` | Start `db`; put back the original `POSTGRES_PASSWORD` if it was changed |
| `502 Bad Gateway` in the app | `make ps` | Backend down: `docker compose logs backend`, then `make up` |
| No new daily backup | `make backup-status`, `tail backups/backup.log` | Schedule OFF: `make backup-schedule`. Docker not running: start it; the next hourly check catches up |
| Upload to Drive fails | `tail backups/backup.log` | Sign-in expired: `rclone config reconnect expense-gdrive:`. The next run retries |
| Build fails at `pip`, `uv` or `npm` | the build output | Network or registry problem; retry. The running app is unaffected |

Final check after any deploy, restore or migration:

- [ ] `make ps`: `db`, `backend` and `frontend` healthy; `migrate` and `seed` `Exited (0)`; `make backup-status` shows the schedule on.
- [ ] `/readyz` is `{"status":"ok"}`, and `/api/v1/auth/me` through `:8080` returns 401.
- [ ] Alembic revision = the newest file in `backend/alembic/versions/`.
- [ ] Row counts as expected; you can log in; this month's Dashboard looks right.
- [ ] `make backup` writes a dump and `make backup-status` shows a fresh Drive upload.
