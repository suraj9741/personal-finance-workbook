# New environment deployment guide

How to go from an empty machine to a running expense tracker, and how to deploy updates
afterwards. Read the [architecture overview](architecture-overview.md) first if you have not
seen the app before. For the commands alone, use the
[quick reference](quick-reference-commands.md#2-deploy-a-new-environment).

To move an existing install with its data to a new machine, follow the
[environment migration guide](environment-migration-guide.md) instead. It uses this guide
for the install itself.

## How to read the commands

Every command runs from the `expense-tracker/` folder of the clone unless it says otherwise.

| Mark | Meaning |
| --- | --- |
| **Safe** | Read-only or repeatable. Run it whenever you like |
| **Your values** | Replace the `<placeholders>` first |
| **Destructive** | Deletes or replaces data. Check which machine you are on, and take a backup first |

Placeholders look like `<this>`. Never paste a real password, token or private hostname into
these docs.

## 1. Purpose, scope and prerequisites

This guide covers the Docker Compose deployment in this repository: one machine running five
containers (`db`, `migrate`, `seed`, `backend`, `frontend`), plus a launchd backup job on the
Mac. It runs in daily use on
macOS with Docker Desktop. While these docs were being written, `make up`, `make backup` and
`make restore` were also tried on Linux with Docker Engine, in a throwaway environment. A
long-running Linux server has not been tried, so its boot, firewall and update behaviour
still needs confirming.

You need:

- A machine with Docker and about 2 GB of free disk for images and data. Memory and disk use
  have not been measured, so this figure is a guess. Check `docker system df` after the
  first start.
- Read access to `github.com/suraj9741/personal-finance-workbook`.
- Network access to GitHub, Docker Hub, PyPI and npm while building.
- An email address and a password (10 or more characters) for the first admin.

## 2. Architecture and deployment dependencies

Start order, enforced by `depends_on` in `docker-compose.yml`:

```text
db (healthy) ──► migrate (exits 0) ──► seed (exits 0) ──► backend (healthy) ──► frontend
db (healthy) ──► backup
```

If `migrate` or `seed` fails, the backend and frontend do not start. See the
[system architecture diagram](diagrams/system-architecture.drawio.svg).

## 3. Permissions, tools, runtime versions and system requirements

| Tool | Why | Version |
| --- | --- | --- |
| Docker Desktop (macOS) or Docker Engine (Linux) | Runs everything | Not pinned in the repo. Needs Compose v2 (`docker compose`, not `docker-compose`). Dry-run on Docker 29.9 with Compose v5.6.1 |
| `git` | Clone and update | any recent |
| `make` | All commands go through the `Makefile` | GNU make (macOS ships it with the Xcode command line tools) |
| `openssl` | `make env` generates the database password | any |
| `curl` | Health checks below | any |

Pinned inside the images: Postgres 16 (`postgres:16-alpine`), Python 3.12
(`python:3.12-slim`) with `uv` 0.11.32, Node 22 (`node:22-alpine`), and nginx 1.27
(`nginxinc/nginx-unprivileged:1.27-alpine`). These are tags, not digests, so a later build
can pick up newer patch releases.

Permissions: a user who can run `docker`. On Linux that means the `docker` group or `sudo`;
Docker Desktop needs nothing extra. You don't need root for anything in the repository.

Check the tools (**Safe**):

```sh
docker version --format '{{.Server.Version}}'   # prints a version; an error means Docker isn't running
docker compose version                          # "Docker Compose version v2.x" or later
git --version && make --version | head -1 && openssl version
```

## 4. Infrastructure provisioning

Not used. There is no Terraform, cloud account or VM template. Provisioning means having a
machine with Docker on it.

## 5. Server preparation

**macOS:** install Docker Desktop and start it. Under Settings › General, tick "Start Docker
Desktop when you sign in" so the app comes back after a reboot. Containers have
`restart: unless-stopped`, but they only restart once Docker itself is running.

**Linux (needs confirmation):** install Docker Engine and the Compose plugin from Docker's
own packages. Then enable the service with `sudo systemctl enable --now docker`.

Then clone (**Safe**):

```sh
git clone https://github.com/suraj9741/personal-finance-workbook.git
cd personal-finance-workbook/expense-tracker
```

Expect a `personal-finance-workbook/` folder. Check with `git log --oneline -1`.

## 6. Network, firewall, DNS, TLS and access

| Item | What to do |
| --- | --- |
| Ports | `8080` (app) and `8000` (API) must be free on the host. Change them with `FRONTEND_PORT` and `BACKEND_PORT` in `.env` |
| Who can reach the app | `docker-compose.yml` binds the app to `0.0.0.0`: the host, the tailnet **and the local Wi-Fi**. To limit it to the host, change the frontend port line to `"127.0.0.1:${FRONTEND_PORT:-8080}:8080"` (a tracked file, so do it in a pull request) |
| Firewall | macOS: if the application firewall is on and other devices can't connect, allow Docker under System Settings › Network › Firewall › Options. Linux: published Docker ports skip `ufw` rules, so use the bind address above rather than `ufw` |
| DNS | Not used. Other devices use Tailscale MagicDNS (see the [README](../README.md#reach-it-from-other-devices-tailscale)) |
| TLS | Not used; the app is plain HTTP. For HTTPS on the tailnet, use `tailscale serve` as the README describes, then set `COOKIE_SECURE=true` |

## 7. Environment variables and secrets

`make up` runs `make env` first. On the first run it copies `.env.example` to `.env` and
puts a random 48-character hex `POSTGRES_PASSWORD` in it. It never overwrites an existing
`.env`.

```sh
make env        # Safe. Prints "Created .env with a random database password" the first time, nothing after
```

Then review `.env` (**Your values**):

| Variable | Default | Change it when |
| --- | --- | --- |
| `POSTGRES_USER`, `POSTGRES_DB` | `expense` | Rarely. Changing them after the first start has no effect on the existing database |
| `POSTGRES_PASSWORD` | random | Never by hand after the first start. Postgres keeps the password it was created with, and the app would stop connecting |
| `FRONTEND_PORT`, `BACKEND_PORT` | `8080`, `8000` | The port is taken |
| `PUBLIC_BASE_URL` | `http://localhost:8080` | Other devices use the app. Set it to the address they open (`http://<host>:8080`, or `https://<host>` with `tailscale serve`). Invite and reset links are built from it |
| `COOKIE_SECURE` | `false` | Set `true` once the app is served over HTTPS |
| `CORS_ORIGINS` | `http://localhost:5173` | Only for a page on another origin. The app itself doesn't need it |
| `BACKUP_KEEP_DAILY`, `BACKUP_KEEP_MANUAL` | `7`, `3` | You want more or fewer dumps kept, on the Mac and in Drive (see the [backup guide](backup-guide.md#retention-and-cleanup)) |
| `BACKUP_REMOTE` | `expense-drive-crypt:` | `none` keeps backups on the Mac only |
| `APP_ENV`, `LOG_LEVEL`, `LOG_FORMAT`, `SESSION_TTL_DAYS` | `production`, `INFO`, `json`, `30` | Rarely |

`.env` is gitignored. Keep it readable only by you (`chmod 600 .env`). There is no secrets
manager. The database password only matters inside this machine, and a restore onto a new
machine works with a new password.

## 8. Database provisioning and initialization

Nothing to do by hand. On the first `make up`, the `postgres:16-alpine` image creates the
user, password and database from `.env` inside the new `expense-tracker_pgdata` volume. That
happens only when the volume is empty.

## 9. Application installation and dependencies

Nothing to install on the host. The backend image installs Python packages from
`backend/uv.lock` (`uv sync --frozen`), and the frontend image runs `npm ci` from
`frontend/package-lock.json`.

## 10. Build, packaging and artifacts

**On the Mac**, `make up` builds both images locally as `expense-tracker-backend:local` and
`expense-tracker-frontend:local`. The version that runs is the commit checked out there:

```sh
git log --oneline -1                                       # Safe: what is deployed
docker image ls 'expense-tracker-*'                        # Safe: when the images were built
```

**For servers**, CI builds the images, but only when you start it. In GitHub, open Actions ›
Expense tracker images › Run workflow, on `main`
(`.github/workflows/expense-tracker-images-build.yml`). Merges and pushes never start it. It
refuses to run from another branch, because only main's code has passed the PR checks. It
builds both images for `linux/amd64` (the server is Ubuntu on x86-64) and pushes them to
two public Docker Hub repos:

| Image | Tags |
| --- | --- |
| `<dockerhub-user>/expense-tracker-backend` | `sha-<7-char commit>`, `latest` |
| `<dockerhub-user>/expense-tracker-frontend` | `sha-<7-char commit>`, `latest` |

The backend image includes `config/seed.yaml`, so a server needs no copy of the repo. Nothing
private is in the images: the code is already public, and `.env` and the data stay on the
server.

The job needs these, under the repo's Settings › Secrets and variables › Actions:

| Name | Kind | Value |
| --- | --- | --- |
| `DOCKERHUB_USERNAME` | Variable | Your Docker Hub username |
| `DOCKERHUB_TOKEN` | Secret | A Docker Hub personal access token with Read & Write |

Without them the job fails with a message that names them.

## 11. Deploy the application

**First deploy (Safe on an empty machine):**

```sh
make up
```

`make up` runs `docker compose up -d --build`. Expect `Container expense-tracker-... Started`
and `Healthy` lines. The command ends by printing
`App: http://localhost:8080   API docs: http://localhost:8000/docs`. The first build takes
several minutes and later ones are faster. If any step fails, `make up` exits non-zero; see
[troubleshooting](#19-common-failures-and-troubleshooting).

**Create the first admin (Your values):**

```sh
make create-admin EMAIL=<you@example.com> NAME=<Your name>
```

It asks for the password twice, creates the user with their own household, and applies
`config/seed.yaml`'s `admin_household` to it (accounts and categories). Expect
`Admin <email> created with household "<Name>'s household"`. It refuses if the email already
exists.

Do not run `make seed` on a real install. It adds demo households with fake data and a known
password.

**Update an existing deploy:**

```sh
make backup                         # Safe: a dump before anything changes
git pull                            # Safe: fetches the new code
make up                             # rebuilds, migrates, seeds, restarts
```

`make up` keeps the data volume. Only containers whose image or settings changed are
recreated.

### Deploy on a server from the CI images

For a small server that can't build the images, such as a 512 MB droplet. Building needs far
more memory than running. The server needs Docker Engine with the Compose plugin and nothing
else: no clone, no `make`.

1. Copy `docker-compose.deploy.yml` to a folder on the server, e.g. `~/expense-tracker/`.
2. Create `.env` next to it (**Your values**; `chmod 600 .env`):

   ```sh
   COMPOSE_FILE=docker-compose.deploy.yml
   IMAGE_NAMESPACE=<dockerhub-user>
   IMAGE_TAG=latest
   POSTGRES_USER=expense
   POSTGRES_PASSWORD=<openssl rand -hex 24>
   POSTGRES_DB=expense
   ```

   `COMPOSE_FILE` makes plain `docker compose` use the deploy file. The other variables in
   [section 7](#7-environment-variables-and-secrets) work the same here.
3. Start it (**Safe** on an empty server):

   ```sh
   docker compose pull && docker compose up -d
   docker compose run --rm -it backend python -m app.cli create-admin --email <you@example.com> --name "<Your name>"
   ```

4. The app listens on `127.0.0.1:8080` only, because a server is on the public internet and
   the app is plain HTTP. Until HTTPS is in front of it, use an SSH tunnel:
   `ssh -L 8080:127.0.0.1:8080 <user>@<server>`, then open `http://localhost:8080`.

To update, run `docker compose pull && docker compose up -d`. To pin or roll back to one build,
set `IMAGE_TAG=sha-<commit>` (the job summary in Actions shows it) and run
`docker compose up -d`. A migration that already ran still needs the
[rollback steps](#18-rollback-if-a-deploy-fails).

Memory: the app used about 170 MiB idle and 300 MiB at peak on the Mac. The deploy file
shrinks Postgres and caps each container. On 512 MB, add swap first (1–2 GB), or use a 1 GB
server. Backups (`scripts/backup.sh`) are scheduled by launchd on the Mac only, so a server
has none until a Linux schedule is added.

Never start `docker-compose.deploy.yml` on the Mac. It uses the same project name, so it would
replace the running containers there.

### Deploy with GitHub Actions

After the server is set up once (above, as the `deploy` user in `/home/deploy/expense-tracker`,
with its first start done by hand), redeploys go through **Actions › Expense tracker deploy ›
Run workflow** on `main`
(`.github/workflows/expense-tracker-deploy.yml`). It runs only when started by hand:

| Input | Meaning |
| --- | --- |
| `tag` | The image tag to deploy, e.g. `sha-9a7d13b`. Empty means the main commit the run started on |
| `build` | Tick it to build and push that commit's images first (runs the images workflow) |

The runner joins the tailnet for the length of the job, using Tailscale workload identity,
so there is no long-lived Tailscale key. It then connects to the server over SSH through the
tailnet, so port 22 can be closed to the internet. On the server it copies
`docker-compose.deploy.yml`, `scripts/backup.sh` and `scripts/deploy.sh` from the commit, then
runs `scripts/deploy.sh <tag>`, which:

1. takes a backup (`scripts/backup.sh manual`; a failed Drive upload only warns),
2. pulls the app images for the tag, and stops without changing anything if they don't exist,
3. writes `IMAGE_TAG` to `.env` and runs `docker compose up -d --wait`, then checks nginx and the API,
4. removes app images older than the previous tag.

On failure it prints the logs and the command to roll back. There is no automatic rollback,
because a migration may already have run ([section 18](#18-rollback-if-a-deploy-fails)). You
can also run `scripts/deploy.sh <tag>` by hand on the server.

**One-time setup (Your values):**

1. Tailscale admin console › Access controls. Make two tags, let CI reach only the server's SSH
   port, and keep your own devices' access:

   ```json
   "tagOwners": {"tag:ci": ["autogroup:admin"], "tag:prod": ["autogroup:admin"]},
   "grants": [
     {"src": ["autogroup:member"], "dst": ["*"], "ip": ["*"]},
     {"src": ["tag:ci"], "dst": ["tag:prod"], "ip": ["tcp:22"]}
   ]
   ```

2. Tailscale admin console › Settings › Trust credentials: add an OpenID Connect credential
   for GitHub (issuer `https://token.actions.githubusercontent.com`), subject
   `repo:suraj9741/personal-finance-workbook:ref:refs/heads/main`, scope Auth Keys (write) with
   tag `tag:ci`. See [workload identity federation](https://tailscale.com/kb/1581/workload-identity-federation).
3. On the server, as root: join the tailnet as `tag:prod` and create the `deploy` user:

   ```sh
   tailscale up --advertise-tags=tag:prod
   adduser --disabled-password --gecos "" deploy && usermod -aG docker deploy
   ```

4. On the Mac, make a key that only GitHub uses, and pin the server's host key:

   ```sh
   ssh-keygen -t ed25519 -N "" -C github-deploy -f ~/.ssh/expense_deploy
   ssh root@<server-tailscale-ip> "install -d -m 700 -o deploy -g deploy /home/deploy/.ssh && tee -a /home/deploy/.ssh/authorized_keys && chown deploy:deploy /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys" < ~/.ssh/expense_deploy.pub
   ssh-keyscan -t ed25519 <server-tailscale-ip>      # the DEPLOY_KNOWN_HOSTS value
   ```

5. GitHub › Settings › Secrets and variables › Actions, as secrets:

   | Secret | Value |
   | --- | --- |
   | `TS_OAUTH_CLIENT_ID`, `TS_AUDIENCE` | From the trust credential in step 2 |
   | `DEPLOY_HOST` | The server's Tailscale IP (`tailscale ip -4` on the server) |
   | `DEPLOY_USER` | `deploy` |
   | `DEPLOY_SSH_KEY` | The whole of `~/.ssh/expense_deploy` (the private key). Then delete it from the Mac |
   | `DEPLOY_KNOWN_HOSTS` | The line `ssh-keyscan` printed |

6. Once `ssh root@<server-tailscale-ip>` works over the tailnet, remove the SSH rule from the
   DigitalOcean firewall. If Tailscale ever breaks, DigitalOcean's Recovery Console still
   reaches the server.

## 12. Database migrations and initialization

Migrations run on their own as part of `make up`: the `migrate` container runs
`alembic upgrade head` before the backend starts. To run them by hand (**Safe**, they are
repeatable):

```sh
make migrate
```

Alembic logs only warnings (`backend/alembic.ini`), so a successful run prints nothing beyond
Compose's `Container ... Created` lines and exits 0. A failure prints `FAILED: ...` and exits
non-zero. Check the revision:

```sh
docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT version_num FROM alembic_version"'
```

It should print the newest file number in `backend/alembic/versions/`.

The `seed` container then adds anything missing from `config/seed.yaml`. It is add-only: it
never renames or deletes, and the `seed_log` table stops it re-adding things deleted in the
app. To apply an edit to the file without a restart, run `make apply-config`. Expect
`Seed: {'settings': 0, 'template_categories': 0, 'accounts': 0, 'categories': 0}` when
there is nothing new.

## 13. Storage, volumes and persistent data

| Path | Type | Holds |
| --- | --- | --- |
| `expense-tracker_pgdata` | Docker named volume, mounted at `/var/lib/postgresql/data` | The database |
| `./backups` | folder on the Mac, written by `scripts/backup.sh` | Dumps and `backup.log` |
| `./config` | read-only bind mount into `seed` and `backend` | `seed.yaml` |

`make down` stops the containers and keeps the volume. **Never run `docker compose down -v`**:
the `-v` deletes the volume and every entry in it.

```sh
docker volume inspect expense-tracker_pgdata --format '{{.Mountpoint}}'   # Safe: confirms it exists
```

## 14. Reverse proxy, load balancer and ingress

nginx inside the `frontend` container is the only proxy: it serves the app and forwards
`/api/` to the backend (`frontend/nginx.conf`). There is no load balancer or ingress. For
HTTPS, `tailscale serve` sits in front of it on the host (optional, not in the repository).

## 15. Startup and service configuration

All services use `restart: unless-stopped`, except the one-shot `migrate` and `seed`. After a
reboot, they come back once Docker starts. `make down` followed by `make up` is the clean
restart. To restart one service, run `docker compose restart <service>`.

## 16. Monitoring, logging, alerting and health checks

```sh
make ps                                   # Safe: every service with its health
make logs                                 # Safe: follow all logs (Ctrl-C to stop)
docker compose logs --tail=50 backend     # Safe: one service
curl -s http://localhost:8000/metrics | head   # Safe: Prometheus metrics (nothing scrapes them)
```

There is no alerting. See the [architecture overview](architecture-overview.md#monitoring-logging-and-alerting).

## 17. Smoke test and end-to-end check

Run these on the machine itself (**Safe**):

```sh
make ps
curl -s http://localhost:8000/healthz                                   # {"status":"ok"}
curl -s http://localhost:8000/readyz                                    # {"status":"ok"} (503 means no database)
curl -s http://localhost:8080/nginx-health                              # ok
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/         # 200
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:8080/api/v1/auth/me   # 401: nginx reaches the API, not logged in
```

Expected `make ps`: `db`, `backend` and `frontend` show `(healthy)`. `migrate` and `seed`
show `Exited (0)`. On a new Mac, set up backups once: `make backup-drive-setup` and
`make backup-schedule` (see the [backup guide](backup-guide.md#set-up-the-drive-copy-once-per-mac)).

Then in a browser:

1. Open `http://localhost:8080` and log in as the admin.
2. Check that Accounts and Settings show what `config/seed.yaml` defines.
3. Add a test transaction, check the Dashboard, then delete it.
4. From another device (if used), open `PUBLIC_BASE_URL` and log in.

## 18. Rollback if a deploy fails

1. Leave the data alone. A failed `make up` does not touch the volume.
2. Find the last good commit: `git log --oneline -5`.
3. If the failed deploy **did not add a migration** (no new file in
   `backend/alembic/versions/`), run `git checkout <good-commit>` and then `make up`.
4. If it **did add a migration that already ran**, the database is now ahead of the old code,
   and `make up` would fail with `Can't locate revision`. Follow
   [restore guide, scenario C](restore-guide.md#c-a-deploy-failed). It uses the backup you
   took before `git pull`.
5. Once fixed, go back to `main` with `git checkout main`, but only when the fix is merged.

## 19. Common failures and troubleshooting

| Symptom | Likely cause | Check | Fix |
| --- | --- | --- | --- |
| `Cannot connect to the Docker daemon` | Docker isn't running | `docker version` | Start Docker Desktop |
| `set POSTGRES_PASSWORD in .env` | `.env` missing or incomplete | `ls -l .env` | `make env`, then review it |
| `Bind for 0.0.0.0:8080 failed: port is already allocated` | Port taken | `lsof -iTCP:8080 -sTCP:LISTEN` | Stop the other program, or set `FRONTEND_PORT` |
| `service "migrate" didn't complete successfully` | A migration failed | `docker compose logs migrate` | Fix the migration. If it says `Can't locate revision`, the database is newer than the code: see section 18 |
| Build fails on `pip install`, `uv sync` or `npm ci` | No network, a proxy, or a registry outage | the build output | Retry later. The running app is unaffected until the build succeeds |
| `toomanyrequests` or `429` pulling images | Docker Hub rate limit | the build output | Wait, or `docker login` |
| Backend `unhealthy`, `/readyz` returns 503 | Database not reachable | `make ps`, `docker compose logs db` | Start `db`. If the password in `.env` was changed, put the original back |
| Pages load but every action fails, or `502 Bad Gateway` | Backend not running | `make ps` | `docker compose logs backend`, then `make up` |
| Invite links open on the wrong host | `PUBLIC_BASE_URL` not set | `grep PUBLIC_BASE_URL .env` | Set it, then `docker compose up -d` |
| Login fails with 429 | 5 failed logins in 15 minutes | wait | Wait 15 minutes |
| Other devices can't connect | Firewall, binding or Tailscale | `make ps` (port column) | See section 6 |

## 20. Post-deployment checklist

- [ ] `make ps`: `db`, `backend` and `frontend` healthy, `migrate` and `seed` `Exited (0)`.
- [ ] The smoke tests in section 17 pass.
- [ ] The admin can log in, and the accounts and categories are as expected.
- [ ] `.env` reviewed: `PUBLIC_BASE_URL`, `COOKIE_SECURE`, ports. `chmod 600 .env`.
- [ ] Docker set to start at login.
- [ ] `make backup` works and the file is in `backups/` ([backup guide](backup-guide.md)).
- [ ] Backups are scheduled and reach Drive: `make backup-status` ([backup guide](backup-guide.md#set-up-the-drive-copy-once-per-mac)).
- [ ] The deployed commit is noted: `git log --oneline -1`.
