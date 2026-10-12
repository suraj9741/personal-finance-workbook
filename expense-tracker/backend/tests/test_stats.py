from datetime import date, timedelta

from tests.conftest import Api, account_id, add_tx, category_id


def test_empty_month(admin: Api) -> None:
    stats = admin.get("/api/v1/stats/month?month=2026-10").json()
    assert stats["income"] == "0"
    assert stats["savings_rate"] is None
    assert stats["categories"] == []


def test_month_numbers(admin: Api) -> None:
    hdfc, card = account_id(admin, "HDFC"), account_id(admin, "Yes Bank")
    add_tx(
        admin,
        type="income",
        amount="100000",
        category_id=category_id(admin, "Wages", "Paycheck", "income"),
    )
    add_tx(admin, amount="20000", category_id=category_id(admin, "Room", "Rent/mortgage"))
    add_tx(admin, amount="5000", category_id=None)  # uncategorized still counts as spend
    add_tx(admin, amount="2000", category_id=category_id(admin, "Savings", "PPF"))
    add_tx(
        admin, amount="3000", category_id=category_id(admin, "Friend", "lent"), counterparty="Neel"
    )
    add_tx(
        admin,
        type="transfer",
        amount="40000",
        account_id=hdfc,
        to_account_id=card,
        category_id=category_id(admin, "Self Transfer", "Bank to Credit", "transfer"),
    )
    add_tx(
        admin,
        amount="99999",
        date="2025-10-05",
        category_id=category_id(admin, "Room", "Rent/mortgage"),
    )

    stats = admin.get("/api/v1/stats/month?month=2026-10").json()
    assert stats["income"] == "100000.00"
    assert stats["spend"] == "25000.00"  # transfer, saving and lending excluded; last year excluded
    assert stats["saved"] == "75000.00"
    assert stats["savings_rate"] == 0.75
    assert stats["invested"] == "2000.00"
    assert stats["lent"] == "3000.00"


def test_budget_vs_actual_and_copy(admin: Api) -> None:
    rent = category_id(admin, "Room", "Rent/mortgage")
    food = category_id(admin, "Everyday", "Food")
    put = admin.put(
        "/api/v1/budgets",
        json={
            "month": "2026-10",
            "items": [
                {"category_id": rent, "amount": "8500"},
                {"category_id": food, "amount": "3000"},
            ],
        },
    )
    assert put.status_code == 200
    add_tx(admin, amount="9000", category_id=rent)
    lines = {
        line["sub_name"]: line
        for line in admin.get("/api/v1/stats/month?month=2026-10").json()["categories"]
    }
    assert lines["Rent/mortgage"]["over_budget"] is True
    assert lines["Food"]["actual"] == "0"
    salary = category_id(admin, "Wages", "Paycheck", "income")
    bad = admin.put(
        "/api/v1/budgets",
        json={"month": "2026-10", "items": [{"category_id": salary, "amount": "1"}]},
    )
    assert bad.status_code == 422

    copied = admin.post(
        "/api/v1/budgets/copy", json={"from_month": "2026-10", "to_month": "2026-11"}
    )
    assert copied.status_code == 201
    assert len(copied.json()["items"]) == 2
    again = admin.post(
        "/api/v1/budgets/copy", json={"from_month": "2026-10", "to_month": "2026-11"}
    )
    assert again.status_code == 409


def test_member_cannot_set_budgets(family_member: Api) -> None:
    rent = category_id(family_member, "Room", "Rent/mortgage")
    response = family_member.put(
        "/api/v1/budgets",
        json={"month": "2026-10", "items": [{"category_id": rent, "amount": "1"}]},
    )
    assert response.status_code == 403


def test_trend(admin: Api) -> None:
    salary = category_id(admin, "Wages", "Paycheck", "income")
    add_tx(admin, type="income", amount="1000", date="2026-09-01", category_id=salary)
    add_tx(admin, amount="400", date="2026-09-02", category_id=None)
    points = admin.get("/api/v1/stats/trend?months=3&end_month=2026-10").json()
    assert [p["month"] for p in points] == ["2026-08", "2026-09", "2026-10"]
    assert points[1]["saved"] == "600.00"
    assert points[1]["savings_rate"] == 0.6


def test_attention(admin: Api) -> None:
    rent = category_id(admin, "Room", "Rent/mortgage")
    admin.put(
        "/api/v1/budgets",
        json={"month": "2026-10", "items": [{"category_id": rent, "amount": "100"}]},
    )
    add_tx(admin, amount="500", category_id=rent)
    add_tx(admin, amount="50", category_id=None)
    add_tx(admin, amount="9000", category_id=category_id(admin, "Debt", "Credit cards"))
    old = (date.today() - timedelta(days=90)).isoformat()
    add_tx(
        admin,
        amount="3000",
        date=old,
        counterparty="Neel",
        category_id=category_id(admin, "Friend", "lent"),
    )
    add_tx(
        admin,
        type="income",
        amount="1000",
        date=old,
        counterparty="Neel",
        category_id=category_id(admin, "Friend", "Refund", "income"),
    )

    att = admin.get("/api/v1/stats/attention?month=2026-10").json()
    assert att["uncategorized"] == 1
    assert [line["sub_name"] for line in att["over_budget"]] == ["Rent/mortgage"]
    assert att["no_income"] is True
    assert att["credit_card_category_used"] == 1
    assert att["old_loans"] == [
        {"counterparty": "Neel", "outstanding": "2000.00", "last_lent_on": old}
    ]
