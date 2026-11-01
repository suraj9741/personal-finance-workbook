"""Accounts are private to whoever added them until they share them with the household."""

from tests.conftest import Api, account_id, join_by_invite


def accounts(client: Api) -> dict[str, dict]:  # type: ignore[type-arg]
    return {a["name"]: a for a in client.get("/api/v1/accounts").json()}


def test_seeded_accounts_are_the_admins_and_private(admin: Api) -> None:
    me = admin.get("/api/v1/auth/me").json()
    hdfc = accounts(admin)["HDFC"]
    assert hdfc["visibility"] == "private"
    assert hdfc["owner_user_id"] == me["id"]
    member = join_by_invite(admin, "work@example.com", "Work")
    assert accounts(member) == {}


def test_new_accounts_start_private(admin: Api) -> None:
    created = admin.post("/api/v1/accounts", json={"name": "Kotak", "pay_type": "bank"}).json()
    assert created["visibility"] == "private"


def test_owner_shares_and_unshares_an_account(admin: Api) -> None:
    member = join_by_invite(admin, "work@example.com", "Work")
    hdfc = account_id(admin, "HDFC", "bank")
    url = f"/api/v1/accounts/{hdfc}"
    assert admin.patch(url, json={"visibility": "shared"}).status_code == 200
    assert "HDFC" in accounts(member)
    # Shared means seen and used, not managed: the member can't change it.
    assert member.patch(url, json={"name": "Mine"}).status_code == 403
    assert member.patch(url, json={"visibility": "private"}).status_code == 403
    assert admin.patch(url, json={"visibility": "private"}).status_code == 200
    assert "HDFC" not in accounts(member)
    assert member.get(url).status_code == 404


def test_member_shares_their_own_account(admin: Api) -> None:
    member = join_by_invite(admin, "work@example.com", "Work")
    joint = member.post(
        "/api/v1/accounts", json={"name": "Joint", "pay_type": "bank", "visibility": "shared"}
    )
    assert joint.status_code == 201
    assert "Joint" in accounts(admin)
    # The household owner sees it but it is still the member's account.
    url = f"/api/v1/accounts/{joint.json()['id']}"
    assert admin.patch(url, json={"name": "Ours"}).status_code == 403
    assert admin.delete(url).status_code == 403
    assert member.patch(url, json={"visibility": "private"}).status_code == 200
    assert "Joint" not in accounts(admin)


def test_household_owner_cannot_see_members_private_accounts(admin: Api) -> None:
    member = join_by_invite(admin, "work@example.com", "Work")
    secret = member.post("/api/v1/accounts", json={"name": "Secret", "pay_type": "bank"}).json()
    assert "Secret" not in accounts(admin)
    assert admin.get(f"/api/v1/accounts/{secret['id']}").status_code == 404


def test_shared_account_is_view_only_for_others(admin: Api) -> None:
    member = join_by_invite(admin, "work@example.com", "Work")
    hdfc = account_id(admin, "HDFC", "bank")
    assert admin.patch(f"/api/v1/accounts/{hdfc}", json={"visibility": "shared"}).status_code == 200
    entry = {"date": "2026-10-05", "amount": "50", "account_id": hdfc}
    refused = member.post("/api/v1/transactions", json=entry)
    assert refused.status_code == 403
    assert refused.json()["detail"] == "You can only add entries on your own accounts"
    # Nor as the 'to' side of a transfer from their own account.
    own = member.post("/api/v1/accounts", json={"name": "Wallet", "pay_type": "bank"}).json()
    transfer = {**entry, "type": "transfer", "account_id": own["id"], "to_account_id": hdfc}
    assert member.post("/api/v1/transactions", json=transfer).status_code == 403
    # Nor by moving one of their own entries onto it.
    mine = member.post("/api/v1/transactions", json={**entry, "account_id": own["id"]}).json()
    moved = member.patch(f"/api/v1/transactions/{mine['id']}", json={"account_id": hdfc})
    assert moved.status_code == 403
    # The owner still writes on it.
    assert admin.post("/api/v1/transactions", json=entry).status_code == 201


def test_household_owner_can_fix_a_members_entry_on_the_members_account(admin: Api) -> None:
    member = join_by_invite(admin, "work@example.com", "Work")
    own = member.post(
        "/api/v1/accounts", json={"name": "Wallet", "pay_type": "bank", "visibility": "shared"}
    ).json()
    entry = {"date": "2026-10-05", "amount": "50", "account_id": own["id"]}
    tx = member.post("/api/v1/transactions", json=entry).json()
    fixed = admin.patch(f"/api/v1/transactions/{tx['id']}", json={"description": "Lunch"})
    assert fixed.status_code == 200
