from tests.conftest import Api, join_by_invite

SBI = {"name": "SBI", "pay_type": "bank"}


def names(client: Api, scope: str) -> list[tuple[str, str]]:
    rows = client.get(f"/api/v1/stats/overview?scope={scope}").json()["accounts"]
    return sorted((r["account"]["name"], r["account"]["owner_user_id"]) for r in rows)


def test_two_members_each_have_an_sbi(admin: Api) -> None:
    # The admin's seeded accounts include a bank called SBI.
    member = join_by_invite(admin, "ravi@example.com", "Ravi")
    created = member.post("/api/v1/accounts", json=SBI)
    assert created.status_code == 201, created.text
    assert created.json()["owner_user_id"] == member.get("/api/v1/auth/me").json()["id"]


def test_your_own_repeat_is_refused_without_naming_anyone_else(admin: Api) -> None:
    member = join_by_invite(admin, "ravi@example.com", "Ravi")
    assert member.post("/api/v1/accounts", json=SBI).status_code == 201
    again = member.post("/api/v1/accounts", json=SBI)
    assert again.status_code == 409
    assert again.json()["detail"] == "You already have an account with that name and type"


def test_a_members_private_account_does_not_block_or_leak(admin: Api) -> None:
    member = join_by_invite(admin, "ravi@example.com", "Ravi")
    wallet = {"name": "Wallet", "pay_type": "cash"}
    assert member.post("/api/v1/accounts", json=wallet).status_code == 201
    assert admin.post("/api/v1/accounts", json=wallet).status_code == 201


def test_rename_onto_your_own_name_is_refused(admin: Api) -> None:
    member = join_by_invite(admin, "ravi@example.com", "Ravi")
    assert member.post("/api/v1/accounts", json=SBI).status_code == 201
    other = member.post("/api/v1/accounts", json={"name": "SBI 2", "pay_type": "bank"}).json()
    renamed = member.patch(f"/api/v1/accounts/{other['id']}", json={"name": "SBI"})
    assert renamed.status_code == 409


def test_overview_just_me_lists_only_your_accounts(admin: Api) -> None:
    member = join_by_invite(admin, "ravi@example.com", "Ravi")
    ravi = member.get("/api/v1/auth/me").json()["id"]
    sbi = member.post("/api/v1/accounts", json={**SBI, "visibility": "shared"}).json()
    assert sbi["visibility"] == "shared"
    household = names(admin, "household")
    assert ("SBI", ravi) in household
    me = names(admin, "me")
    assert ("SBI", ravi) not in me
    assert len(me) == len(household) - 1
    assert names(member, "me") == [("SBI", ravi)]
