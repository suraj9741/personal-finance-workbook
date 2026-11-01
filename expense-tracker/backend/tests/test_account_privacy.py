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
