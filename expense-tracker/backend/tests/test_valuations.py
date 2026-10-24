"""Broker value history: every value entered is kept with its date, one per date."""

from datetime import UTC, datetime

from alembic import command
from sqlalchemy import text
from sqlalchemy.orm import Session

from tests.conftest import Api, account_id, alembic_config

API = "/api/v1"


def history(client: Api, account: str) -> list[tuple[str, str]]:
    rows = client.get(f"{API}/accounts/{account}/valuations").json()
    return [(r["valued_on"], r["value"]) for r in rows]


def test_each_value_is_kept_with_its_date(admin: Api) -> None:
    zerodha = account_id(admin, "Zerodha")
    url = f"{API}/accounts/{zerodha}"
    admin.patch(url, json={"current_value": "30000", "valued_on": "2026-09-30"})
    admin.patch(url, json={"current_value": "33000", "valued_on": "2026-10-31"})
    assert history(admin, zerodha) == [("2026-10-31", "33000.00"), ("2026-09-30", "30000.00")]
    # The account itself still shows the latest value.
    assert admin.get(url).json()["current_value"] == "33000.00"


def test_same_date_replaces_and_unchanged_saves_add_nothing(admin: Api) -> None:
    zerodha = account_id(admin, "Zerodha")
    url = f"{API}/accounts/{zerodha}"
    admin.patch(url, json={"current_value": "1000", "valued_on": "2026-10-31"})
    admin.patch(url, json={"current_value": "1200", "valued_on": "2026-10-31"})
    # The form resends every field; a name change alone is not a new value.
    admin.patch(
        url, json={"name": "Zerodha Kite", "current_value": "1200", "valued_on": "2026-10-31"}
    )
    assert history(admin, zerodha) == [("2026-10-31", "1200.00")]


def test_undated_value_is_dated_today_and_clearing_keeps_history(admin: Api) -> None:
    dhan = account_id(admin, "Dhan")
    url = f"{API}/accounts/{dhan}"
    admin.patch(url, json={"current_value": "500"})
    today = datetime.now(UTC).date().isoformat()
    assert history(admin, dhan) == [(today, "500.00")]
    admin.patch(url, json={"current_value": None, "valued_on": None})
    assert history(admin, dhan) == [(today, "500.00")]


def test_new_broker_with_a_value_starts_its_history(admin: Api) -> None:
    created = admin.post(
        f"{API}/accounts",
        json={
            "name": "Groww",
            "pay_type": "share_broker",
            "current_value": "2500",
            "valued_on": "2026-10-20",
        },
    )
    assert created.status_code == 201
    assert history(admin, created.json()["id"]) == [("2026-10-20", "2500.00")]
    duplicate = admin.post(f"{API}/accounts", json={"name": "Groww", "pay_type": "share_broker"})
    assert duplicate.status_code == 409


def test_history_is_private_to_the_household(admin: Api, solo: Api) -> None:
    zerodha = account_id(admin, "Zerodha")
    admin.patch(f"{API}/accounts/{zerodha}", json={"current_value": "1"})
    assert solo.get(f"{API}/accounts/{zerodha}/valuations").status_code == 404


def test_deleting_an_account_drops_its_history(admin: Api, db: Session) -> None:
    created = admin.post(
        f"{API}/accounts", json={"name": "Groww", "pay_type": "share_broker", "current_value": "9"}
    ).json()
    assert admin.delete(f"{API}/accounts/{created['id']}").status_code == 204
    assert db.execute(text("SELECT count(*) FROM account_valuations")).scalar() == 0


def test_migration_starts_history_from_values_already_entered(admin: Api, db: Session) -> None:
    zerodha = account_id(admin, "Zerodha")
    admin.patch(
        f"{API}/accounts/{zerodha}", json={"current_value": "700", "valued_on": "2026-10-13"}
    )
    db.close()
    config = alembic_config()
    command.downgrade(config, "0008")
    command.upgrade(config, "head")
    assert history(admin, zerodha) == [("2026-10-13", "700.00")]
