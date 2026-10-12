from tests.conftest import Api, account_id, add_tx, category_id


def test_other_household_sees_nothing(admin: Api, solo: Api) -> None:
    food = category_id(admin, "Everyday", "Food")
    tx = add_tx(admin, description="Secret", category_id=food, amount="999")
    rule = admin.post("/api/v1/rules", json={"pattern": "secret", "category_id": food}).json()
    hdfc = account_id(admin, "HDFC")

    assert solo.get(f"/api/v1/transactions/{tx['id']}").status_code == 404
    assert solo.patch(f"/api/v1/transactions/{tx['id']}", json={"amount": "1"}).status_code == 404
    assert solo.delete(f"/api/v1/transactions/{tx['id']}").status_code == 404
    assert solo.post(f"/api/v1/transactions/{tx['id']}/make-rule").status_code == 404
    assert solo.get("/api/v1/transactions").json()["total"] == 0
    assert solo.get("/api/v1/transactions/suggest?q=sec").json() == []
    assert solo.patch(f"/api/v1/rules/{rule['id']}", json={"priority": 1}).status_code == 404
    assert solo.delete(f"/api/v1/rules/{rule['id']}").status_code == 404
    assert solo.patch(f"/api/v1/accounts/{hdfc}", json={"name": "x"}).status_code == 404
    assert solo.patch(f"/api/v1/categories/{food}", json={"sub_name": "x"}).status_code in {
        403,
        404,
    }
    # Can't post into someone else's account or category.
    body = {"date": "2026-10-01", "amount": "1", "account_id": hdfc}
    assert solo.post("/api/v1/transactions", json=body).status_code == 404
    own = {
        "date": "2026-10-01",
        "amount": "1",
        "account_id": account_id(solo, "HDFC"),
        "category_id": food,
    }
    assert solo.post("/api/v1/transactions", json=own).status_code == 404

    stats = solo.get("/api/v1/stats/month?month=2026-10").json()
    assert stats["spend"] == "0"
    budget = solo.put(
        "/api/v1/budgets",
        json={"month": "2026-10", "items": [{"category_id": food, "amount": "10"}]},
    )
    assert budget.status_code == 404


def test_private_account_hidden_from_other_members(admin: Api, family_member: Api) -> None:
    private = family_member.post(
        "/api/v1/accounts",
        json={"name": "My card", "pay_type": "credit_card", "visibility": "private"},
    )
    assert private.status_code == 201
    pid = private.json()["id"]
    food = category_id(family_member, "Everyday", "Food")
    tx = add_tx(family_member, account_id=pid, amount="400", category_id=food)
    shared_tx = add_tx(family_member, amount="100", category_id=food)

    assert pid not in {a["id"] for a in admin.get("/api/v1/accounts").json()}
    assert admin.get(f"/api/v1/transactions/{tx['id']}").status_code == 404
    assert admin.patch(f"/api/v1/accounts/{pid}", json={"name": "x"}).status_code == 404
    assert admin.get("/api/v1/stats/month?month=2026-10").json()["spend"] == "100.00"
    assert (
        admin.get(f"/api/v1/transactions/{shared_tx['id']}").json()["created_by_name"]
        == "Pratiksha"
    )

    mine = family_member.get("/api/v1/stats/month?month=2026-10&scope=me").json()
    assert mine["spend"] == "500.00"
    household_view = family_member.get("/api/v1/stats/month?month=2026-10").json()
    assert household_view["spend"] == "500.00"


def test_just_me_excludes_other_members_entries(admin: Api, family_member: Api) -> None:
    food = category_id(admin, "Everyday", "Food")
    add_tx(admin, amount="1000", category_id=food)
    add_tx(family_member, amount="200", category_id=food)
    assert admin.get("/api/v1/stats/month?month=2026-10").json()["spend"] == "1200.00"
    assert admin.get("/api/v1/stats/month?month=2026-10&scope=me").json()["spend"] == "1000.00"
    assert admin.get("/api/v1/transactions?scope=me").json()["total"] == 1
