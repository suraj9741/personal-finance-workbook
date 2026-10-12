from datetime import UTC, datetime, timedelta

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models import Invite, UserSession
from tests.conftest import PASSWORD, Api, join_by_invite, new_client


def test_routes_need_a_session() -> None:
    client = new_client()
    assert client.get("/api/v1/auth/me").status_code == 401
    assert client.get("/api/v1/transactions").status_code == 401


def test_writes_need_csrf_header(admin: Api) -> None:
    response = admin.post("/api/v1/rules", json={"pattern": "x"}, headers={"X-Requested-With": ""})
    assert response.status_code == 403


def test_login_me_logout(admin: Api) -> None:
    me = admin.get("/api/v1/auth/me").json()
    assert me["email"] == "suraj@example.com"
    assert me["is_site_admin"] is True
    assert me["role"] == "owner"
    assert me["household_name"] == "Suraj's household"
    assert admin.post("/api/v1/auth/logout").status_code == 204
    assert admin.get("/api/v1/auth/me").status_code == 401


def test_wrong_password_and_rate_limit(admin: Api) -> None:
    client = new_client()
    for _ in range(5):
        response = client.post(
            "/api/v1/auth/login", json={"email": "suraj@example.com", "password": "nope"}
        )
        assert response.status_code == 401
    response = client.post(
        "/api/v1/auth/login", json={"email": "suraj@example.com", "password": PASSWORD}
    )
    assert response.status_code == 429


def test_expired_session_is_rejected(admin: Api, db: Session) -> None:
    db.execute(update(UserSession).values(expires_at=datetime.now(UTC) - timedelta(minutes=1)))
    db.commit()
    assert admin.get("/api/v1/auth/me").status_code == 401


def test_invite_is_single_use(admin: Api) -> None:
    token = admin.post("/api/v1/invites", json={}).json()["url"].rsplit("/", 1)[1]
    assert new_client().get(f"/api/v1/invites/{token}").status_code == 200
    body = {"email": "a@example.com", "display_name": "A", "password": PASSWORD}
    assert new_client().post(f"/api/v1/invites/{token}/accept", json=body).status_code == 201
    body["email"] = "b@example.com"
    assert new_client().post(f"/api/v1/invites/{token}/accept", json=body).status_code == 410
    assert new_client().get("/api/v1/invites/not-a-token").status_code == 404


def test_expired_invite(admin: Api, db: Session) -> None:
    token = admin.post("/api/v1/invites", json={}).json()["url"].rsplit("/", 1)[1]
    db.execute(update(Invite).values(expires_at=datetime.now(UTC) - timedelta(seconds=1)))
    db.commit()
    body = {"email": "a@example.com", "display_name": "A", "password": PASSWORD}
    assert new_client().post(f"/api/v1/invites/{token}/accept", json=body).status_code == 410


def test_short_password_rejected(admin: Api) -> None:
    token = admin.post("/api/v1/invites", json={}).json()["url"].rsplit("/", 1)[1]
    body = {"email": "a@example.com", "display_name": "A", "password": "short"}
    assert new_client().post(f"/api/v1/invites/{token}/accept", json=body).status_code == 422


def test_member_cannot_invite_or_use_admin(family_member: Api) -> None:
    assert family_member.post("/api/v1/invites", json={}).status_code == 403
    assert family_member.get("/api/v1/admin/users").status_code == 403


def test_reset_link_sets_new_password_and_revokes_sessions(admin: Api, family_member: Api) -> None:
    users = admin.get("/api/v1/admin/users").json()
    member_id = next(u["id"] for u in users if u["email"] == "pratiksha@example.com")
    link = admin.post(f"/api/v1/admin/users/{member_id}/reset-link").json()["url"]
    token = link.rsplit("/", 1)[1]
    response = new_client().post(
        f"/api/v1/auth/reset/{token}", json={"password": "a-brand-new-pass"}
    )
    assert response.status_code == 204
    assert family_member.get("/api/v1/auth/me").status_code == 401
    new_client().login("pratiksha@example.com", "a-brand-new-pass")
    again = new_client().post(f"/api/v1/auth/reset/{token}", json={"password": "another-new-pass"})
    assert again.status_code == 410


def test_deactivated_user_cannot_log_in(admin: Api, family_member: Api) -> None:
    members = admin.get("/api/v1/household/members").json()
    member_id = next(m["user_id"] for m in members if m["display_name"] == "Pratiksha")
    assert admin.delete(f"/api/v1/household/members/{member_id}").status_code == 204
    assert family_member.get("/api/v1/auth/me").status_code == 401
    response = new_client().post(
        "/api/v1/auth/login", json={"email": "pratiksha@example.com", "password": PASSWORD}
    )
    assert response.status_code == 401


def test_admin_invite_creates_new_household_with_template(admin: Api) -> None:
    solo = join_by_invite(admin, "x@example.com", "X", admin_new_household="X house")
    me = solo.get("/api/v1/auth/me").json()
    assert me["household_name"] == "X house"
    assert me["role"] == "owner"
