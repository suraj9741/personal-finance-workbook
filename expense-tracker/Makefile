# Expense tracker. Needs only Docker Desktop. Run `make help` for the list.
SHELL := /bin/bash
COMPOSE := docker compose
TEST_COMPOSE := docker compose -f docker-compose.test.yml

.DEFAULT_GOAL := help
.PHONY: help env up down logs ps migrate create-admin seed backup restore test lint fmt clean-test

help: ## Show this list
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-14s %s\n", $$1, $$2}'

env: ## Create .env from .env.example (first run only)
	@test -f .env || (cp .env.example .env && \
	  sed -i.bak "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$$(openssl rand -hex 24)/" .env && rm -f .env.bak && \
	  echo "Created .env with a random database password")

up: env ## Build and start everything (app at http://localhost:8080)
	$(COMPOSE) up -d --build
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

seed: env ## Load demo households with fake data (for trying the app, not for real use)
	$(COMPOSE) run --rm backend python -m app.cli seed-demo

backup: ## Write a database backup to ./backups now
	@mkdir -p backups
	$(COMPOSE) exec -T db sh -c 'pg_dump -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" --format=custom' > backups/expense-$$(date +%Y%m%d-%H%M%S)-manual.dump
	@ls -lh backups | tail -n 3

restore: ## Replace the database with a backup: make restore FILE=backups/xxx.dump
	@test -f "$(FILE)" || (echo "Usage: make restore FILE=backups/expense-....dump" && exit 1)
	@read -p "This replaces ALL current data with $(FILE). Type 'yes' to continue: " ok && [ "$$ok" = yes ]
	$(COMPOSE) stop backend frontend
	$(COMPOSE) exec -T db sh -c 'pg_restore -U "$$POSTGRES_USER" -d "$$POSTGRES_DB" --clean --if-exists --no-owner' < "$(FILE)"
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
