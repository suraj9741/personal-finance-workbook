"""A card statement's opening and closing balance, and the bank total the user types."""

from datetime import date
from decimal import Decimal

import pytest

from tests.conftest import Api, account_id, add_tx, new_client
from tests.test_balances import API, money, new_account, summary


@pytest.fixture
def card(admin: Api, monkeypatch: pytest.MonkeyPatch) -> str:
    """A card with a statement on the 14th, owing 1,000 on 1 September, and a few entries."""
    monkeypatch.setattr("app.routers.stats.today", lambda: date(2026, 11, 20))
    hdfc = account_id(admin, "HDFC", "bank")
    card = new_account(
        admin,
        name="Test CC",
        pay_type="credit_card",
        statement_day=14,
        opening_balance="1000",
        opening_date="2026-09-01",
    )
    add_tx(admin, account_id=card, date="2026-08-20", amount="999")  # before opening: ignored
    add_tx(admin, account_id=card, date="2026-10-10", amount="300")  # October's bill
    add_tx(admin, account_id=card, date="2026-10-20", amount="1551.10")
    add_tx(admin, account_id=card, date="2026-11-01", type="refund", amount="51.10")
    add_tx(admin, account_id=card, date="2026-11-05", type="income", amount="25")  # cashback
    # Bought on the 13th, posted on the 16th: December's bill.
    add_tx(admin, account_id=card, date="2026-11-13", posted_on="2026-11-16", amount="400")
    add_tx(
        admin,
        account_id=hdfc,
        date="2026-11-02",
        type="transfer",
        to_account_id=card,
        amount="1300",
    )
    return card


def test_opening_and_closing_balance_follow_the_statement(admin: Api, card: str) -> None:
    f = summary(admin, card, "2026-11")
    assert (f["statement_start"], f["statement_end"]) == ("2026-10-15", "2026-11-14")
    assert money(f["statement_opening"]) == Decimal("1300")  # 1,000 + 300
    # 1,300 + 1,551.10 - 51.10 refund - 25 cashback - 1,300 paid. The late one isn't on it.
    assert money(f["statement_closing"]) == Decimal("1475")
    assert f["statement_amount_due"] is None and f["statement_difference"] is None
    # October's closing is November's opening.
    assert money(summary(admin, card, "2026-10")["statement_closing"]) == Decimal("1300")


def test_typed_total_gives_the_difference(admin: Api, card: str) -> None:
    put = admin.put(f"{API}/accounts/{card}/statements/2026-11-14", json={"amount_due": "1485.56"})
    assert put.status_code == 200, put.text
    f = summary(admin, card, "2026-11")
    assert money(f["statement_amount_due"]) == Decimal("1485.56")
    assert money(f["statement_difference"]) == Decimal("10.56")  # the bank asks for more
    # Typing it again replaces it; an adjustment entry closes the gap.
    admin.put(f"{API}/accounts/{card}/statements/2026-11-14", json={"amount_due": "1475"})
    assert money(summary(admin, card, "2026-11")["statement_difference"]) == Decimal("0")
    # Other months don't pick it up.
    assert summary(admin, card, "2026-10")["statement_amount_due"] is None
    # Clearing it.
    assert admin.delete(f"{API}/accounts/{card}/statements/2026-11-14").status_code == 204
    assert summary(admin, card, "2026-11")["statement_amount_due"] is None


def test_card_in_credit_can_have_a_negative_total(admin: Api, card: str) -> None:
    put = admin.put(f"{API}/accounts/{card}/statements/2026-10-14", json={"amount_due": "-20"})
    assert put.status_code == 200, put.text
    assert money(summary(admin, card, "2026-10")["statement_difference"]) == Decimal("-1320")


def test_only_real_statement_dates_that_have_come(admin: Api, card: str) -> None:
    body = {"amount_due": "1"}
    wrong_day = admin.put(f"{API}/accounts/{card}/statements/2026-11-15", json=body)
    assert wrong_day.status_code == 422
    future = admin.put(f"{API}/accounts/{card}/statements/2099-01-14", json=body)
    assert future.status_code == 422
    assert "isn't out yet" in future.text
    bank = account_id(admin, "HDFC", "bank")
    assert admin.put(f"{API}/accounts/{bank}/statements/2026-11-14", json=body).status_code == 422
    no_day = account_id(admin, "HDFC CC", "credit_card")
    assert admin.put(f"{API}/accounts/{no_day}/statements/2026-11-14", json=body).status_code == 422


def test_card_opened_after_the_statement_has_no_balances(admin: Api, card: str) -> None:
    f = summary(admin, card, "2026-08")
    assert f["statement_end"] == "2026-08-14"
    assert f["statement_opening"] is None and f["statement_closing"] is None


def test_only_the_owner_types_the_total(admin: Api, card: str) -> None:
    from tests.conftest import join_by_invite

    admin.patch(f"{API}/accounts/{card}", json={"visibility": "shared"})
    member = join_by_invite(admin, "member@example.com", "Member")
    assert money(summary(member, card, "2026-11")["statement_closing"]) == Decimal("1475")
    put = member.put(f"{API}/accounts/{card}/statements/2026-11-14", json={"amount_due": "1"})
    assert put.status_code == 403
    # Someone who can't see the card gets nothing.
    stranger = new_client()
    assert (
        stranger.put(
            f"{API}/accounts/{card}/statements/2026-11-14", json={"amount_due": "1"}
        ).status_code
        == 401
    )


def test_card_opened_the_day_after_a_statement_starts_from_its_opening_balance(
    admin: Api, card: str
) -> None:
    fresh = new_account(
        admin,
        name="Fresh CC",
        pay_type="credit_card",
        statement_day=14,
        opening_balance="500",
        opening_date="2026-10-15",
    )
    add_tx(admin, account_id=fresh, date="2026-10-20", amount="100")
    f = summary(admin, fresh, "2026-11")
    assert money(f["statement_opening"]) == Decimal("500")
    assert money(f["statement_closing"]) == Decimal("600")
    # The opening balance was owed as 15 Oct began: the statement that closed on the 14th.
    assert money(summary(admin, fresh, "2026-10")["statement_closing"]) == Decimal("500")
    assert summary(admin, fresh, "2026-09")["statement_closing"] is None
