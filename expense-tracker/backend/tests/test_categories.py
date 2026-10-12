from tests.conftest import Api, add_tx, category_id


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
