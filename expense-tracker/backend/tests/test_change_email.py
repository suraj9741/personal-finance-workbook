from tests.conftest import PASSWORD, Api, join_by_invite, new_client

EMAIL = "/api/v1/auth/email"


def me(client: Api) -> dict:  # type: ignore[type-arg]
    return client.get("/api/v1/auth/me").json()


def test_you_change_your_own_email_with_your_password(admin: Api) -> None:
    member = join_by_invite(admin, "ravi@example.com", "Ravi")
    changed = member.post(
        EMAIL, json={"new_email": " Ravi.J@Example.com ", "current_password": PASSWORD}
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["email"] == "ravi.j@example.com"
    # Still signed in here; the new email logs in, the old one doesn't.
    assert me(member)["email"] == "ravi.j@example.com"
    new_client().login("ravi.j@example.com")
    old = new_client().post(
        "/api/v1/auth/login", json={"email": "ravi@example.com", "password": PASSWORD}
    )
    assert old.status_code == 401


def test_wrong_password_is_refused(admin: Api) -> None:
    wrong = admin.post(EMAIL, json={"new_email": "new@example.com", "current_password": "nope"})
    assert wrong.status_code == 400
    assert me(admin)["email"] == "suraj@example.com"


def test_an_email_another_login_uses_is_refused(admin: Api) -> None:
    join_by_invite(admin, "ravi@example.com", "Ravi")
    taken = admin.post(EMAIL, json={"new_email": "RAVI@example.com", "current_password": PASSWORD})
    assert taken.status_code == 409
    assert taken.json()["detail"] == "Another login already uses that email"


def test_household_owner_cannot_change_a_members_email(admin: Api) -> None:
    owner = join_by_invite(admin, "asha@example.com", "Asha", admin_new_household="Asha's house")
    member = join_by_invite(owner, "kid@example.com", "Kid")
    kid = me(member)["id"]
    # Not a site admin: the Admin endpoints are closed to them.
    assert (
        owner.patch(f"/api/v1/admin/users/{kid}", json={"email": "x@example.com"}).status_code
        == 403
    )
    assert me(member)["email"] == "kid@example.com"


def test_site_admin_changes_anyones_email(admin: Api) -> None:
    member = join_by_invite(admin, "ravi@example.com", "Ravi")
    ravi = me(member)["id"]
    changed = admin.patch(f"/api/v1/admin/users/{ravi}", json={"email": "Ravi2@example.com"})
    assert changed.status_code == 200, changed.text
    assert changed.json()["email"] == "ravi2@example.com"
    new_client().login("ravi2@example.com")
    taken = admin.patch(f"/api/v1/admin/users/{ravi}", json={"email": "suraj@example.com"})
    assert taken.status_code == 409
