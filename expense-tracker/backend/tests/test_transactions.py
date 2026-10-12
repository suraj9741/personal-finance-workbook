from tests.conftest import Api, account_id, add_tx, category_id


def test_crud_and_validation(admin: Api) -> None:
    food = category_id(admin, "Everyday", "Food")
    tx = add_tx(admin, description="Lunch", category_id=food, amount="250.50")
    assert tx["amount"] == "250.50"
    assert tx["created_by_name"] == "Suraj"
    tid = tx["id"]
    assert admin.get(f"/api/v1/transactions/{tid}").status_code == 200
    patched = admin.patch(f"/api/v1/transactions/{tid}", json={"amount": "300"})
    assert patched.json()["amount"] == "300.00"
    assert admin.patch(f"/api/v1/transactions/{tid}", json={"amount": "-1"}).status_code == 422
    assert admin.patch(f"/api/v1/transactions/{tid}", json={"bogus": 1}).status_code == 422
    assert admin.delete(f"/api/v1/transactions/{tid}").status_code == 204
    assert admin.get(f"/api/v1/transactions/{tid}").status_code == 404
    assert admin.get("/api/v1/transactions/not-a-uuid").status_code == 422


def test_category_kind_must_match_type(admin: Api) -> None:
    salary = category_id(admin, "Wages", "Paycheck", "income")
    body = {
        "date": "2026-10-01",
        "amount": "10",
        "account_id": account_id(admin, "HDFC"),
        "type": "expense",
        "category_id": salary,
    }
    assert admin.post("/api/v1/transactions", json=body).status_code == 422


def test_transfer_needs_distinct_to_account(admin: Api) -> None:
    hdfc, card = account_id(admin, "HDFC"), account_id(admin, "Yes Bank")
    base = {"date": "2026-10-01", "amount": "5000", "account_id": hdfc, "type": "transfer"}
    assert admin.post("/api/v1/transactions", json=base).status_code == 422
    assert (
        admin.post("/api/v1/transactions", json={**base, "to_account_id": hdfc}).status_code == 422
    )
    ok = admin.post("/api/v1/transactions", json={**base, "to_account_id": card})
    assert ok.status_code == 201
    expense = {"date": "2026-10-01", "amount": "5", "account_id": hdfc, "to_account_id": card}
    assert admin.post("/api/v1/transactions", json=expense).status_code == 422


def test_filters_and_search(admin: Api) -> None:
    food = category_id(admin, "Everyday", "Food")
    add_tx(admin, description="Swiggy dinner", category_id=food, date="2026-10-03")
    add_tx(admin, description="Petrol", date="2026-09-30", category_id=None)
    add_tx(
        admin,
        description="Salary",
        type="income",
        date="2026-10-01",
        category_id=category_id(admin, "Wages", "Paycheck", "income"),
    )
    assert admin.get("/api/v1/transactions?month=2026-10").json()["total"] == 2
    assert admin.get("/api/v1/transactions?type=income").json()["total"] == 1
    assert admin.get(f"/api/v1/transactions?category_id={food}").json()["total"] == 1
    assert admin.get("/api/v1/transactions?q=swig").json()["total"] == 1
    assert admin.get("/api/v1/transactions?uncategorized=true").json()["total"] == 1
    assert admin.get("/api/v1/transactions?month=2026-13").status_code == 422


def test_rule_fills_category_on_quick_add(admin: Api) -> None:
    food = category_id(admin, "Everyday", "Food")
    assert (
        admin.post("/api/v1/rules", json={"pattern": "swiggy", "category_id": food}).status_code
        == 201
    )
    tx = add_tx(admin, description="SWIGGY order 123")
    assert tx["category_id"] == food
    explicit_none = add_tx(admin, description="Swiggy again", category_id=None)
    assert explicit_none["category_id"] is None
    no_match = add_tx(admin, description="Something else")
    assert no_match["category_id"] is None


def test_rule_priority(admin: Api) -> None:
    food = category_id(admin, "Everyday", "Food")
    groceries = category_id(admin, "Everyday", "Groceries")
    admin.post("/api/v1/rules", json={"pattern": "mart", "category_id": food, "priority": 50})
    admin.post("/api/v1/rules", json={"pattern": "dmart", "category_id": groceries, "priority": 10})
    assert add_tx(admin, description="DMart")["category_id"] == groceries


def test_make_rule_from_row_and_apply(admin: Api) -> None:
    fuel = category_id(admin, "Transportation", "Fuel")
    first = add_tx(admin, description="HP Petrol", category_id=fuel)
    later = add_tx(admin, description="hp petrol", category_id=None)
    response = admin.post(f"/api/v1/transactions/{first['id']}/make-rule")
    assert response.status_code == 201
    assert response.json()["pattern"] == "hp petrol"
    assert admin.post(f"/api/v1/transactions/{first['id']}/make-rule").status_code == 409
    assert admin.post("/api/v1/rules/apply").json() == {"updated": 1}
    assert admin.get(f"/api/v1/transactions/{later['id']}").json()["category_id"] == fuel


def test_suggest_returns_latest_per_description(admin: Api) -> None:
    food = category_id(admin, "Everyday", "Food")
    add_tx(admin, description="Zomato", amount="200", date="2026-10-01")
    add_tx(admin, description="Zomato", amount="350", date="2026-10-04", category_id=food)
    add_tx(admin, description="Zoo trip", amount="90", date="2026-10-02")
    items = admin.get("/api/v1/transactions/suggest?q=zo").json()
    assert [i["description"] for i in items] == ["Zomato", "Zoo trip"]
    assert items[0]["amount"] == "350.00"
    assert items[0]["category_id"] == food


def test_accounts(admin: Api, family_member: Api) -> None:
    created = admin.post("/api/v1/accounts", json={"name": "SBI", "pay_type": "bank"})
    assert created.status_code == 201
    dup = admin.post("/api/v1/accounts", json={"name": "SBI", "pay_type": "bank"})
    assert dup.status_code == 409
    shared_by_member = family_member.post(
        "/api/v1/accounts", json={"name": "Joint", "pay_type": "bank"}
    )
    assert shared_by_member.status_code == 403
    hdfc = account_id(admin, "HDFC")
    add_tx(admin)
    assert admin.delete(f"/api/v1/accounts/{hdfc}").status_code == 409
