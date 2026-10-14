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
"""

import calendar
import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
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


def figures(
    db: Session, accounts: list[Account], month_start: date, month_end: date, today: date
) -> list[AccountFigures]:
    ids = [a.id for a in accounts]
    all_time = _flows(db, ids, since_opening=True)
    month = _flows(
        db,
        ids,
        Transaction.date >= month_start,
        Transaction.date < month_end,
        since_opening=False,
    )
    result = []
    for account in accounts:
        f, m = all_time[account.id], month[account.id]
        kind = account.pay_type
        net = f.net()
        balance = outstanding = available = invested = None
        deposited = withdrawn = value = unrealized = realized = None
        realized_complete = True
        if kind == "credit_card":
            outstanding = account.opening_balance - net
            if account.credit_limit is not None:
                available = max(account.credit_limit - outstanding, ZERO)
        else:
            balance = account.opening_balance + net
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
        result.append(
            AccountFigures(
                account=AccountOut.model_validate(account),
                balance=balance,
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
            )
        )
    return result


def totals(rows: list[AccountFigures]) -> OverviewTotals:
    active = [r for r in rows if r.account.is_active]
    banks = [r for r in active if r.account.pay_type in ("bank", "cash")]
    cards = [r for r in active if r.account.pay_type == "credit_card"]
    brokers = [r for r in active if r.account.pay_type == "share_broker"]
    bank_balance = sum((r.balance or ZERO for r in banks), ZERO)
    card_outstanding = sum((r.outstanding or ZERO for r in cards), ZERO)
    limits = [r.available_credit for r in cards if r.available_credit is not None]
    valued = [r.current_value for r in brokers if r.current_value is not None]
    # A transfer between two visible accounts is in one account's "in" and the other's "out",
    # never in income or expenses, so summing the accounts can't double-count it.
    return OverviewTotals(
        bank_balance=bank_balance,
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
