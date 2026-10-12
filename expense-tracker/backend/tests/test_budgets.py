"""Default budgets carry forward to later months; past months never change."""

from alembic import command
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.routers.stats import month_key, this_month
from app.routers.transactions import month_range
from app.services import add_months
from tests.conftest import Api, add_tx, alembic_config, category_id

NOW = month_range(this_month())[0]


def month(offset: int) -> str:
    return month_key(add_months(NOW, offset))


def put(client: Api, offset: int, items: dict[str, str], only: bool = False) -> dict:  # type: ignore[type-arg]
    response = client.put(
        "/api/v1/budgets",
        json={
            "month": month(offset),
            "items": [
                {"category_id": k, "amount": v, "this_month_only": only} for k, v in items.items()
            ],
        },
    )
    assert response.status_code == 200, response.text
    return response.json()  # type: ignore[no-any-return]


def budget(client: Api, offset: int, category: str) -> str | None:
    items = client.get(f"/api/v1/budgets?month={month(offset)}").json()["items"]
    return next((i["amount"] for i in items if i["category_id"] == category), None)


def test_default_carries_forward_to_future_months(admin: Api) -> None:
    food = category_id(admin, "Everyday", "Food")
    put(admin, 0, {food: "3000"})
    assert budget(admin, 0, food) == "3000.00"
    assert budget(admin, 5, food) == "3000.00"
    later = admin.get(f"/api/v1/budgets?month={month(5)}").json()
    assert later["carries_forward"] is True
    assert later["items"][0]["set_in"] == month(0)
    assert later["items"][0]["this_month_only"] is False


def test_default_does_not_reach_back_to_earlier_months(admin: Api) -> None:
    food = category_id(admin, "Everyday", "Food")
    put(admin, 0, {food: "3000"})
    assert budget(admin, -1, food) is None


def test_changing_the_default_only_affects_that_month_on(admin: Api) -> None:
    food = category_id(admin, "Everyday", "Food")
    put(admin, 0, {food: "3000"})
    put(admin, 2, {food: "4000"})
    assert [budget(admin, m, food) for m in range(5)] == [
        "3000.00",
        "3000.00",
        "4000.00",
        "4000.00",
        "4000.00",
    ]


def test_editing_a_past_month_changes_only_that_month(admin: Api) -> None:
    food = category_id(admin, "Everyday", "Food")
    put(admin, -3, {food: "500"})
    put(admin, 0, {food: "3000"})
    body = put(admin, -2, {food: "800"})  # not marked this-month-only, still is
    assert body["carries_forward"] is False
    assert body["items"][0]["this_month_only"] is True
    assert [budget(admin, m, food) for m in range(-3, 2)] == [
        "500.00",
        "800.00",
        None,
        "3000.00",
        "3000.00",
    ]


def test_editing_last_months_default_keeps_this_months_value(admin: Api, db: Session) -> None:
    # A default set last month, when it was the current month.
    food = category_id(admin, "Everyday", "Food")
    db.execute(
        text(
            "INSERT INTO budgets (id, household_id, category_id, month, amount, carry_forward) "
            "SELECT gen_random_uuid(), household_id, id, :m, 2500, true FROM categories "
            "WHERE id = :c"
        ),
        {"m": add_months(NOW, -1), "c": food},
    )
    db.commit()
    put(admin, -1, {food: "100"})
    assert budget(admin, -1, food) == "100.00"
    assert budget(admin, 0, food) == "2500.00"
    assert budget(admin, 3, food) == "2500.00"


def test_one_month_override_keeps_the_default(admin: Api) -> None:
    food = category_id(admin, "Everyday", "Food")
    put(admin, 0, {food: "3000"})
    put(admin, 1, {food: "1000"}, only=True)
    put(admin, 0, {food: "2000"}, only=True)
    assert [budget(admin, m, food) for m in range(4)] == [
        "2000.00",
        "1000.00",
        "3000.00",
        "3000.00",
    ]
    # Setting the override back to the default removes it.
    put(admin, 1, {food: "3000"}, only=True)
    assert budget(admin, 1, food) == "3000.00"


def test_zero_stops_the_default_and_unlisted_categories_stay(admin: Api) -> None:
    food = category_id(admin, "Everyday", "Food")
    rent = category_id(admin, "Room", "Rent/mortgage")
    put(admin, 0, {food: "3000", rent: "8500"})
    put(admin, 2, {food: "0"})
    assert [budget(admin, m, food) for m in range(4)] == ["3000.00", "3000.00", None, None]
    assert budget(admin, 3, rent) == "8500.00"


def test_diff_for_expense_and_income(admin: Api) -> None:
    food = category_id(admin, "Everyday", "Food")
    rent = category_id(admin, "Room", "Rent/mortgage")
    salary = category_id(admin, "Wages", "Paycheck", "income")
    put(admin, 0, {food: "3000", rent: "8000", salary: "50000"})
    day = f"{month(0)}-05"
    add_tx(admin, date=day, amount="1200", category_id=food)
    add_tx(admin, date=day, amount="9000", category_id=rent)
    add_tx(admin, date=day, amount="52000", category_id=salary, type="income")
    stats = admin.get(f"/api/v1/stats/month?month={month(0)}").json()
    lines = {line["sub_name"]: line for line in stats["categories"]}
    assert (lines["Food"]["diff"], lines["Food"]["over_budget"]) == ("1800.00", False)
    assert (lines["Rent/mortgage"]["diff"], lines["Rent/mortgage"]["over_budget"]) == (
        "-1000.00",
        True,
    )
    assert lines["Paycheck"]["kind"] == "income"
    assert (lines["Paycheck"]["diff"], lines["Paycheck"]["over_budget"]) == ("2000.00", False)
    assert stats["budget_total"] == "11000.00"


def test_transfers_have_no_budget(admin: Api) -> None:
    move = category_id(admin, "Self Transfer", "Bank to Bank", "transfer")
    response = admin.put(
        "/api/v1/budgets",
        json={"month": month(0), "items": [{"category_id": move, "amount": "1"}]},
    )
    assert response.status_code == 422


def test_migration_keeps_past_months_as_they_were(admin: Api, db: Session) -> None:
    food = category_id(admin, "Everyday", "Food")
    config = alembic_config()
    command.downgrade(config, "0004")
    for offset, amount in ((-2, 1000), (0, 3000)):
        db.execute(
            text(
                "INSERT INTO budgets (id, household_id, category_id, month, amount) "
                "SELECT gen_random_uuid(), household_id, id, :m, :a FROM categories "
                "WHERE id = :c"
            ),
            {"m": add_months(NOW, offset), "a": amount, "c": food},
        )
    db.commit()
    command.upgrade(config, "head")
    # Before: -2 had 1000, -1 had nothing, this month had 3000.
    assert [budget(admin, m, food) for m in range(-2, 3)] == [
        "1000.00",
        None,
        "3000.00",
        "3000.00",
        "3000.00",
    ]
