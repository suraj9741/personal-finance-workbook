"""Account balances, card outstanding and broker figures, all from stored transactions.

This is the only place balances are worked out; the frontend shows what it returns.

How each transaction type moves an account (the "from" account is account_id):
- expense, buy, transfer out: money leaves the account.
- income, refund, sell, transfer in (to_account_id): money comes in.

A bank or cash balance is opening_balance plus money in minus money out. A card's outstanding
is the other way round: opening_balance (owed on the opening date) plus purchases minus
payments and refunds. A broker's balance is the cash it holds; what is invested is tracked
separately from buys and sells, so a deposit is never taken as an investment.

When an account has an opening_date, only transactions on or after it count toward the
balance: the opening balance already covers what happened before. Month figures always use
every transaction in the month.

Balances "now" count entries dated up to today; one dated later (rent entered ahead for the
31st) waits for its day. A bank's start and end of month balances count everything dated
before the month and up to its last day, so start + the month's flows = end.

A card with a statement day also gets statement figures: the statement that closes in the
month runs from the day after the previous statement day to the statement day itself, and an
entry lands on it by its posted date when it has one, else its purchase date.
"""

import calendar
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import ColumnElement, func, or_, select, true
from sqlalchemy.orm import Session, aliased

from app.models import Account, Transaction
from app.schemas import AccountFigures, AccountOut, OverviewTotals

ZERO = Decimal("0")
OUT_TYPES = ("expense", "buy", "transfer")
IN_TYPES = ("income", "refund", "sell")


@dataclass
class Flows:
    """Sums by transaction type for one account. transfer_in is money arriving by transfer."""

    by_type: dict[str, Decimal] = field(default_factory=lambda: defaultdict(lambda: ZERO))
    transfer_in: Decimal = ZERO
    sell_cost: Decimal = ZERO  # cost basis of sells that have one
    sell_with_cost: Decimal = ZERO  # proceeds of those same sells

    def net(self) -> Decimal:
        money_in = sum((self.by_type[t] for t in IN_TYPES), ZERO) + self.transfer_in
        money_out = sum((self.by_type[t] for t in OUT_TYPES), ZERO)
        return money_in - money_out


def _flows(
    db: Session, account_ids: list[uuid.UUID], *where: ColumnElement[bool], since_opening: bool
) -> dict[uuid.UUID, Flows]:
    flows: dict[uuid.UUID, Flows] = defaultdict(Flows)
    if not account_ids:
        return flows
    source = aliased(Account)
    opened = (
        or_(source.opening_date.is_(None), Transaction.date >= source.opening_date)
        if since_opening
        else true()
    )
    rows = db.execute(
        select(
            Transaction.account_id,
            Transaction.type,
            func.sum(Transaction.amount),
            func.sum(Transaction.cost_basis),
            func.sum(Transaction.amount).filter(Transaction.cost_basis.is_not(None)),
        )
        .join(source, source.id == Transaction.account_id)
        .where(Transaction.account_id.in_(account_ids), opened, *where)
        .group_by(Transaction.account_id, Transaction.type)
    )
    for account_id, kind, amount, cost, with_cost in rows:
        f = flows[account_id]
        f.by_type[kind] = amount or ZERO
        if kind == "sell":
            f.sell_cost, f.sell_with_cost = cost or ZERO, with_cost or ZERO
    target = aliased(Account)
    opened_target = (
        or_(target.opening_date.is_(None), Transaction.date >= target.opening_date)
        if since_opening
        else true()
    )
    transfers = db.execute(
        select(Transaction.to_account_id, func.sum(Transaction.amount))
        .join(target, target.id == Transaction.to_account_id)
        .where(Transaction.to_account_id.in_(account_ids), opened_target, *where)
        .group_by(Transaction.to_account_id)
    )
    for to_id, amount in transfers:
        if to_id is not None:
            flows[to_id].transfer_in = amount or ZERO
    return flows


def next_due_date(due_day: int | None, today: date) -> date | None:
    """The next date on or after today that falls on due_day (the month's last day if shorter)."""
    if due_day is None:
        return None
    year, month = today.year, today.month
    for _ in range(2):
        day = min(due_day, calendar.monthrange(year, month)[1])
        candidate = date(year, month, day)
        if candidate >= today:
            return candidate
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return None  # unreachable: next month always qualifies


def statement_close(statement_day: int, year: int, month: int) -> date:
    """The statement date in a month: statement_day, or the month's last day if shorter."""
    return date(year, month, min(statement_day, calendar.monthrange(year, month)[1]))


def statement_cycle(statement_day: int, month_start: date) -> tuple[date, date]:
    """First and last day of the statement that closes in month_start's month."""
    prev = month_start - timedelta(days=1)
    start = statement_close(statement_day, prev.year, prev.month) + timedelta(days=1)
    return start, statement_close(statement_day, month_start.year, month_start.month)


def last_statement(statement_day: int, today: date) -> date:
    """The latest statement date before today. On the statement day itself that bill is still
    open, so the one before it counts."""
    close = statement_close(statement_day, today.year, today.month)
    if close < today:
        return close
    prev = today.replace(day=1) - timedelta(days=1)
    return statement_close(statement_day, prev.year, prev.month)


@dataclass
class Statement:
    start: date
    end: date
    since: date  # first day not yet on a statement
    purchases: Decimal = ZERO
    refunds: Decimal = ZERO
    payments: Decimal = ZERO
    credits: Decimal = ZERO
    unbilled: Decimal = ZERO


def _statements(
    db: Session, cards: list[Account], month_start: date, today: date
) -> dict[uuid.UUID, Statement]:
    """Statement and unbilled figures for each card that has a statement day."""
    result: dict[uuid.UUID, Statement] = {}
    for card in cards:
        if card.statement_day is None:
            continue
        start, end = statement_cycle(card.statement_day, month_start)
        since = last_statement(card.statement_day, today) + timedelta(days=1)
        result[card.id] = Statement(start=start, end=end, since=since)
    if not result:
        return result
    first = min(min(s.start, s.since) for s in result.values())
    lands: ColumnElement[date] = func.coalesce(Transaction.posted_on, Transaction.date)
    rows = db.execute(
        select(Transaction.account_id, Transaction.type, lands, func.sum(Transaction.amount))
        .where(
            Transaction.account_id.in_(result),
            Transaction.type.in_(("expense", "refund", "income")),
            lands >= first,
        )
        .group_by(Transaction.account_id, Transaction.type, lands)
    )
    for account_id, kind, day, amount in rows:
        s = result[account_id]
        sign = -1 if kind == "refund" else 1
        if s.start <= day <= s.end:
            if kind == "income":
                s.credits += amount
            else:
                s.purchases += sign * amount
                if kind == "refund":
                    s.refunds += amount
        if day >= s.since and kind != "income":
            s.unbilled += sign * amount
    payments = db.execute(
        select(Transaction.to_account_id, Transaction.date, func.sum(Transaction.amount))
        .where(Transaction.to_account_id.in_(result), Transaction.date >= first)
        .group_by(Transaction.to_account_id, Transaction.date)
    )
    for to_id, day, amount in payments:
        bill = result.get(to_id) if to_id is not None else None
        if bill and bill.start <= day <= bill.end:
            bill.payments += amount
    return result


def figures(
    db: Session, accounts: list[Account], month_start: date, month_end: date, today: date
) -> list[AccountFigures]:
    ids = [a.id for a in accounts]
    all_time = _flows(db, ids, Transaction.date <= today, since_opening=True)
    before_month = _flows(db, ids, Transaction.date < month_start, since_opening=True)
    to_month_end = _flows(db, ids, Transaction.date < month_end, since_opening=True)
    month = _flows(
        db,
        ids,
        Transaction.date >= month_start,
        Transaction.date < month_end,
        since_opening=False,
    )
    cards = [a for a in accounts if a.pay_type == "credit_card"]
    statements = _statements(db, cards, month_start, today)
    result = []
    for account in accounts:
        f, m = all_time[account.id], month[account.id]
        kind = account.pay_type
        net = f.net()
        balance = outstanding = available = invested = None
        month_start_balance = month_end_balance = None
        deposited = withdrawn = value = unrealized = realized = None
        realized_complete = True
        if kind == "credit_card":
            outstanding = account.opening_balance - net
            if account.credit_limit is not None:
                available = max(account.credit_limit - outstanding, ZERO)
        else:
            balance = account.opening_balance + net
            month_start_balance = account.opening_balance + before_month[account.id].net()
            month_end_balance = account.opening_balance + to_month_end[account.id].net()
        if kind == "share_broker":
            sells = f.by_type["sell"]
            # Sells without a cost basis come off at their proceeds: the best that is known.
            sold_cost = f.sell_cost + (sells - f.sell_with_cost)
            invested = account.opening_invested + f.by_type["buy"] - sold_cost
            deposited, withdrawn = f.transfer_in, f.by_type["transfer"]
            value = account.current_value
            unrealized = value - invested if value is not None else None
            if f.sell_with_cost:
                realized = f.sell_with_cost - f.sell_cost
            realized_complete = f.sell_with_cost == sells
        st = statements.get(account.id)
        result.append(
            AccountFigures(
                account=AccountOut.model_validate(account),
                balance=balance,
                balance_month_start=month_start_balance,
                balance_month_end=month_end_balance,
                outstanding=outstanding,
                available_credit=available,
                next_due_date=next_due_date(account.due_day, today)
                if kind == "credit_card"
                else None,
                invested=invested,
                deposited=deposited,
                withdrawn=withdrawn,
                current_value=value,
                unrealized_pl=unrealized,
                realized_pl=realized,
                realized_complete=realized_complete,
                month_income=m.by_type["income"],
                month_expenses=m.by_type["expense"] - m.by_type["refund"],
                month_refunds=m.by_type["refund"],
                month_transfers_in=m.transfer_in,
                month_transfers_out=m.by_type["transfer"],
                month_buys=m.by_type["buy"],
                month_sells=m.by_type["sell"],
                statement_start=st.start if st else None,
                statement_end=st.end if st else None,
                statement_purchases=st.purchases if st else None,
                statement_refunds=st.refunds if st else None,
                statement_payments=st.payments if st else None,
                statement_credits=st.credits if st else None,
                unbilled_since=st.since if st else None,
                unbilled=st.unbilled if st else None,
            )
        )
    return result


def totals(rows: list[AccountFigures]) -> OverviewTotals:
    active = [r for r in rows if r.account.is_active]
    banks = [r for r in active if r.account.pay_type in ("bank", "cash")]
    cards = [r for r in active if r.account.pay_type == "credit_card"]
    brokers = [r for r in active if r.account.pay_type == "share_broker"]
    bank_balance = sum((r.balance or ZERO for r in banks), ZERO)

    def bank_sum(values: list[Decimal | None]) -> Decimal:
        return sum((v or ZERO for v in values), ZERO)

    card_outstanding = sum((r.outstanding or ZERO for r in cards), ZERO)
    limits = [r.available_credit for r in cards if r.available_credit is not None]
    valued = [r.current_value for r in brokers if r.current_value is not None]
    # A transfer between two visible accounts is in one account's "in" and the other's "out",
    # never in income or expenses, so summing the accounts can't double-count it.
    return OverviewTotals(
        bank_balance=bank_balance,
        bank_balance_month_start=bank_sum([r.balance_month_start for r in banks]),
        bank_balance_month_end=bank_sum([r.balance_month_end for r in banks]),
        card_outstanding=card_outstanding,
        available_credit=sum(limits, ZERO) if limits else None,
        broker_cash=sum((r.balance or ZERO for r in brokers), ZERO),
        invested=sum((r.invested or ZERO for r in brokers), ZERO),
        portfolio_value=sum(valued, ZERO) if brokers and len(valued) == len(brokers) else None,
        brokers_valued=len(valued),
        brokers=len(brokers),
        month_income=sum((r.month_income for r in rows), ZERO),
        month_expenses=sum((r.month_expenses for r in rows), ZERO),
        net_cash=bank_balance - card_outstanding,
    )
