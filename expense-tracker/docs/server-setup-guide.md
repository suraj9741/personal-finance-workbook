# Server setup guide (DigitalOcean droplet)

The step-by-step runbook for running the expense tracker on a small Ubuntu server, with
one-click deploys from GitHub Actions. Follow it top to bottom for a new server, or use
[Move to another server](#move-to-another-server) to migrate.

- **Part A** sets up the server, one time.
- **Part B** connects GitHub, one time.
- **Part C** is every deploy after that, plus rollback.
- **Part D** adds HTTPS with a free DuckDNS name, one time.

The server never builds anything. GitHub Actions builds the images and pushes them to Docker
Hub; the server pulls them and runs `docker compose` with `docker-compose.deploy.yml` and a
`.env` file. The app runs at `http://<server-ip>` over plain HTTP until Part D adds HTTPS at
`https://<name>.duckdns.org`. Background
and design choices are in the [deployment guide](deployment-guide.md#11-deploy-the-application).

What you end up with after all four parts:

![The finished setup: browser to Caddy over HTTPS (DuckDNS name, Let's Encrypt certificate) on the DigitalOcean droplet, Caddy to nginx to FastAPI to Postgres in Docker Compose; GitHub Actions builds images to Docker Hub and deploys over SSH with a key locked to deploy-gate.sh; cron runs backup.sh hourly, which copies encrypted dumps to Google Drive](diagrams/production-architecture.drawio.svg)

| Part | Adds to the picture |
| --- | --- |
| A | The droplet, its firewall, swap, Docker, the `deploy` user and its folder, the Compose services, cron and the Drive copy |
| B | The deploy key locked to `deploy-gate.sh`, and the GitHub secrets |
| C | The deploy path itself: Actions › Expense tracker deploy |
| D | DuckDNS, Caddy and the Let's Encrypt certificate; the frontend moves to `127.0.0.1` |

Each part is explained in the [architecture overview](architecture-overview.md). To edit the
diagram, open [`diagrams/production-architecture.drawio.svg`](diagrams/production-architecture.drawio.svg)
in draw.io.

## Before you start

Who runs each command. **Check your prompt before every block**: `root@` or `deploy@` must match
the label. Most mistakes in this guide come from running a block as the wrong user.

| Mark | Where | How you get there |
| --- | --- | --- |
| **root** | The server, as root | `ssh root@<server-ip>` (add `-i <your-key>` if it isn't your default key) |
| **deploy** | The server, as the app user | as root: `su - deploy`; back to root: `exit` |
| **Mac** | Your own computer's terminal | |
| **Browser** | DigitalOcean or GitHub website | |

Have these ready:

| Value | Where to find it |
| --- | --- |
| `<server-ip>` | DigitalOcean › Droplets › your droplet |
| `<my-ip>` | **Mac:** `curl -s ifconfig.me` |
| `<dockerhub-user>` | The repo's `DOCKERHUB_USERNAME` variable |
| `<tag>` | The newest `sha-…` tag in the images workflow's summary |

Sizing: 1 vCPU and 512 MB RAM works only with swap (step 3). 1 GB is more comfortable.

## Part A: the server (one time)

1. **Firewall. Browser.** In DigitalOcean, go to Networking › Firewalls › Create firewall. Add
   these inbound rules, leave outbound as it is, and apply the firewall to the droplet:

   | Type | Port | Sources |
   | --- | --- | --- |
   | SSH | 22 | All IPv4, All IPv6 (GitHub connects from changing addresses) |
   | HTTP | 80 | `<my-ip>` only, for now |

   Your home IP changes from time to time. When the app stops loading, update the HTTP source.
   Once family members use the app, set it to All.

2. **Keys-only SSH and fail2ban. root.** Keep this session open until a new SSH login works.

   ```sh
   printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n' > /etc/ssh/sshd_config.d/10-keys-only.conf
   sshd -t && systemctl reload ssh
   apt-get update && apt-get install -y fail2ban
   ```

3. **Swap (2 GB). root.** Without swap, 512 MB runs out of memory.

   ```sh
   fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
   echo '/swapfile none swap sw 0 0' >> /etc/fstab
   echo 'vm.swappiness=10' > /etc/sysctl.d/99-swap.conf && sysctl --system >/dev/null
   free -h                                   # Swap: 2.0Gi
   ```

4. **Docker. root.**

   ```sh
   curl -fsSL https://get.docker.com | sh
   docker compose version
   ```

5. **App user and files.**

   **root:** make the user.

   ```sh
   adduser --disabled-password --gecos "" deploy && usermod -aG docker deploy
   su - deploy
   ```

   **deploy:** paste this only after the prompt shows `deploy@`. Pasting it in the same block
   as `su` can leave the downloads unrun.

   ```sh
   mkdir -p ~/expense-tracker/scripts && cd ~/expense-tracker
   RAW=https://raw.githubusercontent.com/suraj9741/personal-finance-workbook/main/expense-tracker
   curl -fsSLO $RAW/docker-compose.deploy.yml
   for f in backup.sh deploy.sh deploy-gate.sh; do curl -fsSL -o scripts/$f $RAW/scripts/$f; done
   chmod +x scripts/*.sh
   ls -l docker-compose.deploy.yml scripts/
   ```

   `ls` must list `docker-compose.deploy.yml` plus the three scripts, each executable (`-rwx`).
   If one is missing, run the block again.

6. **Settings file `.env`. deploy.** The unquoted `EOF` makes the shell fill in a random
   password from `$(openssl …)`.

   ```sh
   cd ~/expense-tracker
   cat > .env <<EOF
   COMPOSE_FILE=docker-compose.deploy.yml
   IMAGE_NAMESPACE=<dockerhub-user>
   IMAGE_TAG=<tag>
   FRONTEND_BIND=0.0.0.0
   FRONTEND_PORT=80
   PUBLIC_BASE_URL=http://<server-ip>
   COOKIE_SECURE=false
   POSTGRES_USER=expense
   POSTGRES_PASSWORD=$(openssl rand -hex 24)
   POSTGRES_DB=expense
   APP_ENV=production
   BACKUP_KEEP_DAILY=7
   BACKUP_KEEP_MANUAL=3
   BACKUP_REMOTE=expense-drive-crypt:
   EOF
   chmod 600 .env && docker compose config --quiet && echo ok
   grep POSTGRES_PASSWORD .env               # save it in your password manager; never change it
   ```

   `FRONTEND_BIND=0.0.0.0`, port 80 and `COOKIE_SECURE=false` are the plain-HTTP stopgap.
   [Part D](#part-d-https-with-a-duckdns-name-one-time) changes them for HTTPS.

7. **Data and first start. Choose 7A or 7B, not both.**

   **7A, bring existing data (from the Mac or an old server).** After this, don't add entries
   on the old machine. **Mac**, in the repo's `expense-tracker/` folder:

   ```sh
   make backup
   DUMP=$(ls -t backups/*-manual.dump | head -1) && echo $DUMP
   scp "$DUMP" root@<server-ip>:/home/deploy/expense-tracker/
   ssh root@<server-ip> 'chown deploy: /home/deploy/expense-tracker/*.dump'
   ```

   (From Google Drive instead: once step 9's rclone config is in place, as **deploy**,
   `scripts/backup.sh list-drive`, then `scripts/backup.sh fetch <name>`. The file lands in
   `backups/fetched/`.)

   Then as **deploy**, restore and start:

   ```sh
   cd ~/expense-tracker && ls -l *.dump                                  # the file you copied
   docker compose pull
   docker compose up -d db && sleep 10 && docker compose ps db           # wait for (healthy)
   docker compose stop backend frontend 2>/dev/null                      # in case the app was started before
   docker compose exec -T db sh -c 'psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public"'
   docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error' < expense-<date>-manual.dump
   docker compose up -d --wait
   docker compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select email from users" -c "select count(*) from transactions"'
   ```

   The last line must list your email and the same transaction count as the old machine. The
   `DROP SCHEMA` line empties **this server's** database, which is safe only because it holds
   no data of its own yet. Without it, if the app was ever started before the restore, the
   tables already exist, `pg_restore` stops at the first "already exists", and the database
   stays empty (login then says "Wrong email or password").

   You log in with the same email and password as before.

   **7B, start empty. deploy:**

   ```sh
   cd ~/expense-tracker && docker compose pull && docker compose up -d --wait
   docker compose run --rm backend python -m app.cli create-admin --email <you@example.com> --name "<Your name>"
   ```

8. **Check it.** As **deploy**, `docker compose ps -a` shows db, backend and frontend healthy,
   with migrate and seed `Exited (0)`. In the **Browser**, open `http://<server-ip>` and log in.

9. **Backups to Google Drive.** The rclone config (with the Drive token and the encryption
   passphrase) comes from the machine that already has it, so the server writes to the same
   encrypted Drive folder. See the [backup guide](backup-guide.md) for how that was set up.

   **root:**

   ```sh
   apt-get install -y unzip && curl -fsSL https://rclone.org/install.sh | bash
   install -d -m 700 -o deploy -g deploy /home/deploy/.config /home/deploy/.config/rclone
   ```

   **Mac:** `scp ~/.config/rclone/rclone.conf root@<server-ip>:/home/deploy/.config/rclone/rclone.conf`

   **root:** `chown deploy: /home/deploy/.config/rclone/rclone.conf && chmod 600 /home/deploy/.config/rclone/rclone.conf`

   **deploy:**

   ```sh
   rclone listremotes                       # must show expense-gdrive: and expense-drive-crypt:
   cd ~/expense-tracker
   scripts/backup.sh manual && scripts/backup.sh list-drive          # the new dump is listed
   (crontab -l 2>/dev/null; echo '17 * * * * $HOME/expense-tracker/scripts/backup.sh auto >/dev/null 2>&1') | crontab -
   ```

   **Browser:** on the droplet's Backups tab, turn on weekly backups (about $0.80 a month).

10. **Switch the old machine off.** Only with 7A, and only after step 9 listed the dump. On the
    **Mac**, in `expense-tracker/`:

    ```sh
    make backup-unschedule && make down        # the Mac's data stays in its volume as a fallback
    ```

## Part B: GitHub (one time)

This gives GitHub a key that can do exactly one thing on the server: run
`deploy sha-<commit>`. It cannot open a shell.

1. **Make a deploy key. Mac.**

   ```sh
   ssh-keygen -t ed25519 -N "" -C github-deploy -f ~/.ssh/expense_deploy
   ```

2. **Install it on the server, locked to the gate. Mac.** One line:

   ```sh
   echo "command=\"/home/deploy/expense-tracker/scripts/deploy-gate.sh\",restrict $(cat ~/.ssh/expense_deploy.pub)" | ssh root@<server-ip> "install -d -m 700 -o deploy -g deploy /home/deploy/.ssh && tee -a /home/deploy/.ssh/authorized_keys >/dev/null && chown deploy: /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys"
   ```

   Test it. Both must refuse, which proves the key can't get a shell:

   ```sh
   ssh -i ~/.ssh/expense_deploy deploy@<server-ip> whoami    # This key can only run: deploy sha-<7-char commit>
   ssh -i ~/.ssh/expense_deploy deploy@<server-ip>           # PTY allocation request failed, then the same refusal
   ```

   If you get a shell prompt, stop: the `command=` part is missing from `authorized_keys`.

3. **Pin the server's host key. Mac and root.** These two fingerprints must match:

   ```sh
   ssh-keyscan -t ed25519 <server-ip> | ssh-keygen -lf -       # Mac
   ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub            # root, on the server
   ```

   Then print the line you'll paste into GitHub (**Mac**):

   ```sh
   ssh-keyscan -t ed25519 <server-ip> 2>/dev/null
   ```

4. **Add the secrets. Browser.** Repo › Settings › Secrets and variables › Actions. All four go
   on the **Secrets** tab (New repository secret), **not** the Variables tab: the workflow reads
   them as secrets, and one under Variables counts as missing.

   | Secret | Value |
   | --- | --- |
   | `DEPLOY_HOST` | The server's public IP |
   | `DEPLOY_USER` | `deploy` |
   | `DEPLOY_SSH_KEY` | The output of `cat ~/.ssh/expense_deploy`, including the `-----BEGIN` and `-----END` lines |
   | `DEPLOY_KNOWN_HOSTS` | The `ssh-keyscan` line from step 3 (the IP, then `ssh-ed25519 …`) |

   The images workflow already uses the **variable** `DOCKERHUB_USERNAME` and the **secret**
   `DOCKERHUB_TOKEN`; leave those as they are.

   Then delete the private key from the Mac. GitHub holds the only copy, and you can always
   make a new one:

   ```sh
   rm ~/.ssh/expense_deploy
   ```

5. **First deploy. Browser.** Actions › Expense tracker deploy › Run workflow, branch `main`.
   Leave **tag** empty and tick **build**. It takes about 3 minutes. The Deploy step ends with
   `==> Deployed sha-…`. Open `http://<server-ip>` and log in.

The gate script (`deploy-gate.sh`) does not update itself. Each deploy refreshes the compose
file, `backup.sh` and `deploy.sh` from main, but if a change ever touches `deploy-gate.sh`,
fetch it again by hand as in Part A step 5.

## Part C: every deploy after that

**Deploy new code. Browser.** Merge the PR, then Actions › Expense tracker deploy › Run
workflow, branch `main`, tick **build**, leave **tag** empty. That builds the images for the
newest commit and deploys them. Every deploy takes a backup first, and stops if the backup
fails.

If the images for a commit already exist (you ran the images workflow yourself), leave
**build** unticked and type the tag, such as `sha-9a7d13b`.

What a deploy does on the server (`scripts/deploy.sh`): backup, pull the app images for the
tag, write `IMAGE_TAG` to `.env`, `docker compose up -d --wait`, check nginx and the API, then
remove old app images. It keeps the images for the current and the previous tag, so a rollback
needs no download. It never removes volumes or the Postgres image.

**Roll back. Browser.** Run the workflow again with the previous tag. The top of the Deploy
step prints it: `==> Deploying sha-new (running now: sha-old)`.

If the bad version changed the database (its PR added a file under
`backend/alembic/versions/`), the old code may not work with the new tables. Restore the
backup the deploy took first. **deploy**, in `~/expense-tracker`:

```sh
ls -t backups/expense-*-manual.dump | head -n 1
docker compose stop backend frontend
docker compose exec -T db sh -c 'psql -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public"'
docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner' < backups/<the file from the first line>
scripts/deploy.sh sha-<previous>
```

This loses anything entered after that deploy started.

**Deploy by hand, if GitHub is down. deploy:** `cd ~/expense-tracker && scripts/deploy.sh sha-<commit>`

**Look around. deploy**, in `~/expense-tracker`:

| What | Command |
| --- | --- |
| What's running | `docker compose ps` |
| Backend logs | `docker compose logs -f --tail=100 backend` |
| Memory | `docker stats --no-stream` and `free -m` |
| Disk | `df -h /` |
| App images on disk | `docker images \| grep expense-tracker` |
| Backups | `tail -n 20 backups/backup.log` |
| Unused images | `docker image prune -f` (images only, never volumes) |

**Never run these.** Each one deletes the database volume and all the data:
`docker compose down -v`, `docker volume rm`, `docker system prune --volumes`. A plain
`docker compose down` is safe.

**When your home IP changes** (plain HTTP only), the app stops loading. Edit the firewall's
HTTP rule in DigitalOcean (Networking › Firewalls) and put in the new IP. After Part D the
firewall is open to everyone, so this no longer applies.

## Part D: HTTPS with a DuckDNS name (one time)

Caddy, a small web server, sits in front of the app on ports 80 and 443. It gets a free
Let's Encrypt certificate for your DuckDNS name, renews it before it expires, and sends
`http://` visitors to `https://`. It is the `caddy` service in `docker-compose.deploy.yml`,
off until `.env` turns it on. It uses about 15 MB of memory.

1. **Get the name. Browser.** Sign in at https://www.duckdns.org (GitHub or Google), add a
   subdomain such as `<name>`, type the server's IP in **current ip** and press **update ip**.
   The droplet's IP never changes, so DuckDNS needs no updater on the server. Check it from
   the **Mac**; it must print the server's IP:

   ```sh
   dig +short <name>.duckdns.org
   ```

2. **Open the firewall to everyone. Browser.** Let's Encrypt checks the name by connecting
   to the server, from addresses nobody publishes, so a firewall limited to your IP blocks
   the certificate. In Networking › Firewalls, set:

   | Type | Port | Sources |
   | --- | --- | --- |
   | SSH | 22 | All IPv4, All IPv6 (unchanged) |
   | HTTP | 80 | All IPv4, All IPv6 |
   | HTTPS | 443 | All IPv4, All IPv6 |

   The login page is now reachable by anyone. Passwords travel encrypted, but 5 wrong tries
   lock an email for 15 minutes, so a stranger who knows your email could keep you out for a
   while.

3. **Settings. deploy**, in `~/expense-tracker`. Replace `<name>` and run:

   ```sh
   cp .env .env.before-https
   sed -i -e '/^COMPOSE_PROFILES=/d' -e '/^CADDY_DOMAIN=/d' \
     -e 's|^FRONTEND_BIND=.*|FRONTEND_BIND=127.0.0.1|' \
     -e 's|^FRONTEND_PORT=.*|FRONTEND_PORT=8080|' \
     -e 's|^PUBLIC_BASE_URL=.*|PUBLIC_BASE_URL=https://<name>.duckdns.org|' \
     -e 's|^COOKIE_SECURE=.*|COOKIE_SECURE=true|' .env
   printf 'COMPOSE_PROFILES=https\nCADDY_DOMAIN=<name>.duckdns.org\n' >> .env
   grep -E '^(COMPOSE_PROFILES|CADDY_DOMAIN|FRONTEND_[A-Z]+|PUBLIC_BASE_URL|COOKIE_SECURE)=' .env
   ```

   The frontend now listens only on the server itself (`127.0.0.1:8080`), and Caddy is the
   only thing the internet reaches.

4. **Start it. Browser.** Actions › Expense tracker deploy › Run workflow, branch `main`,
   tick **build**, leave **tag** empty. The deploy fetches the new compose file and starts
   Caddy with the rest. (By hand instead, as **deploy**: fetch `docker-compose.deploy.yml` as
   in Part A step 5, then `docker compose up -d --remove-orphans --wait`.)

5. **Check it. deploy:**

   ```sh
   docker compose ps caddy                                   # Up
   docker compose logs caddy | grep -i "certificate obtained"
   curl -sI http://<name>.duckdns.org | head -n 3            # 308, Location: https://...
   curl -s -o /dev/null -w '%{http_code}\n' https://<name>.duckdns.org/api/v1/auth/me   # 401
   ```

   In the **Browser**, open `https://<name>.duckdns.org` and log in again (the old plain-HTTP
   session doesn't carry over). `http://<server-ip>` stops working: use the name from now on.
   Invite links and password-reset links now use the `https://` address.

**Undo**, as **deploy**: `cp .env.before-https .env && docker compose up -d --remove-orphans`, then
set the firewall's HTTP source back to your IP. Caddy's container is removed; its certificates
stay in the `caddy_data` volume for next time.

## Move to another server

Moving means: set up the new server, copy the data across once, point GitHub at it, then
retire the old one. Downtime is the few minutes between the final backup and the restore.

1. **New server: Part A steps 1 to 6.** Attach the new droplet to the same firewall (or make one
   as in step 1). In `.env`, use the new `PUBLIC_BASE_URL`; a fresh `POSTGRES_PASSWORD` is fine,
   because the restore doesn't depend on it. Set `IMAGE_TAG` to the tag the old server runs
   (`grep IMAGE_TAG ~/expense-tracker/.env` there). With HTTPS, copy the Part D lines too, and
   at the cutover (step 7) point the DuckDNS name at the new IP: Caddy gets a new certificate
   by itself within a minute.
2. **New server: rclone (Part A step 9, without the cron line yet).** Copy the config from the
   old server instead of the Mac:

   ```sh
   ssh root@<old-ip> cat /home/deploy/.config/rclone/rclone.conf | ssh root@<new-ip> 'cat > /home/deploy/.config/rclone/rclone.conf && chown deploy: /home/deploy/.config/rclone/rclone.conf && chmod 600 /home/deploy/.config/rclone/rclone.conf'
   ```

3. **Old server: freeze and take the final backup. deploy**, in `~/expense-tracker`:

   ```sh
   crontab -l | grep -v backup.sh | crontab -      # stop the hourly backups here
   docker compose stop frontend backend            # nobody can add entries now
   scripts/backup.sh manual && scripts/backup.sh list-drive
   ```

   Note the name of the newest `-manual.dump`.

4. **New server: fetch and restore. deploy:**

   ```sh
   cd ~/expense-tracker
   scripts/backup.sh fetch expense-<date>-manual.dump
   ```

   Then run the 7A restore block, with `backups/fetched/expense-<date>-manual.dump` as the
   file. Check that the counts match the old server.
5. **New server: turn on backups.** The `crontab` line from Part A step 9, plus weekly droplet
   backups.
6. **GitHub: move the deploy key.** The private key lives only in GitHub, so copy the
   `authorized_keys` line from the old server instead of making a new key:

   ```sh
   ssh root@<old-ip> cat /home/deploy/.ssh/authorized_keys | ssh root@<new-ip> 'install -d -m 700 -o deploy -g deploy /home/deploy/.ssh && cat > /home/deploy/.ssh/authorized_keys && chown deploy: /home/deploy/.ssh/authorized_keys && chmod 600 /home/deploy/.ssh/authorized_keys'
   ```

   Then repeat Part B step 3 for the new IP, and update the secrets `DEPLOY_HOST` and
   `DEPLOY_KNOWN_HOSTS`. (Or do all of Part B again with a new key.)
7. **Deploy once from GitHub** with the current tag, to prove the path works end to end.
8. **Retire the old server.** Power it off but keep it for a week as a fallback, then destroy
   it. If you need to go back: power it on, `docker compose start`, re-add its crontab line, and
   set the two secrets back.

## Troubleshooting

| You see | Cause | Fix |
| --- | --- | --- |
| `compose file "docker-compose.deploy.yml" … no such file or directory` | Part A step 5's downloads didn't run | Run the deploy block of step 5 again as **deploy** |
| `E: Could not open lock file … are you root?` | A **root** block run as deploy | `exit` to root and run it again |
| Login says "Wrong email or password" after a 7A restore | The restore didn't land; the database is empty | Check with the last line of 7A; run the 7A restore block again |
| Login says "Too many failed logins" | 5 wrong tries lock that email for 15 minutes | Wait 15 minutes |
| Login flashes and returns to the login page | The browser dropped the cookie: `COOKIE_SECURE` isn't `false` on plain HTTP | Fix `.env`, then `docker compose up -d` |
| `FAILED: Drive isn't set up for backups` | rclone missing, or deploy can't read its `rclone.conf` | Part A step 9; `rclone listremotes` as **deploy** must list both remotes |
| `Config file "/root/.config/rclone/rclone.conf" not found` | You ran rclone as root | Run it as **deploy** |
| `channel N: open failed: connect failed` | An SSH tunnel (`ssh -L …`) points at a port nothing listens on | Close the tunnel and open `http://<server-ip>` directly |
| Workflow: `Missing settings. Needs the variable DOCKERHUB_USERNAME and the secrets …` | A `DEPLOY_*` value is under Variables, or missing | Add it on the Secrets tab (Part B step 4) |
| Workflow: `… is not on Docker Hub` | No images for that commit | Tick **build**, or run the images workflow first |
| Workflow: `Host key verification failed` | `DEPLOY_KNOWN_HOSTS` is wrong, or the server was rebuilt | Redo Part B step 3 and update the secret |
| Browser: the HTTPS page doesn't load, `docker compose logs caddy` shows `challenge failed` or `timeout` | Let's Encrypt can't reach the server | Ports 80 and 443 open to All (Part D step 2), and `dig +short <name>.duckdns.org` prints the server's IP |
| `caddy` logs say `too many certificates` | Let's Encrypt's weekly limit, after many fresh starts with a deleted `caddy_data` volume | Wait; never delete `caddy_data` |
| Login over HTTPS flashes back to the login page | `COOKIE_SECURE`/`PUBLIC_BASE_URL` still hold the HTTP values | Part D step 3, then `docker compose up -d` |
