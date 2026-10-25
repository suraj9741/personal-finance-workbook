"""The year view: twelve months counted like the month view, months before the first entry
marked untracked, and family groups ticked from the seed or in Settings."""

from datetime import date

from sqlalchemy import text
from sqlalchemy.orm import Session

from app import seed
from app.routers.stats import month_status
from tests.conftest import Api, add_tx, category_id
from tests.test_seed import config

YEAR = "/api/v1/stats/year?year=2025"


def set_budget(db: Session, category: str, month: date, amount: str) -> None:
    db.execute(
        text(
            "INSERT INTO budgets (id, household_id, category_id, month, amount, carry_forward) "
            "SELECT gen_random_uuid(), household_id, id, :m, :a, true FROM categories "
            "WHERE id = :c"
        ),
        {"m": month, "a": amount, "c": category},
    )
    db.commit()


def test_empty_year(admin: Api) -> None:
    year = admin.get(YEAR).json()
    assert year["first_entry"] is None
    assert [m["status"] for m in year["months"]] == ["untracked"] * 12
    assert year["spend"] == "0"
    assert year["savings_rate"] is None
    assert year["groups"] == []
    assert year["budget_to_date"] is None


def test_month_status() -> None:
    now = date(2026, 10, 24)
    first = date(2026, 10, 18)
    assert month_status(date(2026, 9, 1), date(2026, 10, 1), first, now) == "untracked"
    assert month_status(date(2026, 10, 1), date(2026, 11, 1), first, now) == "partial"
    assert month_status(date(2026, 11, 1), date(2026, 12, 1), first, now) == "future"
    assert month_status(date(2026, 10, 1), date(2026, 11, 1), date(2026, 10, 1), now) == ("tracked")
    assert month_status(date(2026, 10, 1), date(2026, 11, 1), None, now) == "untracked"


def test_year_adds_up_its_months(admin: Api, db: Session) -> None:
    rent = category_id(admin, "Room", "Rent/mortgage")
    food = category_id(admin, "Everyday", "Food")
    pay = category_id(admin, "Wages", "Paycheck", "income")
    card_bill = category_id(admin, "Debt", "Credit cards")
    add_tx(admin, date="2025-10-05", type="income", amount="100000", category_id=pay)
    add_tx(admin, date="2025-10-06", amount="8500", category_id=rent)
    add_tx(admin, date="2025-11-02", amount="12000", category_id=food, description="Party")
    add_tx(admin, date="2025-11-03", amount="500", category_id=None)
    add_tx(admin, date="2025-12-01", amount="3000", category_id=card_bill)
    add_tx(
        admin, date="2025-12-02", amount="2000", category_id=category_id(admin, "Savings", "PPF")
    )
    add_tx(admin, date="2024-12-31", amount="99999", category_id=rent)  # last year
    set_budget(db, rent, date(2025, 10, 1), "9000")

    year = admin.get(YEAR).json()
    assert year["first_entry"] == "2024-12-31"
    statuses = [m["status"] for m in year["months"]]
    assert statuses == ["tracked"] * 12  # the first entry is in 2024

    assert year["income"] == "100000.00"
    assert year["spend"] == "24000.00"  # rent + food + uncategorized + card bill; PPF is saving
    assert year["saved"] == "76000.00"
    assert year["invested"] == "2000.00"
    for field in ("income", "spend"):
        assert sum(float(m[field]) for m in year["months"]) == float(year[field])
    # The month view and the year view agree.
    month = admin.get("/api/v1/stats/month?month=2025-11").json()
    assert year["months"][10]["spend"] == month["spend"]

    groups = {g["parent_name"]: g for g in year["groups"]}
    assert [g["parent_name"] for g in year["groups"]][:2] == ["Everyday", "Room"]
    assert groups["Everyday"]["months"][10] == "12000.00"
    assert groups[None]["total"] == "500.00"  # no category

    # Rent's budget carries forward from October, and only months so far count toward it.
    assert [m["budget"] for m in year["months"]][8:] == [None, "9000.00", "9000.00", "9000.00"]
    assert year["budget_to_date"] == "27000.00"
    row = next(r for r in year["budget_grid"] if r["parent_name"] == "Room")
    assert row["months"][9] == {"budget": "9000.00", "actual": "8500.00"}
    assert row["months"][0]["budget"] is None

    assert [e["amount"] for e in year["biggest"]] == ["12000.00", "8500.00", "3000.00", "500.00"]
    assert year["biggest"][0]["description"] == "Party"
    assert year["biggest"][0]["account_name"] == "HDFC"
    assert (year["big_count"], year["big_total"]) == (1, "12000.00")
    assert (year["card_bills_count"], year["card_bills_total"]) == (1, "3000.00")


def test_months_before_the_first_entry_are_untracked(admin: Api) -> None:
    add_tx(admin, date="2025-10-18", amount="300", category_id=None)
    statuses = [m["status"] for m in admin.get(YEAR).json()["months"]]
    assert statuses == ["untracked"] * 9 + ["partial", "tracked", "tracked"]


def test_family_groups_given_and_received(admin: Api) -> None:
    tuition = category_id(admin, "Gotu", "Tuition")
    back = category_id(admin, "Gotu", "Bank", "income")
    add_tx(admin, date="2025-07-02", amount="25000", category_id=tuition)
    add_tx(admin, date="2025-08-02", type="income", amount="4000", category_id=back)
    year = admin.get(YEAR).json()
    family = {f["parent_name"]: f for f in year["family"]}
    assert set(family) == {"Gotu", "Mom", "Baba", "Pratiksha", "Farm"}
    assert family["Gotu"] == {"parent_name": "Gotu", "given": "25000.00", "received": "4000.00"}
    assert year["family"][0]["parent_name"] == "Gotu"
    # Family money stays income: it is counted in the year's income.
    assert year["income"] == "4000.00"


def test_family_tick_covers_the_whole_group(admin: Api, family_member: Api) -> None:
    put = admin.put("/api/v1/categories/family", json={"parent_name": "Gotu", "is_family": False})
    assert put.status_code == 200
    assert {(c["kind"], c["is_family"]) for c in put.json()} == {
        ("expense", False),
        ("income", False),
    }
    assert "Gotu" not in {f["parent_name"] for f in admin.get(YEAR).json()["family"]}
    ticked = admin.put("/api/v1/categories/family", json={"parent_name": "Room", "is_family": True})
    assert all(c["is_family"] for c in ticked.json())
    missing = admin.put(
        "/api/v1/categories/family", json={"parent_name": "Nope", "is_family": True}
    )
    assert missing.status_code == 404
    member = family_member.put(
        "/api/v1/categories/family", json={"parent_name": "Mom", "is_family": False}
    )
    assert member.status_code == 403


def test_a_category_added_to_a_family_group_counts_as_family(admin: Api, db: Session) -> None:
    added = admin.post(
        "/api/v1/categories", json={"kind": "expense", "parent_name": "Gotu", "sub_name": "Savings"}
    )
    assert added.json()["is_family"] is True
    other = admin.post(
        "/api/v1/categories", json={"kind": "expense", "parent_name": "Room", "sub_name": "Paint"}
    )
    assert other.json()["is_family"] is False
    # One added before this fix kept an unticked flag: the group's tick still covers it.
    db.execute(
        text("UPDATE categories SET is_family = false WHERE id = :c"), {"c": added.json()["id"]}
    )
    db.commit()
    add_tx(admin, date="2025-03-03", amount="1500", category_id=added.json()["id"])
    family = {f["parent_name"]: f for f in admin.get(YEAR).json()["family"]}
    assert family["Gotu"]["given"] == "1500.00"


def test_seed_ticks_family_groups_once(admin: Api, db: Session) -> None:
    admin.put("/api/v1/categories/family", json={"parent_name": "Mom", "is_family": False})
    seed.apply(db, config())
    db.commit()
    mom = [c for c in admin.get("/api/v1/categories").json() if c["parent_name"] == "Mom"]
    assert mom and not any(c["is_family"] for c in mom)  # unticked in the app, stays unticked


def test_just_me_counts_only_my_entries(admin: Api, family_member: Api) -> None:
    add_tx(admin, date="2025-05-05", amount="1000", category_id=None)
    add_tx(family_member, date="2025-05-06", amount="700", category_id=None)
    assert admin.get(YEAR).json()["spend"] == "1700.00"
    assert admin.get(YEAR + "&scope=me").json()["spend"] == "1000.00"
