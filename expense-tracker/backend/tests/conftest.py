import os
from collections.abc import Iterator
from pathlib import Path

import pytest

os.environ["DATABASE_URL"] = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://postgres:postgres@localhost:5432/expense_test"
)
os.environ.setdefault("COOKIE_SECURE", "false")
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("LOG_LEVEL", "WARNING")

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.cli import create_admin
from app.db import get_engine, get_sessionmaker
from app.main import app

BACKEND = Path(__file__).resolve().parents[1]
PASSWORD = "correct-horse-battery"
# Reference data written by migrations survives between tests.
KEEP = {"alembic_version", "category_templates", "app_settings"}


def alembic_config() -> Config:
    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "alembic"))
    return config


@pytest.fixture(scope="session", autouse=True)
def migrated() -> None:
    with get_engine().begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public"))
    command.upgrade(alembic_config(), "head")


@pytest.fixture(autouse=True)
def clean_tables(migrated: None) -> Iterator[None]:
    yield
    with get_engine().begin() as conn:
        tables = conn.execute(
            text("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
        ).scalars()
        names = [t for t in tables if t not in KEEP]
        conn.execute(text(f"TRUNCATE {', '.join(names)} CASCADE"))


@pytest.fixture
def db() -> Iterator[Session]:
    with get_sessionmaker()() as session:
        yield session


class Api(TestClient):
    """TestClient that sends the CSRF header and remembers the logged-in user's cookie."""

    def __init__(self) -> None:
        super().__init__(app, headers={"X-Requested-With": "test"})

    def login(self, email: str, password: str = PASSWORD) -> "Api":
        response = self.post("/api/v1/auth/login", json={"email": email, "password": password})
        assert response.status_code == 204, response.text
        return self


def new_client() -> Api:
    return Api()


@pytest.fixture
def admin(db: Session) -> Api:
    create_admin(db, "suraj@example.com", "Suraj", PASSWORD)
    return new_client().login("suraj@example.com")


def join_by_invite(
    inviter: Api, email: str, name: str, *, admin_new_household: str | None = None
) -> Api:
    """Create an invite (household invite, or admin invite to a new household) and accept it."""
    if admin_new_household is not None:
        response = inviter.post(
            "/api/v1/admin/invites", json={"new_household_name": admin_new_household}
        )
    else:
        response = inviter.post("/api/v1/invites", json={"role": "member"})
    assert response.status_code == 201, response.text
    token = response.json()["url"].rsplit("/", 1)[1]
    client = new_client()
    accepted = client.post(
        f"/api/v1/invites/{token}/accept",
        json={"email": email, "display_name": name, "password": PASSWORD},
    )
    assert accepted.status_code == 201, accepted.text
    return client


@pytest.fixture
def family_member(admin: Api) -> Api:
    return join_by_invite(admin, "pratiksha@example.com", "Pratiksha")


@pytest.fixture
def solo(admin: Api) -> Api:
    return join_by_invite(
        admin, "friend@example.com", "Friend", admin_new_household="Friend's house"
    )


def category_id(client: Api, parent: str, sub: str, kind: str = "expense") -> str:
    for c in client.get("/api/v1/categories").json():
        if (c["parent_name"], c["sub_name"], c["kind"]) == (parent, sub, kind):
            return str(c["id"])
    raise AssertionError(f"category {parent} > {sub} not found")


def account_id(client: Api, name: str) -> str:
    for a in client.get("/api/v1/accounts").json():
        if a["name"] == name:
            return str(a["id"])
    raise AssertionError(f"account {name} not found")


def add_tx(client: Api, **fields: object) -> dict:  # type: ignore[type-arg]
    body = {"date": "2026-10-05", "amount": "100.00", "account_id": account_id(client, "HDFC")}
    body.update(fields)
    response = client.post("/api/v1/transactions", json=body)
    assert response.status_code == 201, response.text
    return response.json()  # type: ignore[no-any-return]
