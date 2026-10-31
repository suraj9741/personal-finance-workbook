# Expense Tracker

A household expense tracker that replaces the "2027 Finance" Google Sheet. You add each
day's spending from a quick-add bar, rules fill in the category, and the dashboard shows
income, spend, savings rate, budgets and anything that needs attention. Several people can
share one household, and anyone can keep their own private tracker.

Phase 1 is manual entry. Statement import (Excel/CSV, then PDF for card statements) is
Phase 2.

## Run it on your Mac

You need Docker Desktop running. Everything else runs in containers.

```sh
git clone https://github.com/suraj9741/personal-finance-workbook.git
cd personal-finance-workbook/expense-tracker

make up                                              # first run creates .env with a random DB password
make create-admin EMAIL=you@example.com NAME=Suraj   # asks for a password (10+ characters)
```

Then open:

| What | URL |
| --- | --- |
| The app | http://localhost:8080 |
| API docs (Swagger) | http://localhost:8000/docs |
| Health / readiness | http://localhost:8000/healthz, http://localhost:8000/readyz |
| Prometheus metrics | http://localhost:8000/metrics |

The app (`:8080`) binds to `0.0.0.0` so other devices can reach it over Tailscale (see
[Reach it from other devices](#reach-it-from-other-devices-tailscale)). That also opens it to
anyone on your Wi-Fi. The API (`:8000`) still binds to `127.0.0.1`; other devices reach it
only through nginx's `/api` proxy.

Your accounts and categories come from [`config/seed.yaml`](config/seed.yaml) (see
[Accounts and categories](#accounts-and-categories-configseedyaml) below). People you invite
into their own household start with no accounts and the starter categories (without your
family groups). They add their own accounts on the Accounts page.

### Reach it from other devices (Tailscale)

With Tailscale on the Mac and on your phone or other laptop, open
http://apples-macbook-air.minmi-saiph.ts.net:8080 from any device on the tailnet.

Two settings make this work:

1. **Port binding** in `docker-compose.yml`: `"0.0.0.0:${FRONTEND_PORT:-8080}:8080"`.
   With `127.0.0.1:` in front, Docker accepts connections from the Mac only. A request
   arriving on the Mac's Tailscale address (`100.x.x.x`) finds nothing listening and is
   refused.
2. **`PUBLIC_BASE_URL`** in `.env`: `http://apples-macbook-air.minmi-saiph.ts.net:8080`.
   The backend builds invite and password-reset links from it. With the default
   `http://localhost:8080`, a link opened on a phone points at the phone itself and fails.

![Phone or laptop reaches the Mac over Tailscale; nginx on 0.0.0.0:8080 proxies /api to the backend on 127.0.0.1:8000](docs/diagrams/tailscale-access.drawio.svg)

After changing either setting, run `docker compose up -d` to recreate the containers (the
data volume is kept). If another device still can't connect, allow Docker under System
Settings › Network › Firewall › Options.

To keep the app off your Wi-Fi, put `127.0.0.1:` back in the port binding and use
`tailscale serve --bg 8080` instead. Tailscale then forwards
`https://apples-macbook-air.minmi-saiph.ts.net` to localhost for tailnet devices only, over
HTTPS. In that case set `PUBLIC_BASE_URL` to the `https://` address and `COOKIE_SECURE=true`.

### Adding people

Open **Admin › Invite someone** and pick one of:

- **Join "your household"**: they share your accounts, entries and budgets (family).
- **Their own new household**: a separate private tracker that you can't see into.

Copy the link and send it yourself; it is valid for 7 days. Inside a shared household,
anyone can add a **private** account on the Accounts page. Entries on it are visible
only to them.

### Day to day

- Type an amount and a description in the bar at the top and press Enter. Past
  descriptions are suggested as you type. Pick the account type (Bank, Credit Card, Share
  Market Broker) and then the account; cash is under Bank.
- The full form (Transactions › Full form) also records transfers, refunds, and broker buys
  and sells. Pay a card bill or fund a broker with a **Transfer**.
- Accounts: your accounts grouped by type, with balances, card outstanding and available
  credit, and broker invested amounts. Add, rename, edit or deactivate accounts there. Click
  an account for its details page: figures, the month, and its entries with filters.
- Dashboard: the financial overview (bank balance, card outstanding, available credit, net
  cash, invested, portfolio value, the month's income and expenses, and a table per account
  type) sits above the monthly category view.
- Settings › Auto-categorization rules: "swiggy" → Everyday › Food, and so on. Rules also
  fill in old uncategorized rows when you press "Apply to uncategorized".
- On Transactions, "Save as rule" turns a row's category into a rule.
- Budgets: set a category's budget once and it carries forward to every later month until
  you change it. A change applies from the month you make it in; earlier months keep their
  budgets. Tick "Only this month" for a one-off. Each expense and income line shows Budget,
  Spent (or Earned) and Diff, where a positive Diff is good: money left, or more earned
  than planned.
- Pay a credit card bill as a **Transfer** (Self Transfer › Bank to Credit), not as an
  expense, or the card spends are counted twice. The dashboard warns you if
  Debt › Credit cards gets used.

## Your data

Data lives in the Docker volume `expense-tracker_pgdata`.

- `make down` stops the app and keeps the data.
- **Never run `docker compose down -v`.** The `-v` deletes the volume and every entry with it.
- A launchd job (`make backup-schedule`) checks every hour and takes a daily `pg_dump` into
  `~/expense-tracker-backups` (`./backups` links there). `make backup` takes one right now. Each dump is encrypted and copied to
  Google Drive, and the newest 7 daily and 3 manual dumps are kept in both places.
  `make backup-status` shows what ran.
- `make restore FILE=backups/expense-YYYYMMDD-HHMMSS.dump` replaces the database with that
  backup. It asks you to type `yes` first.

Set up the Drive copy once per Mac with `brew install rclone` and `make backup-drive-setup`,
and keep the passphrase it prints in Bitwarden. `.env` and `backups/` are gitignored, so
neither ends up in git. The [backup guide](docs/backup-guide.md) covers setup, checking a
dump, and restoring from Drive.

## Operations docs

| Guide | Use it to |
| --- | --- |
| [Architecture overview](docs/architecture-overview.md) | understand the components, data, network, and single points of failure |
| [Deployment guide](docs/deployment-guide.md) | set up a new machine from scratch, and deploy updates |
| [Backup guide](docs/backup-guide.md) | take, check, encrypt and store backups |
| [Restore guide](docs/restore-guide.md) | recover from lost data, a broken database, a lost Mac or a bad deploy |
| [Environment migration guide](docs/environment-migration-guide.md) | move the app and its data to a new machine, with cutover and rollback |
| [Quick reference](docs/quick-reference-commands.md) | copy the commands without the explanations |

The diagrams for these guides are in [`docs/diagrams/`](docs/diagrams):
[system architecture](docs/diagrams/system-architecture.drawio.svg),
[deployment flow](docs/diagrams/deployment-flow.drawio.svg),
[backup and restore](docs/diagrams/backup-restore-architecture.drawio.svg) and
[environment migration](docs/diagrams/environment-migration.drawio.svg).

## Commands

```
make help          list everything below
make up            build and start (app on :8080)
make down          stop; data is kept
make logs          follow logs
make ps            service status
make migrate       apply database migrations
make apply-config  add what's missing from config/seed.yaml (make up does this too)
make create-admin  EMAIL=... NAME=...
make seed          demo households with fake data (asha@, ravi@, sam@example.com / demo-password)
make backup        back up now (and copy to Drive)
make backup-status newest backups, last upload, schedule
make restore       FILE=backups/....dump
make test          backend + frontend tests in throwaway containers
make lint          ruff, mypy, ESLint
make fmt           auto-format backend code
```

## How it is built

```
browser ──► frontend (nginx, :8080) ──/api──► backend (FastAPI, :8000) ──► db (Postgres 16)
                                                       ▲
                       migrate (one-shot: alembic upgrade head, then exits)
                       seed    (one-shot: adds what's missing from config/seed.yaml)
```

- **backend/**: Python 3.12, FastAPI, Pydantic v2, SQLAlchemy 2, Alembic. All routes are under
  `/api/v1`. Config comes only from environment variables (`app/config.py`).
- **frontend/**: React, TypeScript, Vite, TanStack Query, plain CSS. In Docker it is built
  once and served by nginx, which also proxies `/api` to the backend, so the browser sees a
  single origin. The look comes from one file of design tokens, `src/theme/tokens.css`
  (colours for light and dark, type, spacing, radii, shadows, motion); `src/styles.css`
  only refers to those tokens, so changing the design means editing `tokens.css`. The map
  of screens, pages and components is in
  [docs/diagrams/frontend-components.svg](docs/diagrams/frontend-components.svg).
- **migrate** runs before the backend starts. The backend never changes the schema itself.

### CORS, and why this app doesn't need it

An **origin** is scheme + host + port. `http://localhost:5173` and `http://localhost:8000`
are different origins (different port), as are `app.com` and `api.app.com` (different host)
and `http` and `https` (different scheme).

CORS (Cross-Origin Resource Sharing) is a rule the **browser** enforces: JavaScript on a page
from origin A may read a response from origin B only if B says A is allowed, with an
`Access-Control-Allow-Origin` header. It exists so a page on `evil.com` can't call your API
with your cookies and read the answer.

Same origin, so no CORS. This is how the app runs, in Docker (nginx) and with `npm run dev`
(Vite's proxy):

![Same-origin request: browser to nginx to backend, no CORS check](docs/diagrams/cors-same-origin.drawio.svg)

Cross origin, so CORS applies. This happens only if the browser calls the API on another
origin directly:

![Cross-origin request: OPTIONS preflight, then DELETE, each answered with Access-Control-Allow-Origin](docs/diagrams/cors-cross-origin.drawio.svg)

The diagrams are draw.io files in [`docs/diagrams/`](docs/diagrams). Open a `.drawio.svg` in
draw.io (desktop or app.diagrams.net) to edit it; the image and the diagram stay in one file.

Things worth knowing:

- **The server still runs the request.** CORS only stops the page's JavaScript from reading
  the response. It does not protect the API, which is why every route here still checks the
  session and household.
- **Preflight.** `PUT`, `DELETE`, JSON bodies and custom headers (like `X-Requested-With`)
  make the browser send an `OPTIONS` request first. The real request goes out only if the
  answer allows it.
- **Cookies are stricter.** A cross-origin request with cookies needs an exact origin (no
  `*`) and `Access-Control-Allow-Credentials: true`.
- **No browser, no CORS.** Service-to-service calls, `curl` and Postman never involve it.
  In a microservice setup, CORS matters only where the browser meets your system. A gateway
  or reverse proxy in front of every service (what nginx does here) avoids it altogether.

| Situation | CORS? |
| --- | --- |
| Page and API behind the same nginx / gateway | No |
| Page and API on different ports, subdomains or domains | Yes: the API sends `Access-Control-Allow-*` and answers `OPTIONS` |
| Backend calling another backend, or `curl` | No |

The frontend always calls a relative `/api/v1` (`frontend/src/api.ts`), and both nginx and
the Vite dev server proxy it, so `CORS_ORIGINS` in `.env` (comma-separated) is only needed if
a page on another origin calls the API directly, such as a separate app or a frontend
changed to use a full API URL. Exposing the app over Tailscale does not need it.

### Security model

- Logins use server-side sessions: an HttpOnly, SameSite=Lax cookie that holds a random token.
  Only its SHA-256 hash is stored. Sessions slide for 30 days, and passwords are hashed
  with argon2.
- Five failed logins in 15 minutes lock that email out for the rest of the window (HTTP 429).
- Every write to `/api/v1` must send an `X-Requested-With` header, which blocks cross-site
  form posts.
- Every query is scoped to the caller's household. Another household's rows, and other
  members' private accounts, return 404, as if they don't exist.
- Logs are JSON and carry the route template, status and timing. They never include
  amounts, descriptions or email addresses.
- Set `COOKIE_SECURE=true` once the app is served over HTTPS.

### API overview

| Area | Routes |
| --- | --- |
| Auth | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/password`, `POST /auth/reset/{token}` |
| Household | `POST /invites`, `GET /invites/{token}`, `POST /invites/{token}/accept`, `GET /household/members`, `PATCH/DELETE /household/members/{user_id}` |
| Catalog | `/categories`, `/accounts`, `GET /accounts/{id}`, `GET /accounts/{id}/summary`, `/rules`, `POST /rules/apply` |
| Transactions | `GET/POST /transactions`, `GET /transactions/suggest`, `GET/PATCH/DELETE /transactions/{id}`, `POST /transactions/{id}/make-rule` |
| Budgets and stats | `GET/PUT /budgets`, `POST /budgets/copy`, `GET /stats/month`, `GET /stats/trend`, `GET /stats/attention`, `GET /stats/overview` |
| Admin | `/admin/users`, `/admin/invites`, `/admin/households`, `/admin/category-template`, `/admin/settings` |

The full, typed list is at http://localhost:8000/docs.

### Balances and transaction types

Balances are worked out on the server from stored transactions (`app/balances.py`); nothing
is stored or typed in by hand except opening balances and a broker's current value.

| Type | Moves money | Counts as |
| --- | --- | --- |
| `expense` | out of the account | spend (by category group) |
| `income` | into the account | earned |
| `refund` | into the account | takes spend back off its expense category |
| `transfer` | out of one account, into the "to" account | neither income nor expense |
| `buy` / `sell` | broker cash into / out of securities | neither; changes the invested amount |

- **Bank and cash**: balance = opening balance + money in - money out.
- **Credit card**: outstanding = opening balance (owed on the opening date) + purchases -
  payments - refunds. Available credit = credit limit - outstanding, never below 0, and it is
  not money you have. Pay a card bill with a **transfer** from the bank, not an expense, or it
  counts twice.
- **Share market broker**: the balance is the cash in the broker account. Moving money in is a
  transfer, not an investment. Invested = opening invested + buys - cost of what was sold (a
  sell without a cost basis comes off at its proceeds). Current value is only what you enter;
  without it, profit/loss stays empty. Realized profit/loss needs a cost basis on each sell.
- **Opening date**: when set, only transactions on or after it count toward the balance.
- Month figures (income, expenses, purchases, payments) use the chosen month; balances never do.
- Overview totals use active accounts; inactive accounts keep their history and still show
  in month figures. Net cash = bank and cash balances - card outstanding. Investments are
  shown apart from cash.

### Accounts and categories (config/seed.yaml)

`config/seed.yaml` holds your accounts, your categories, the starter category list for new
households, and app settings. On every `make up` the one-shot `seed` service applies
it right after migrations. To apply an edit without a restart, run `make apply-config`.

The seed only **adds**. It never renames, changes or deletes anything, so the database stays
the source of truth and edits you make in the app are safe. It also remembers what it has
already handled (`seed_log` table), so an account or category you delete in the app is not
added back on the next deploy. To change something that already exists, change it in the app.

- `admin_household`: applied to every household that has a site admin (yours). It started out
  as the finance sheet's starter list: 16 accounts and 154 categories, including the family
  groups.
- `new_household`: categories copied into each household created from an invite: the same
  list without the family groups (Gotu, Mom, Baba, Pratiksha, Farm), 101 categories. New
  households get no accounts. A change here only affects households created after it; existing
  households keep their own categories. You can also edit this list on the Admin page.
- A category that isn't plain spend or income says what it counts as (`saving`, `lent`,
  `repaid`), which keeps savings, money lent and transfers out of "Spent".

To start the file over from the finance sheet's `Defaults.gs`:

```sh
cd backend && uv run python scripts/config_from_sheet.py > ../config/seed.yaml
```

Migrations no longer add accounts or categories. Only this file does.

## Developing without Docker

```sh
# backend (needs a local Postgres)
cd backend
uv sync
export DATABASE_URL=postgresql+psycopg://expense:expense@localhost:5432/expense
export COOKIE_SECURE=false   # plain http on localhost
uv run alembic upgrade head
uv run uvicorn app.main:app --reload

# frontend (proxies /api to :8000)
cd frontend
npm ci
npm run dev        # http://localhost:5173
```

CI (`.github/workflows/expense-tracker.yml`) runs `make lint` and `make test` on every change
under `expense-tracker/`.
