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


def test_categories_come_a_to_z_with_other_last(admin: Api) -> None:
    for parent, sub in [("aardvark", "zebra"), ("aardvark", "Other"), ("aardvark", "apple")]:
        body = {"kind": "expense", "parent_name": parent, "sub_name": sub}
        assert admin.post("/api/v1/categories", json=body).status_code == 201
    listed = admin.get("/api/v1/categories").json()

    # A group added later sits in its A-Z place (lower case too), not at the end.
    expense = [c for c in listed if c["kind"] == "expense"]
    groups = list(dict.fromkeys(c["parent_name"] for c in expense))
    assert groups[0] == "aardvark"
    assert groups[-1] == "Other"
    assert groups[:-1] == sorted(groups[:-1], key=str.lower)
    assert [c["sub_name"] for c in expense if c["parent_name"] == "aardvark"] == [
        "apple",
        "zebra",
        "Other",
    ]
    wages = [c["sub_name"] for c in listed if c["kind"] == "income" and c["parent_name"] == "Wages"]
    assert wages == ["Bonus", "Commission", "Paycheck", "W Other"]
    assert list(dict.fromkeys(c["kind"] for c in listed)) == ["expense", "income", "transfer"]


def test_owner_renames_a_whole_group(admin: Api, family_member: Api) -> None:
    tuition = category_id(admin, "Gotu", "Tuition")
    add_tx(admin, category_id=tuition)
    body = {"parent_name": "Gotu", "new_name": "Gautam"}
    assert family_member.put("/api/v1/categories/group-name", json=body).status_code == 403

    renamed = admin.put("/api/v1/categories/group-name", json=body)
    assert renamed.status_code == 200
    listed = admin.get("/api/v1/categories").json()
    assert not [c for c in listed if c["parent_name"] == "Gotu"]
    gautam = [c for c in listed if c["parent_name"] == "Gautam"]
    # Expense and income move together, keep their Family tick, and entries follow.
    assert {c["kind"] for c in gautam} == {"expense", "income"}
    assert all(c["is_family"] for c in gautam)
    assert category_id(admin, "Gautam", "Tuition") == tuition
    entries = admin.get("/api/v1/transactions?category_group=Gautam&month=2026-10").json()
    assert entries["total"] == 1


def test_group_rename_refuses_a_name_in_use(admin: Api) -> None:
    taken = admin.put(
        "/api/v1/categories/group-name", json={"parent_name": "Gotu", "new_name": "mom"}
    )
    assert taken.status_code == 409
    assert taken.json()["detail"] == "There's already a group called Mom"
    missing = admin.put(
        "/api/v1/categories/group-name", json={"parent_name": "Nope", "new_name": "X"}
    )
    assert missing.status_code == 404
    # Only the capitals change: fine.
    caps = admin.put(
        "/api/v1/categories/group-name", json={"parent_name": "Everyday", "new_name": "EVERYDAY"}
    )
    assert caps.status_code == 200
