import importlib.util
import json
import os
from pathlib import Path

import pytest
import yaml
from alembic import command
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import seed
from tests.conftest import Api, account_id, add_tx, alembic_config, category_id, join_by_invite

BACKEND = Path(__file__).resolve().parents[1]
CONFIG = Path(os.environ["SEED_CONFIG"])
DEFAULTS = Path(
    os.environ.get(
        "DEFAULTS_GS", BACKEND.parent.parent / "finance-sheet" / "src" / "config" / "Defaults.gs"
    )
)
FAMILY = {"Gotu", "Mom", "Baba", "Pratiksha", "Farm"}


def config() -> seed.SeedConfig:
    return seed.load(CONFIG)


def pairs(accounts: list[dict[str, str]]) -> set[tuple[str, str]]:
    return {(a["name"], a["pay_type"]) for a in accounts}


def config_accounts() -> set[tuple[str, str]]:
    return {(a.name, t) for t, a in seed.flat_accounts(config().admin_household.accounts)}


def test_config_matches_the_finance_sheet_starter_list() -> None:
    cfg = config()
    categories = seed.flat_categories(cfg.admin_household.categories)
    assert len(categories) == 154
    # The 16 sheet accounts plus Coin, added in the app.
    assert len(config_accounts()) == 17
    assert {("SBI", "bank"), ("SBI", "credit_card")} <= config_accounts()
    groups = {(kind, parent, sub): group for kind, parent, sub, group in categories}
    assert groups[("expense", "Savings", "PPF")] == "saving"
    assert groups[("expense", "Friend", "lent")] == "lent"
    assert groups[("income", "Friend", "Refund")] == "repaid"
    assert groups[("expense", "Everyday", "Food")] == "spend"
    assert groups[("income", "Wages", "Paycheck")] == "earned"
    assert groups[("transfer", "Self Transfer", "Bank to Credit")] == "transfer"
    template = seed.flat_categories(cfg.new_household.categories)
    assert len(template) == 101
    assert not {parent for _, parent, _, _ in template} & FAMILY
    assert set(template) <= set(categories)


@pytest.mark.skipif(not DEFAULTS.exists(), reason="finance-sheet source not present")
def test_config_from_sheet_script_writes_a_valid_config() -> None:
    spec = importlib.util.spec_from_file_location(
        "gen", BACKEND / "scripts" / "config_from_sheet.py"
    )
    assert spec and spec.loader
    gen = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(gen)
    rendered = seed.SeedConfig.model_validate(yaml.safe_load(gen.render(DEFAULTS.read_text())))
    assert seed.flat_categories(rendered.admin_household.categories) == seed.flat_categories(
        config().admin_household.categories
    )


def test_bad_config_is_rejected(tmp_path: Path) -> None:
    bad = tmp_path / "seed.yaml"
    bad.write_text("admin_household:\n  accounts:\n    wallet: [Cash]\n")
    with pytest.raises(ValueError):
        seed.load(bad)


def test_admin_household_gets_everything_in_the_config(admin: Api) -> None:
    assert pairs(admin.get("/api/v1/accounts").json()) == config_accounts()
    categories = admin.get("/api/v1/categories").json()
    assert len(categories) == 154
    assert {c["parent_name"] for c in categories} >= FAMILY


def test_new_household_gets_template_categories_but_no_accounts(solo: Api) -> None:
    assert solo.get("/api/v1/accounts").json() == []
    categories = solo.get("/api/v1/categories").json()
    assert len(categories) == 101
    assert not {c["parent_name"] for c in categories} & FAMILY


def test_family_member_shares_the_admin_household(family_member: Api) -> None:
    assert pairs(family_member.get("/api/v1/accounts").json()) == config_accounts()


def test_template_from_admin_page_is_copied_to_new_households(admin: Api) -> None:
    added = admin.post(
        "/api/v1/admin/category-template",
        json={"kind": "expense", "parent_name": "Kids", "sub_name": "School"},
    )
    assert added.status_code == 201
    newcomer = join_by_invite(admin, "new@example.com", "New", admin_new_household="New house")
    cats = newcomer.get("/api/v1/categories").json()
    assert len(cats) == 102
    assert ("Kids", "School") in {(c["parent_name"], c["sub_name"]) for c in cats}


def test_admin_copies_own_categories_to_the_template(admin: Api, family_member: Api) -> None:
    food = category_id(admin, "Everyday", "Food")
    assert admin.patch(f"/api/v1/categories/{food}", json={"is_active": False}).status_code == 200
    mine = admin.get("/api/v1/categories").json()
    family = {"Gotu", "Mom", "Baba", "Pratiksha", "Farm"}
    expected = {
        (c["kind"], c["parent_name"], c["sub_name"], c["stats_group"])
        for c in mine
        if not c["is_family"]
    }
    assert (
        family_member.put("/api/v1/admin/category-template/from-my-categories").status_code == 403
    )

    copied = admin.put("/api/v1/admin/category-template/from-my-categories")
    assert copied.status_code == 200
    rows = {(t["kind"], t["parent_name"], t["sub_name"], t["stats_group"]) for t in copied.json()}
    # Active categories only, and the groups ticked Family stay with the admin.
    assert rows == expected
    assert not {t["parent_name"] for t in copied.json()} & family
    assert ("expense", "Everyday", "Food", "spend") not in rows

    newcomer = join_by_invite(admin, "new@example.com", "New", admin_new_household="New house")
    got = {
        (c["kind"], c["parent_name"], c["sub_name"], c["stats_group"])
        for c in newcomer.get("/api/v1/categories").json()
    }
    assert got == expected


def test_copy_leaves_out_a_family_group_whole(admin: Api, db: Session) -> None:
    added = admin.post(
        "/api/v1/categories",
        json={"kind": "expense", "parent_name": "Baba", "sub_name": "Medical test"},
    )
    # Unticked, as categories added before this fix were.
    db.execute(
        text("UPDATE categories SET is_family = false WHERE id = :c"), {"c": added.json()["id"]}
    )
    db.commit()
    first = admin.put("/api/v1/admin/category-template/from-my-categories").json()
    assert "Baba" not in {t["parent_name"] for t in first}
    again = admin.put("/api/v1/admin/category-template/from-my-categories").json()
    assert len(again) == len(first)


def test_template_changes_do_not_touch_existing_households(solo: Api, db: Session) -> None:
    food = category_id(solo, "Everyday", "Food")
    assert solo.delete(f"/api/v1/categories/{food}").status_code == 204
    cfg = config()
    cfg.new_household.categories["expense"]["Kids"] = ["School"]
    assert seed.apply(db, cfg)["template_categories"] == 1
    left = solo.get("/api/v1/categories").json()
    assert len(left) == 100
    names = {(c["parent_name"], c["sub_name"]) for c in left}
    assert ("Kids", "School") not in names
    assert ("Everyday", "Food") not in names


def test_seed_is_add_only_and_keeps_app_edits(admin: Api, db: Session) -> None:
    hdfc = account_id(admin, "HDFC", "bank")
    add_tx(admin)
    admin.patch(f"/api/v1/accounts/{hdfc}", json={"name": "HDFC Salary"})
    zerodha = account_id(admin, "Zerodha")
    assert admin.delete(f"/api/v1/accounts/{zerodha}").status_code == 204
    food = category_id(admin, "Everyday", "Food")
    admin.patch(f"/api/v1/categories/{food}", json={"stats_group": "saving"})

    assert seed.apply(db, config()) == {
        "settings": 0,
        "template_categories": 0,
        "accounts": 0,
        "categories": 0,
    }
    names = {a["name"] for a in admin.get("/api/v1/accounts").json()}
    assert "HDFC Salary" in names
    assert "Zerodha" not in names  # deleted in the app, not brought back
    assert (
        next(c for c in admin.get("/api/v1/categories").json() if c["id"] == food)["stats_group"]
        == "saving"
    )

    # Something new in the config is added on the next deploy.
    cfg = config()
    cfg.admin_household.accounts["bank"].append("Kotak")
    assert seed.apply(db, cfg)["accounts"] == 1
    assert "Kotak" in {a["name"] for a in admin.get("/api/v1/accounts").json()}


def test_existing_household_gets_only_the_missing_accounts(admin: Api, db: Session) -> None:
    # A household from before the seed existed: just the three original accounts.
    db.execute(text("DELETE FROM seed_log"))
    db.execute(
        text(
            "DELETE FROM accounts WHERE (name, pay_type) NOT IN "
            "(('HDFC', 'bank'), ('Yes Bank', 'credit_card'), ('Cash', 'cash'))"
        )
    )
    db.execute(text("UPDATE accounts SET opening_balance = 1234.50 WHERE name = 'Cash'"))
    db.commit()
    add_tx(admin)

    assert seed.apply(db, config())["accounts"] == 14
    accounts = admin.get("/api/v1/accounts").json()
    assert pairs(accounts) == config_accounts()
    assert next(a for a in accounts if a["name"] == "Cash")["opening_balance"] == "1234.50"
    assert admin.get("/api/v1/transactions").json()["total"] == 1


def test_migration_0004_removes_only_untouched_template_rows(db: Session) -> None:
    config_ = alembic_config()
    command.downgrade(config_, "0002")
    seeded = next(
        r
        for r in json.loads((BACKEND / "alembic" / "data" / "0002_categories.json").read_text())
        if (r["parent_name"], r["sub_name"]) == ("Everyday", "Food")
    )
    db.execute(text("DELETE FROM category_templates"))
    db.execute(
        text(
            "INSERT INTO category_templates (id, kind, parent_name, sub_name, stats_group, "
            "sort_order) VALUES (gen_random_uuid(), 'expense', 'Everyday', 'Food', 'spend', :o), "
            "(gen_random_uuid(), 'expense', 'Everyday', 'Groceries', 'spend', 999)"
        ),
        {"o": seeded["sort_order"]},
    )
    db.commit()
    command.upgrade(config_, "head")
    left = db.execute(text("SELECT sub_name FROM category_templates")).scalars().all()
    assert left == ["Groceries"]
