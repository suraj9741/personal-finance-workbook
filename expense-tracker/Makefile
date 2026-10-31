# Expense tracker. Needs only Docker Desktop. Run `make help` for the list.
SHELL := /bin/bash
COMPOSE := docker compose
TEST_COMPOSE := docker compose -f docker-compose.test.yml
LAUNCHD_LABEL := com.expense-tracker.backup
LAUNCHD_PLIST := $(HOME)/Library/LaunchAgents/$(LAUNCHD_LABEL).plist
# The copy of scripts/backup.sh that launchd runs (see scripts/backup.sh install).
RUNNER_DIR := $(HOME)/.local/share/expense-tracker

.DEFAULT_GOAL := help
.PHONY: help env up down logs ps migrate create-admin apply-config seed backup backup-status backup-schedule backup-unschedule backup-drive-setup backup-list-drive backup-fetch backup-test restore test lint fmt clean-test

help: ## Show this list
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-19s %s\n", $$1, $$2}'

env: ## Create .env from .env.example (first run only)
	@test -f .env || (cp .env.example .env && \
	  sed -i.bak "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$$(openssl rand -hex 24)/" .env && rm -f .env.bak && \
	  echo "Created .env with a random database password")

up: env ## Build and start everything (app at http://localhost:8080)
	$(COMPOSE) up -d --build --remove-orphans
	@echo "App: http://localhost:$${FRONTEND_PORT:-8080}   API docs: http://localhost:$${BACKEND_PORT:-8000}/docs"

down: ## Stop the app. Your data is kept.
	$(COMPOSE) down

logs: ## Follow logs from all services
	$(COMPOSE) logs -f --tail=100

ps: ## Show service status
	$(COMPOSE) ps -a

migrate: env ## Apply database migrations
	$(COMPOSE) run --rm migrate

create-admin: env ## Create the first admin: make create-admin EMAIL=you@example.com NAME=Suraj
	@test -n "$(EMAIL)" || (echo "Usage: make create-admin EMAIL=you@example.com NAME=Suraj" && exit 1)
	$(COMPOSE) run --rm -it backend python -m app.cli create-admin --email "$(EMAIL)" $(if $(NAME),--name "$(NAME)")

apply-config: env ## Add what's missing from config/seed.yaml now (make up does this too)
	$(COMPOSE) run --rm seed
	@# A deploy can change the backup script, so refresh the copy the schedule runs.
	@if [ -f "$(LAUNCHD_PLIST)" ]; then scripts/backup.sh install; fi

seed: env ## Load demo households with fake data (for trying the app, not for real use)
	$(COMPOSE) run --rm backend python -m app.cli seed-demo

backup: ## Back up now (kept as a manual dump) and copy it to Google Drive
	@scripts/backup.sh manual

backup-status: ## Newest backups, last Drive upload, schedule on or off
	@scripts/backup.sh status

backup-schedule: ## Turn on the daily backup (a launchd job on this Mac that checks hourly)
	@scripts/backup.sh install
	@mkdir -p "$$HOME/Library/LaunchAgents"
	@cp "$(RUNNER_DIR)/$(LAUNCHD_LABEL).plist" "$(LAUNCHD_PLIST)"
	@launchctl bootout gui/$$(id -u)/$(LAUNCHD_LABEL) 2>/dev/null || true
	launchctl bootstrap gui/$$(id -u) "$(LAUNCHD_PLIST)"
	@echo "Daily backup is on. Check it with: make backup-status"

backup-unschedule: ## Turn the daily backup off (the backups themselves stay)
	@launchctl bootout gui/$$(id -u)/$(LAUNCHD_LABEL) 2>/dev/null || true
	@rm -f "$(LAUNCHD_PLIST)"
	@rm -rf "$(RUNNER_DIR)"
	@echo "Daily backup is off."

backup-drive-setup: ## Connect Google Drive and create the encrypted backup folder (once per Mac)
	@scripts/backup.sh drive-setup

backup-list-drive: ## List the backups stored in Google Drive
	@scripts/backup.sh list-drive

backup-fetch: ## Download and decrypt a backup from Drive: make backup-fetch FILE=expense-....dump
	@scripts/backup.sh fetch "$(FILE)"

backup-test: ## Test the backup script against a local folder instead of Drive (needs rclone)
	@scripts/test_backup.sh

restore: ## Replace the database with a backup: make restore FILE=backups/xxx.dump
	@test -f "$(FILE)" || (echo "Usage: make restore FILE=backups/expense-....dump" && exit 1)
	@read -p "This replaces ALL current data with $(FILE). Type 'yes' to continue: " ok && [ "$$ok" = yes ]
	$(COMPOSE) stop backend frontend
	@# Start from an empty schema, so tables added after the backup was taken don't linger.
	$(COMPOSE) exec -T db sh -c 'psql -q -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public"'
	$(COMPOSE) exec -T db sh -c 'pg_restore -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" --no-owner' < "$(FILE)"
	$(COMPOSE) start backend frontend

test: ## Run backend and frontend tests in throwaway containers
	$(TEST_COMPOSE) build backend-tests frontend-tests
	$(TEST_COMPOSE) run --rm backend-tests; status=$$?; \
	  $(TEST_COMPOSE) run --rm frontend-tests || status=1; \
	  $(TEST_COMPOSE) down -v --remove-orphans >/dev/null 2>&1; exit $$status

lint: ## ruff, mypy and ESLint
	$(TEST_COMPOSE) build backend-lint frontend-lint
	$(TEST_COMPOSE) run --rm backend-lint && $(TEST_COMPOSE) run --rm frontend-lint

fmt: ## Auto-format backend code with ruff
	$(TEST_COMPOSE) run --rm -v $(CURDIR)/backend:/app backend-lint sh -c "ruff format . && ruff check --fix ."

clean-test: ## Remove test containers
	$(TEST_COMPOSE) down -v --remove-orphans
