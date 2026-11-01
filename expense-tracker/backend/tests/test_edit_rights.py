"""Only the person who added an entry can change or delete it."""

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models import Transaction
from tests.conftest import Api, add_tx, category_id


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


def test_owner_cannot_change_members_entry(admin: Api, family_member: Api) -> None:
    tx = add_tx(family_member, description="Groceries")
    assert admin.get(tx_url(tx)).json()["can_edit"] is False
    assert admin.patch(tx_url(tx), json={"description": "x"}).status_code == 403
    assert admin.delete(tx_url(tx)).status_code == 403
    # The person who added it still can.
    assert family_member.patch(tx_url(tx), json={"description": "Veg"}).status_code == 200
    assert family_member.delete(tx_url(tx)).status_code == 204


def test_list_marks_which_rows_you_can_edit(admin: Api, family_member: Api) -> None:
    add_tx(admin, description="Mine")
    add_tx(family_member, description="Hers")
    items = admin.get("/api/v1/transactions?month=2026-10").json()["items"]
    assert {t["description"]: t["can_edit"] for t in items} == {"Mine": True, "Hers": False}


def test_owner_can_fix_entries_of_a_deactivated_member(admin: Api, family_member: Api) -> None:
    tx = add_tx(family_member, description="Old")
    member_id = family_member.get("/api/v1/auth/me").json()["id"]
    assert admin.delete(f"/api/v1/household/members/{member_id}").status_code == 204
    assert admin.get(tx_url(tx)).json()["can_edit"] is True
    assert admin.patch(tx_url(tx), json={"description": "Fixed"}).status_code == 200


def test_owner_can_fix_entries_with_no_creator(admin: Api, family_member: Api, db: Session) -> None:
    tx = add_tx(admin, description="Imported")
    db.execute(update(Transaction).values(created_by=None))
    db.commit()
    assert admin.patch(tx_url(tx), json={"description": "Ok"}).status_code == 200
    assert family_member.patch(tx_url(tx), json={"description": "No"}).status_code == 403


def test_applying_rules_skips_other_peoples_entries(admin: Api, family_member: Api) -> None:
    food = category_id(admin, "Everyday", "Food")
    mine = add_tx(admin, description="swiggy lunch")
    hers = add_tx(family_member, description="swiggy dinner")
    rule = {"pattern": "swiggy", "category_id": food}
    assert admin.post("/api/v1/rules", json=rule).status_code == 201
    assert admin.post("/api/v1/rules/apply").json() == {"updated": 1}
    assert admin.get(tx_url(mine)).json()["category_id"] == food
    assert admin.get(tx_url(hers)).json()["category_id"] is None
