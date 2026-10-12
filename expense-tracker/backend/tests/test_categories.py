import json
import os
import re
from ast import literal_eval
from pathlib import Path

import pytest

from app.services import full_category_list
from tests.conftest import Api, add_tx, category_id

# The Apps Script seed list. In the test container it is mounted and named by DEFAULTS_GS.
_REPO = Path(__file__).resolve().parents[1].parent.parent
DEFAULTS = Path(os.environ.get("DEFAULTS_GS", _REPO / "src" / "config" / "Defaults.gs"))
FAMILY = {"Gotu", "Mom", "Baba", "Pratiksha", "Farm"}


def defaults_pairs() -> set[tuple[str, str, str]]:
    text = DEFAULTS.read_text()
    pairs = set()
    for key in ("EXPENSE", "INCOME", "TRANSFER"):
        block = re.search(key + r":\s*(\{.*?\n  \})", text, re.S)
        assert block
        for parent, subs in literal_eval(block.group(1)).items():
            pairs |= {(key.lower(), parent, sub) for sub in subs}
    return pairs


@pytest.mark.skipif(not DEFAULTS.exists(), reason="Apps Script source not present")
def test_category_json_matches_defaults_gs() -> None:
    json_pairs = {(r["kind"], r["parent_name"], r["sub_name"]) for r in full_category_list()}
    assert json_pairs == defaults_pairs()


def test_admin_household_has_every_category(admin: Api) -> None:
    categories = admin.get("/api/v1/categories").json()
    assert len(categories) == len(full_category_list())
    assert {c["parent_name"] for c in categories} >= FAMILY


def test_new_household_gets_template_without_family_categories(solo: Api) -> None:
    categories = solo.get("/api/v1/categories").json()
    parents = {c["parent_name"] for c in categories}
    assert not parents & FAMILY
    assert "Everyday" in parents
    family_rows = sum(1 for r in full_category_list() if r["family_only"])
    assert len(categories) == len(full_category_list()) - family_rows


def test_stats_groups() -> None:
    groups = {
        (r["parent_name"], r["sub_name"], r["kind"]): r["stats_group"] for r in full_category_list()
    }
    assert groups[("Savings", "PPF", "expense")] == "saving"
    assert groups[("Friend", "lent", "expense")] == "lent"
    assert groups[("Friend", "Refund", "income")] == "repaid"
    assert groups[("Everyday", "Food", "expense")] == "spend"
    assert groups[("Self Transfer", "Bank to Credit", "transfer")] == "transfer"


def test_owner_manages_categories(admin: Api) -> None:
    created = admin.post(
        "/api/v1/categories", json={"kind": "expense", "parent_name": "Hobby", "sub_name": "Music"}
    )
    assert created.status_code == 201
    assert created.json()["stats_group"] == "spend"
    dup = admin.post(
        "/api/v1/categories", json={"kind": "expense", "parent_name": "Hobby", "sub_name": "Music"}
    )
    assert dup.status_code == 409
    cid = created.json()["id"]
    renamed = admin.patch(f"/api/v1/categories/{cid}", json={"sub_name": "Guitar"})
    assert renamed.json()["sub_name"] == "Guitar"
    assert admin.delete(f"/api/v1/categories/{cid}").status_code == 204


def test_category_in_use_cannot_be_deleted(admin: Api) -> None:
    cid = category_id(admin, "Everyday", "Food")
    add_tx(admin, category_id=cid)
    assert admin.delete(f"/api/v1/categories/{cid}").status_code == 409
    assert admin.patch(f"/api/v1/categories/{cid}", json={"is_active": False}).status_code == 200
    active = {c["id"] for c in admin.get("/api/v1/categories").json()}
    assert cid not in active


def test_member_cannot_change_categories(family_member: Api) -> None:
    response = family_member.post(
        "/api/v1/categories", json={"kind": "expense", "parent_name": "A", "sub_name": "B"}
    )
    assert response.status_code == 403


def test_admin_template_crud(admin: Api) -> None:
    before = len(admin.get("/api/v1/admin/category-template").json())
    row = admin.post(
        "/api/v1/admin/category-template",
        json={"kind": "expense", "parent_name": "Kids", "sub_name": "School"},
    )
    assert row.status_code == 201
    assert len(admin.get("/api/v1/admin/category-template").json()) == before + 1
    assert admin.delete(f"/api/v1/admin/category-template/{row.json()['id']}").status_code == 204


def test_categories_json_is_valid() -> None:
    raw = (Path(__file__).resolve().parents[1] / "app" / "data" / "categories.json").read_text()
    assert isinstance(json.loads(raw), list)
