"""Account balances, card outstanding, broker figures and the overview totals."""

from decimal import Decimal

import pytest
from alembic import command
from sqlalchemy import text

from app.balances import last_statement, next_due_date, statement_cycle
from app.db import get_engine
from tests.conftest import Api, account_id, add_tx, alembic_config, category_id

API = "/api/v1"


def summary(client: Api, account: str, month: str = "2026-10") -> dict:  # type: ignore[type-arg]
    response = client.get(f"{API}/accounts/{account}/summary?month={month}")
    assert response.status_code == 200, response.text
    return response.json()  # type: ignore[no-any-return]


def overview(client: Api, month: str = "2026-10") -> dict:  # type: ignore[type-arg]
    response = client.get(f"{API}/stats/overview?month={month}")
    assert response.status_code == 200, response.text
    return response.json()  # type: ignore[no-any-return]


def money(value: object) -> Decimal:
    return Decimal(str(value))


def new_account(client: Api, **fields: object) -> str:
    response = client.post(f"{API}/accounts", json=fields)
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


# ---- accounts -------------------------------------------------------------------------


def test_create_edit_rename_keeps_transactions(admin: Api) -> None:
    hdfc = account_id(admin, "HDFC", "bank")
    tx = add_tx(admin, account_id=hdfc, amount="500")
    renamed = admin.patch(
        f"{API}/accounts/{hdfc}",
        json={"name": "HDFC Savings", "institution": "HDFC Bank", "description": "Salary account"},
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "HDFC Savings"
    assert admin.get(f"{API}/transactions/{tx['id']}").json()["account_id"] == hdfc
    assert admin.get(f"{API}/transactions?account_id={hdfc}").json()["total"] == 1
    assert money(summary(admin, hdfc)["balance"]) == Decimal("-500")
    # Clearing an optional field with null works; required fields ignore null.
    cleared = admin.patch(f"{API}/accounts/{hdfc}", json={"description": None, "name": None})
    assert cleared.json()["description"] is None
    assert cleared.json()["name"] == "HDFC Savings"


def test_same_institution_bank_and_card_stay_separate(admin: Api) -> None:
    bank, card = account_id(admin, "SBI", "bank"), account_id(admin, "SBI", "credit_card")
    assert bank != card
    add_tx(admin, account_id=card, amount="1000")
    assert money(summary(admin, bank)["balance"]) == 0
    assert money(summary(admin, card)["outstanding"]) == Decimal("1000")


def test_type_specific_fields_are_validated(admin: Api) -> None:
    bad = admin.post(
        f"{API}/accounts", json={"name": "Kotak", "pay_type": "bank", "credit_limit": "5000"}
    )
    assert bad.status_code == 422
    bad = admin.post(
        f"{API}/accounts", json={"name": "X", "pay_type": "credit_card", "current_value": "1"}
    )
    assert bad.status_code == 422
    assert (
        admin.post(f"{API}/accounts", json={"name": "Y", "pay_type": "savings"}).status_code == 422
    )
    assert (
        admin.post(
            f"{API}/accounts", json={"name": "Z", "pay_type": "credit_card", "due_day": 32}
        ).status_code
        == 422
    )
    card = new_account(
        admin, name="Kotak CC", pay_type="credit_card", credit_limit="50000", due_day=5
    )
    # The type can't be changed, and broker fields can't be added to a card later.
    assert admin.patch(f"{API}/accounts/{card}", json={"pay_type": "bank"}).status_code == 422
    assert admin.patch(f"{API}/accounts/{card}", json={"opening_invested": "5"}).status_code == 422
    assert admin.get(f"{API}/accounts/{card}").json()["credit_limit"] == "50000.00"


def test_deactivated_account_keeps_history(admin: Api) -> None:
    hdfc = account_id(admin, "HDFC", "bank")
    add_tx(admin, account_id=hdfc, amount="300", date="2026-09-10")
    assert admin.patch(f"{API}/accounts/{hdfc}", json={"is_active": False}).status_code == 200
    assert hdfc not in [a["id"] for a in admin.get(f"{API}/accounts").json()]
    assert admin.get(f"{API}/transactions?account_id={hdfc}").json()["total"] == 1
    data = overview(admin, "2026-09")
    row = next(r for r in data["accounts"] if r["account"]["id"] == hdfc)
    assert row["account"]["is_active"] is False
    assert money(row["month_expenses"]) == Decimal("300")
    # Still in the month's activity, but not in the active bank balance.
    assert money(data["totals"]["month_expenses"]) == Decimal("300")
    assert money(data["totals"]["bank_balance"]) == 0


# ---- banks ----------------------------------------------------------------------------


def test_bank_balance_from_opening_income_and_expenses(admin: Api) -> None:
    bank = new_account(
        admin, name="Kotak", pay_type="bank", opening_balance="50000", opening_date="2026-09-01"
    )
    salary = category_id(admin, "Wages", "Paycheck", "income")
    add_tx(admin, account_id=bank, type="income", amount="10000", category_id=salary)
    add_tx(admin, account_id=bank, amount="18000")
    # Before the opening date: already inside the opening balance, so not counted again.
    add_tx(admin, account_id=bank, amount="999", date="2026-08-20")
    figures = summary(admin, bank)
    assert money(figures["balance"]) == Decimal("42000")
    assert money(figures["month_income"]) == Decimal("10000")
    assert money(figures["month_expenses"]) == Decimal("18000")
    # The opening balance is not income in any month.
    assert money(summary(admin, bank, "2026-09")["month_income"]) == 0
    # The month changes the month figures only, never the balance.
    assert money(summary(admin, bank, "2026-08")["balance"]) == Decimal("42000")


def test_bank_month_start_end_and_balance_up_to_today(
    admin: Api, monkeypatch: pytest.MonkeyPatch
) -> None:
    from datetime import date

    monkeypatch.setattr("app.routers.stats.today", lambda: date(2026, 10, 24))
    bank = new_account(admin, name="Kotak", pay_type="bank", opening_balance="1000")
    sbi = account_id(admin, "SBI", "bank")
    salary = category_id(admin, "Wages", "Paycheck", "income")
    add_tx(admin, account_id=bank, date="2026-09-15", amount="100")  # before October
    add_tx(
        admin, account_id=bank, date="2026-10-01", type="income", amount="5000", category_id=salary
    )
    add_tx(admin, account_id=bank, date="2026-10-10", amount="700")
    add_tx(
        admin, account_id=sbi, date="2026-10-12", type="transfer", to_account_id=bank, amount="300"
    )
    add_tx(admin, account_id=bank, date="2026-10-31", amount="2000")  # rent, entered ahead
    add_tx(admin, account_id=bank, date="2026-11-03", amount="50")  # next month
    f = summary(admin, bank)
    assert money(f["balance_month_start"]) == Decimal("900")
    assert money(f["balance_month_end"]) == Decimal("3500")  # 900 + 5000 - 700 + 300 - 2000
    # Today's balance waits for the rent's day.
    assert money(f["balance"]) == Decimal("5500")
    # The row adds up: start + income - expenses + transfers in - out = end.
    flows = (
        money(f["month_income"])
        - money(f["month_expenses"])
        + money(f["month_transfers_in"])
        - money(f["month_transfers_out"])
    )
    assert money(f["balance_month_start"]) + flows == money(f["balance_month_end"])
    # November starts where October ends.
    assert money(summary(admin, bank, "2026-11")["balance_month_start"]) == Decimal("3500")
    view = overview(admin)
    banks = [r for r in view["accounts"] if r["account"]["pay_type"] in ("bank", "cash")]
    for key in ("balance_month_start", "balance_month_end"):
        assert money(view["totals"][f"bank_{key}"]) == sum(money(r[key]) for r in banks)
    # The transfer only moved money between two banks: SBI is 300 down, so the total is 3200.
    assert money(view["totals"]["bank_balance_month_end"]) == Decimal("3200")
    # Cards have no start and end balance.
    card = account_id(admin, "HDFC CC", "credit_card")
    assert summary(admin, card)["balance_month_end"] is None


def test_bank_to_bank_transfer_is_not_income_or_expense(admin: Api) -> None:
    hdfc, sbi = account_id(admin, "HDFC", "bank"), account_id(admin, "SBI", "bank")
    add_tx(admin, account_id=hdfc, type="transfer", to_account_id=sbi, amount="5000")
    assert money(summary(admin, hdfc)["balance"]) == Decimal("-5000")
    assert money(summary(admin, sbi)["balance"]) == Decimal("5000")
    totals = overview(admin)["totals"]
    assert money(totals["month_income"]) == 0
    assert money(totals["month_expenses"]) == 0
    assert money(totals["bank_balance"]) == 0
    stats = admin.get(f"{API}/stats/month?month=2026-10").json()
    assert (money(stats["income"]), money(stats["spend"])) == (0, 0)


def test_edit_and_delete_recalculate(admin: Api) -> None:
    hdfc, sbi = account_id(admin, "HDFC", "bank"), account_id(admin, "SBI", "bank")
    tx = add_tx(admin, account_id=hdfc, amount="700")
    admin.patch(f"{API}/transactions/{tx['id']}", json={"amount": "200"})
    assert money(summary(admin, hdfc)["balance"]) == Decimal("-200")
    admin.patch(f"{API}/transactions/{tx['id']}", json={"account_id": sbi})
    assert money(summary(admin, hdfc)["balance"]) == 0
    assert money(summary(admin, sbi)["balance"]) == Decimal("-200")
    admin.delete(f"{API}/transactions/{tx['id']}")
    assert money(summary(admin, sbi)["balance"]) == 0


# ---- credit cards ---------------------------------------------------------------------


def test_card_purchase_payment_and_available_credit(admin: Api) -> None:
    hdfc = account_id(admin, "HDFC", "bank")
    card = new_account(
        admin, name="ICICI Amazon", pay_type="credit_card", credit_limit="100000", due_day=31
    )
    food = category_id(admin, "Everyday", "Food")
    add_tx(admin, account_id=card, amount="25000", category_id=food)
    figures = summary(admin, card)
    assert money(figures["outstanding"]) == Decimal("25000")
    assert money(figures["available_credit"]) == Decimal("75000")
    assert figures["balance"] is None
    # Paying the bill: a transfer from the bank. Not a second expense.
    bill = category_id(admin, "Self Transfer", "Bank to Credit", "transfer")
    add_tx(
        admin,
        account_id=hdfc,
        type="transfer",
        to_account_id=card,
        amount="10000",
        category_id=bill,
    )
    figures = summary(admin, card)
    assert money(figures["outstanding"]) == Decimal("15000")
    assert money(figures["available_credit"]) == Decimal("85000")
    assert money(figures["month_expenses"]) == Decimal("25000")
    assert money(figures["month_transfers_in"]) == Decimal("10000")
    assert money(summary(admin, hdfc)["balance"]) == Decimal("-10000")
    totals = overview(admin)["totals"]
    assert money(totals["month_expenses"]) == Decimal("25000")
    assert money(totals["card_outstanding"]) == Decimal("15000")
    assert money(totals["net_cash"]) == Decimal("-25000")  # -10000 bank - 15000 owed
    stats = admin.get(f"{API}/stats/month?month=2026-10").json()
    assert money(stats["spend"]) == Decimal("25000")


def test_available_credit_never_negative_and_no_limit_is_null(admin: Api) -> None:
    card = new_account(admin, name="Tiny CC", pay_type="credit_card", credit_limit="1000")
    add_tx(admin, account_id=card, amount="1500")
    assert money(summary(admin, card)["available_credit"]) == 0
    no_limit = account_id(admin, "HDFC CC", "credit_card")
    assert summary(admin, no_limit)["available_credit"] is None


def test_card_opening_balance_is_amount_owed(admin: Api) -> None:
    card = new_account(
        admin, name="Old CC", pay_type="credit_card", opening_balance="4000", credit_limit="10000"
    )
    add_tx(admin, account_id=card, amount="1000")
    figures = summary(admin, card)
    assert money(figures["outstanding"]) == Decimal("5000")
    assert money(figures["available_credit"]) == Decimal("5000")


def test_refund_reduces_spend_and_card_outstanding(admin: Api) -> None:
    card = account_id(admin, "HDFC CC", "credit_card")
    shopping = category_id(admin, "Everyday", "Shopping")
    add_tx(admin, account_id=card, amount="3000", category_id=shopping)
    refund = add_tx(admin, account_id=card, type="refund", amount="1200", category_id=shopping)
    figures = summary(admin, card)
    assert money(figures["outstanding"]) == Decimal("1800")
    assert money(figures["month_expenses"]) == Decimal("1800")
    assert money(figures["month_income"]) == 0
    stats = admin.get(f"{API}/stats/month?month=2026-10").json()
    assert money(stats["spend"]) == Decimal("1800")
    assert money(stats["income"]) == 0
    line = next(c for c in stats["categories"] if c["category_id"] == shopping)
    assert money(line["actual"]) == Decimal("1800")
    # A refund takes an expense category, not an income one.
    salary = category_id(admin, "Wages", "Paycheck", "income")
    bad = admin.patch(f"{API}/transactions/{refund['id']}", json={"category_id": salary})
    assert bad.status_code == 422
    # Reversing the refund puts the outstanding back.
    admin.delete(f"{API}/transactions/{refund['id']}")
    assert money(summary(admin, card)["outstanding"]) == Decimal("3000")


def test_next_due_date() -> None:
    from datetime import date

    assert next_due_date(None, date(2026, 10, 14)) is None
    assert next_due_date(20, date(2026, 10, 14)) == date(2026, 10, 20)
    assert next_due_date(5, date(2026, 10, 14)) == date(2026, 11, 5)
    assert next_due_date(31, date(2026, 11, 3)) == date(2026, 11, 30)
    assert next_due_date(14, date(2026, 12, 15)) == date(2027, 1, 14)


def test_statement_cycle_and_last_statement() -> None:
    from datetime import date

    assert statement_cycle(20, date(2026, 10, 1)) == (date(2026, 9, 21), date(2026, 10, 20))
    # Day 31 falls on the month's last day; the cycle starts the day after the previous one.
    assert statement_cycle(31, date(2026, 3, 1)) == (date(2026, 3, 1), date(2026, 3, 31))
    assert statement_cycle(30, date(2026, 3, 1)) == (date(2026, 3, 1), date(2026, 3, 30))
    assert statement_cycle(5, date(2027, 1, 1)) == (date(2026, 12, 6), date(2027, 1, 5))
    assert last_statement(20, date(2026, 10, 24)) == date(2026, 10, 20)
    # On the statement day the bill is still open.
    assert last_statement(20, date(2026, 10, 20)) == date(2026, 9, 20)
    assert last_statement(31, date(2026, 3, 5)) == date(2026, 2, 28)


def test_card_statement_follows_statement_day_and_posted_date(
    admin: Api, monkeypatch: pytest.MonkeyPatch
) -> None:
    from datetime import date

    monkeypatch.setattr("app.routers.stats.today", lambda: date(2026, 10, 24))
    hdfc = account_id(admin, "HDFC", "bank")
    card = new_account(admin, name="Amazon Pay CC", pay_type="credit_card", statement_day=20)
    add_tx(admin, account_id=card, date="2026-09-20", amount="1000")  # September's bill
    add_tx(admin, account_id=card, date="2026-09-21", amount="200")
    add_tx(admin, account_id=card, date="2026-10-20", amount="300")  # the statement day counts
    add_tx(admin, account_id=card, date="2026-10-05", type="refund", amount="50")
    add_tx(admin, account_id=card, date="2026-10-01", type="income", amount="25")  # cashback
    # Bought on the 18th, posted on the 21st: November's bill, not October's.
    late = add_tx(admin, account_id=card, date="2026-10-18", posted_on="2026-10-21", amount="400")
    assert late["posted_on"] == "2026-10-21"
    add_tx(admin, account_id=card, date="2026-10-22", amount="70")
    for day, amount in (("2026-10-10", "900"), ("2026-10-22", "500")):
        add_tx(admin, account_id=hdfc, date=day, type="transfer", to_account_id=card, amount=amount)
    f = summary(admin, card)
    assert (f["statement_start"], f["statement_end"]) == ("2026-09-21", "2026-10-20")
    assert money(f["statement_purchases"]) == Decimal("450")  # 200 + 300 - 50 refund
    assert money(f["statement_refunds"]) == Decimal("50")
    assert money(f["statement_payments"]) == Decimal("900")
    assert money(f["statement_credits"]) == Decimal("25")
    assert f["unbilled_since"] == "2026-10-21"
    assert money(f["unbilled"]) == Decimal("470")  # 400 posted late + 70
    # Month figures and the Dashboard stay on the calendar month and the purchase date.
    assert money(f["month_expenses"]) == Decimal("720")  # 300 + 400 + 70 - 50, by purchase date
    row = next(r for r in overview(admin)["accounts"] if r["account"]["id"] == card)
    assert money(row["statement_purchases"]) == Decimal("450")
    # September's bill, seen from the September view.
    assert money(summary(admin, card, "2026-09")["statement_purchases"]) == Decimal("1000")
    # No statement day: no statement figures.
    plain = account_id(admin, "HDFC CC", "credit_card")
    assert summary(admin, plain)["statement_purchases"] is None
    assert summary(admin, hdfc)["statement_start"] is None


def test_posted_date_only_on_card_purchases(admin: Api) -> None:
    hdfc = account_id(admin, "HDFC", "bank")
    card = account_id(admin, "HDFC CC", "credit_card")
    url = f"{API}/transactions"
    base = {"date": "2026-10-18", "amount": "100", "posted_on": "2026-10-21"}
    assert admin.post(url, json={**base, "account_id": hdfc}).status_code == 422
    income = {**base, "account_id": card, "type": "income"}
    assert admin.post(url, json=income).status_code == 422
    early = {**base, "account_id": card, "posted_on": "2026-10-17"}
    assert admin.post(url, json=early).status_code == 422
    tx = add_tx(admin, **{**base, "account_id": card})
    # Moving the purchase date past the posted date drops the posted date.
    moved = admin.patch(f"{url}/{tx['id']}", json={"date": "2026-10-25"}).json()
    assert moved["posted_on"] is None
    # So does moving the entry off the card.
    admin.patch(f"{url}/{tx['id']}", json={"date": "2026-10-18", "posted_on": "2026-10-21"})
    moved = admin.patch(f"{url}/{tx['id']}", json={"account_id": hdfc}).json()
    assert moved["posted_on"] is None
    # Undo: clearing it.
    tx = add_tx(admin, **{**base, "account_id": card})
    cleared = admin.patch(f"{url}/{tx['id']}", json={"posted_on": None}).json()
    assert cleared["posted_on"] is None


# ---- brokers --------------------------------------------------------------------------


def test_broker_deposit_is_not_an_investment(admin: Api) -> None:
    hdfc, zerodha = account_id(admin, "HDFC", "bank"), account_id(admin, "Zerodha")
    add_tx(admin, account_id=hdfc, type="transfer", to_account_id=zerodha, amount="50000")
    figures = summary(admin, zerodha)
    assert money(figures["balance"]) == Decimal("50000")
    assert money(figures["deposited"]) == Decimal("50000")
    assert money(figures["invested"]) == 0
    assert figures["current_value"] is None
    assert figures["unrealized_pl"] is None
    totals = overview(admin)["totals"]
    assert money(totals["month_expenses"]) == 0
    assert money(totals["invested"]) == 0
    assert money(totals["broker_cash"]) == Decimal("50000")
    assert totals["portfolio_value"] is None


def test_broker_buys_sells_charges_and_withdrawals(admin: Api) -> None:
    hdfc, zerodha = account_id(admin, "HDFC", "bank"), account_id(admin, "Zerodha")
    add_tx(admin, account_id=hdfc, type="transfer", to_account_id=zerodha, amount="50000")
    add_tx(admin, account_id=zerodha, type="buy", amount="40000", description="NIFTYBEES")
    add_tx(admin, account_id=zerodha, type="sell", amount="12000", cost_basis="10000")
    add_tx(admin, account_id=zerodha, amount="20", description="Brokerage")  # a charge
    dividend = category_id(admin, "Share Market", "Dividends", "income")
    add_tx(admin, account_id=zerodha, type="income", amount="300", category_id=dividend)
    add_tx(admin, account_id=zerodha, type="transfer", to_account_id=hdfc, amount="5000")
    figures = summary(admin, zerodha)
    # 50000 in - 40000 bought + 12000 sold - 20 charges + 300 dividend - 5000 withdrawn
    assert money(figures["balance"]) == Decimal("17280")
    assert money(figures["invested"]) == Decimal("30000")
    assert money(figures["realized_pl"]) == Decimal("2000")
    assert figures["realized_complete"] is True
    assert money(figures["withdrawn"]) == Decimal("5000")
    assert money(figures["month_buys"]) == Decimal("40000")
    assert money(figures["month_sells"]) == Decimal("12000")
    assert money(figures["month_expenses"]) == Decimal("20")
    # Buys and sells are never income or expense.
    stats = admin.get(f"{API}/stats/month?month=2026-10").json()
    assert money(stats["spend"]) == Decimal("20")
    assert money(stats["income"]) == Decimal("300")
    # A manual value gives unrealized P/L against what is still invested.
    admin.patch(
        f"{API}/accounts/{zerodha}", json={"current_value": "33000", "valued_on": "2026-10-13"}
    )
    figures = summary(admin, zerodha)
    assert money(figures["unrealized_pl"]) == Decimal("3000")
    # A sell without a cost: realized P/L is marked incomplete, never guessed.
    add_tx(admin, account_id=zerodha, type="sell", amount="5000")
    figures = summary(admin, zerodha)
    assert figures["realized_complete"] is False
    assert money(figures["realized_pl"]) == Decimal("2000")
    assert money(figures["invested"]) == Decimal("25000")


def test_buy_and_sell_rules(admin: Api) -> None:
    hdfc, zerodha = account_id(admin, "HDFC", "bank"), account_id(admin, "Zerodha")
    base = {"date": "2026-10-05", "amount": "100"}
    on_bank = admin.post(f"{API}/transactions", json={**base, "type": "buy", "account_id": hdfc})
    assert on_bank.status_code == 422
    food = category_id(admin, "Everyday", "Food")
    with_category = admin.post(
        f"{API}/transactions",
        json={**base, "type": "buy", "account_id": zerodha, "category_id": food},
    )
    assert with_category.status_code == 422
    cost_on_expense = admin.post(
        f"{API}/transactions", json={**base, "account_id": hdfc, "cost_basis": "50"}
    )
    assert cost_on_expense.status_code == 422
    sell = add_tx(admin, account_id=zerodha, type="sell", cost_basis="80")
    changed = admin.patch(f"{API}/transactions/{sell['id']}", json={"type": "buy"})
    assert changed.status_code == 200
    assert changed.json()["cost_basis"] is None


def test_portfolio_value_only_when_every_broker_is_valued(admin: Api) -> None:
    zerodha, dhan = account_id(admin, "Zerodha"), account_id(admin, "Dhan")
    admin.patch(f"{API}/accounts/{zerodha}", json={"current_value": "1000"})
    totals = overview(admin)["totals"]
    assert totals["portfolio_value"] is None
    assert totals["brokers_valued"] == 1
    for name in ("Dhan", "Angel Broker", "Coin"):
        admin.patch(f"{API}/accounts/{account_id(admin, name)}", json={"current_value": "500"})
    assert money(overview(admin)["totals"]["portfolio_value"]) == Decimal("2500")
    admin.patch(f"{API}/accounts/{dhan}", json={"is_active": False})
    assert money(overview(admin)["totals"]["portfolio_value"]) == Decimal("2000")


# ---- overview -------------------------------------------------------------------------


def test_overview_aggregates_across_accounts(admin: Api) -> None:
    hdfc, sbi = account_id(admin, "HDFC", "bank"), account_id(admin, "SBI", "bank")
    cash = account_id(admin, "Cash")
    card = account_id(admin, "HDFC CC", "credit_card")
    salary = category_id(admin, "Wages", "Paycheck", "income")
    add_tx(admin, account_id=hdfc, type="income", amount="80000", category_id=salary)
    add_tx(admin, account_id=sbi, amount="2000")
    add_tx(admin, account_id=cash, amount="500")
    add_tx(admin, account_id=card, amount="7000")
    add_tx(admin, account_id=hdfc, type="transfer", to_account_id=card, amount="7000")
    add_tx(admin, account_id=hdfc, amount="100", date="2026-09-30")  # last month
    data = overview(admin)
    totals = data["totals"]
    assert money(totals["bank_balance"]) == Decimal("70400")  # 80000-7000-100 -2000 -500
    assert money(totals["card_outstanding"]) == 0
    assert money(totals["net_cash"]) == Decimal("70400")
    assert money(totals["month_income"]) == Decimal("80000")
    assert money(totals["month_expenses"]) == Decimal("9500")
    month_sum = sum(money(r["month_expenses"]) for r in data["accounts"])
    assert month_sum == money(totals["month_expenses"])


def test_private_accounts_stay_private_in_overview(admin: Api, family_member: Api) -> None:
    mine = new_account(family_member, name="My savings", pay_type="bank", visibility="private")
    add_tx(family_member, account_id=mine, type="income", amount="900")
    ids = [r["account"]["id"] for r in overview(admin)["accounts"]]
    assert mine not in ids
    assert admin.get(f"{API}/accounts/{mine}/summary").status_code == 404
    assert money(overview(family_member)["totals"]["month_income"]) == Decimal("900")


# ---- migration ------------------------------------------------------------------------


def test_upgrade_keeps_existing_transactions(admin: Api) -> None:
    """Rows written before 0006 keep their account links and count toward balances."""
    hdfc, card = account_id(admin, "HDFC", "bank"), account_id(admin, "HDFC CC", "credit_card")
    add_tx(admin, account_id=hdfc, amount="250")
    add_tx(admin, account_id=hdfc, type="transfer", to_account_id=card, amount="100")
    config = alembic_config()
    command.downgrade(config, "0005")
    with get_engine().connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM transactions")).scalar() == 2
    command.upgrade(config, "head")
    assert admin.get(f"{API}/transactions").json()["total"] == 2
    assert money(summary(admin, hdfc)["balance"]) == Decimal("-350")
    assert money(summary(admin, card)["outstanding"]) == Decimal("-100")


def test_downgrade_refuses_to_drop_new_types(admin: Api) -> None:
    add_tx(admin, account_id=account_id(admin, "Zerodha"), type="buy")
    try:
        command.downgrade(alembic_config(), "0005")
    except RuntimeError as exc:
        assert "refund/buy/sell" in str(exc)
    else:
        raise AssertionError("downgrade should refuse")
    finally:
        command.upgrade(alembic_config(), "head")
