import os
import re
from ast import literal_eval
from pathlib import Path

import pytest
from alembic import command
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.services import full_account_list
from tests.conftest import Api, add_tx, alembic_config

_REPO = Path(__file__).resolve().parents[1].parent.parent
DEFAULTS = Path(
    os.environ.get("DEFAULTS_GS", _REPO / "finance-sheet" / "src" / "config" / "Defaults.gs")
)
PAY_TYPES = {"Bank": "bank", "Credit Card": "credit_card", "Share Broker": "share_broker"}
BASICS = {("HDFC", "bank"), ("Yes Bank", "credit_card"), ("Cash", "cash")}


def pairs(accounts: list[dict[str, str]]) -> set[tuple[str, str]]:
    return {(a["name"], a["pay_type"]) for a in accounts}


@pytest.mark.skipif(not DEFAULTS.exists(), reason="Apps Script source not present")
def test_account_json_matches_defaults_gs() -> None:
    block = re.search(r"PAY:\s*(\[.*?\n  \])", DEFAULTS.read_text(), re.S)
    assert block
    script = {(name, PAY_TYPES.get(kind, "cash")) for kind, name, _ in literal_eval(block.group(1))}
    assert pairs(full_account_list()) == script


def test_admin_household_has_every_script_account(admin: Api) -> None:
    accounts = admin.get("/api/v1/accounts").json()
    assert pairs(accounts) == pairs(full_account_list())
    assert len(accounts) == 16
    # Same name, different type: kept apart by pay_type.
    assert {("SBI", "bank"), ("SBI", "credit_card")} <= pairs(accounts)


def test_new_household_gets_only_the_basics(solo: Api) -> None:
    assert pairs(solo.get("/api/v1/accounts").json()) == BASICS


def test_migration_adds_missing_accounts_without_touching_existing(
    admin: Api, solo: Api, db: Session
) -> None:
    # Make the admin's household look like it did before 0003: only the basics,
    # with an entry on HDFC and an edited Cash opening balance.
    add_tx(admin)
    db.execute(
        text(
            "DELETE FROM accounts WHERE (name, pay_type) NOT IN (('HDFC', 'bank'), "
            "('Yes Bank', 'credit_card'), ('Cash', 'cash'))"
        )
    )
    db.execute(text("UPDATE accounts SET opening_balance = 1234.50 WHERE name = 'Cash'"))
    db.commit()
    assert len(admin.get("/api/v1/accounts").json()) == 3

    config = alembic_config()
    command.downgrade(config, "0002")
    command.upgrade(config, "head")
    command.upgrade(config, "head")  # no-op the second time

    accounts = admin.get("/api/v1/accounts").json()
    assert pairs(accounts) == pairs(full_account_list())
    assert next(a for a in accounts if a["name"] == "Cash")["opening_balance"] == "1234.50"
    assert len(admin.get("/api/v1/transactions").json()["items"]) == 1
    # The solo household has no site admin, so it is left alone.
    assert pairs(solo.get("/api/v1/accounts").json()) == BASICS
