"""Only the person who added an entry, or the household owner, can change or delete it."""

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models import Transaction
from tests.conftest import Api, add_tx, category_id, join_by_invite


def tx_url(tx: dict) -> str:  # type: ignore[type-arg]
    return f"/api/v1/transactions/{tx['id']}"


def test_member_cannot_change_owners_entry(admin: Api, family_member: Api) -> None:
    tx = add_tx(admin, description="Rent", amount="500")
    seen = family_member.get(tx_url(tx))
    assert seen.status_code == 200
    assert seen.json()["can_edit"] is False
    assert family_member.patch(tx_url(tx), json={"amount": "1"}).status_code == 403
    assert family_member.delete(tx_url(tx)).status_code == 403
    assert admin.get(tx_url(tx)).json()["amount"] == "500.00"


def test_member_cannot_change_another_members_entry(admin: Api, family_member: Api) -> None:
    other = join_by_invite(admin, "work@example.com", "Work")
    tx = add_tx(family_member, description="Groceries")
    assert other.get(tx_url(tx)).json()["can_edit"] is False
    assert other.patch(tx_url(tx), json={"description": "x"}).status_code == 403
    assert other.delete(tx_url(tx)).status_code == 403


def test_creator_and_household_owner_can_change_it(admin: Api, family_member: Api) -> None:
    tx = add_tx(family_member, description="Groceries")
    assert family_member.get(tx_url(tx)).json()["can_edit"] is True
    assert family_member.patch(tx_url(tx), json={"description": "Veg"}).status_code == 200
    assert admin.get(tx_url(tx)).json()["can_edit"] is True
    assert admin.patch(tx_url(tx), json={"description": "Fruit"}).status_code == 200
    assert admin.delete(tx_url(tx)).status_code == 204


def test_list_marks_which_rows_you_can_edit(admin: Api, family_member: Api) -> None:
    add_tx(admin, description="Owner's")
    add_tx(family_member, description="Member's")
    items = family_member.get("/api/v1/transactions?month=2026-10").json()["items"]
    assert {t["description"]: t["can_edit"] for t in items} == {
        "Owner's": False,
        "Member's": True,
    }
    items = admin.get("/api/v1/transactions?month=2026-10").json()["items"]
    assert all(t["can_edit"] for t in items)


def test_entries_with_no_creator_are_the_owners_to_fix(
    admin: Api, family_member: Api, db: Session
) -> None:
    tx = add_tx(admin, description="Imported")
    db.execute(update(Transaction).values(created_by=None))
    db.commit()
    assert admin.patch(tx_url(tx), json={"description": "Ok"}).status_code == 200
    assert family_member.patch(tx_url(tx), json={"description": "No"}).status_code == 403


def test_applying_rules_as_a_member_skips_other_peoples_entries(
    admin: Api, family_member: Api
) -> None:
    food = category_id(admin, "Everyday", "Food")
    owners = add_tx(admin, description="swiggy lunch")
    members = add_tx(family_member, description="swiggy dinner")
    rule = {"pattern": "swiggy", "category_id": food}
    assert admin.post("/api/v1/rules", json=rule).status_code == 201
    assert family_member.post("/api/v1/rules/apply").json() == {"updated": 1}
    assert admin.get(tx_url(members)).json()["category_id"] == food
    assert admin.get(tx_url(owners)).json()["category_id"] is None
