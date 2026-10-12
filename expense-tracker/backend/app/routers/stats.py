"""Budgets and the numbers behind the dashboard. Every total is bounded by a date range."""

import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import ColumnElement, and_, case, func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import Ctx, get_ctx, require_owner
from app.models import Budget, Category, Transaction
from app.routers.catalog import get_category
from app.routers.transactions import month_range
from app.schemas import (
    AttentionOut,
    BudgetCopyIn,
    BudgetItem,
    BudgetLine,
    BudgetsIn,
    BudgetsOut,
    CategoryLine,
    LoanOut,
    Month,
    MonthStats,
    NextChange,
    TrendPoint,
)
from app.services import add_months

router = APIRouter(tags=["stats"])

ZERO = Decimal("0")
OLD_LOAN_DAYS = 60


def this_month() -> str:
    return datetime.now(UTC).strftime("%Y-%m")


def month_key(value: date) -> str:
    return value.strftime("%Y-%m")


# ---- budgets --------------------------------------------------------------------------


def budget_rows(db: Session, ctx: Ctx, start: date) -> dict[uuid.UUID, Budget]:
    """The row that sets each category's budget for the month starting at `start`.

    A row in the month itself wins. Otherwise the latest carry-forward row before it applies.
    """
    carried = db.scalars(
        select(Budget)
        .where(
            Budget.household_id == ctx.household_id,
            Budget.month < start,
            Budget.carry_forward.is_(True),
        )
        .order_by(Budget.month)
    )
    rows = {b.category_id: b for b in carried}  # later months overwrite earlier ones
    rows.update(
        (b.category_id, b)
        for b in db.scalars(
            select(Budget).where(Budget.household_id == ctx.household_id, Budget.month == start)
        )
    )
    return rows


def budgets_for(db: Session, ctx: Ctx, start: date) -> dict[uuid.UUID, Decimal]:
    return {k: b.amount for k, b in budget_rows(db, ctx, start).items() if b.amount > 0}


def first_of_this_month() -> date:
    return month_range(this_month())[0]


@router.get("/budgets", response_model=BudgetsOut)
def get_budgets(
    month: Month = Query(default_factory=this_month),
    ctx: Ctx = Depends(get_ctx),
    db: Session = Depends(get_db),
) -> BudgetsOut:
    start, _ = month_range(month)
    return BudgetsOut(
        month=month,
        carries_forward=start >= first_of_this_month(),
        items=[
            BudgetLine(
                category_id=k,
                amount=b.amount,
                this_month_only=not b.carry_forward,
                set_in=month_key(b.month),
            )
            for k, b in budget_rows(db, ctx, start).items()
            if b.amount > 0
        ],
        next_changes=next_changes(db, ctx, start),
    )


def next_changes(db: Session, ctx: Ctx, start: date) -> list[NextChange]:
    """Each category's next carry-forward row after this month: a default set for later."""
    first: dict[uuid.UUID, Budget] = {}
    for b in db.scalars(
        select(Budget)
        .where(
            Budget.household_id == ctx.household_id,
            Budget.month > start,
            Budget.carry_forward.is_(True),
        )
        .order_by(Budget.month.desc())
    ):
        first[b.category_id] = b  # earlier months overwrite later ones
    return [
        NextChange(category_id=k, month=month_key(b.month), amount=b.amount)
        for k, b in first.items()
    ]


def set_budget(db: Session, ctx: Ctx, start: date, item: BudgetItem) -> None:
    category_id = item.category_id
    only = item.this_month_only or start < first_of_this_month()
    mine = (Budget.household_id == ctx.household_id, Budget.category_id == category_id)
    here = db.scalar(select(Budget).where(*mine, Budget.month == start))
    if here is not None and only and here.carry_forward and here.amount != item.amount:
        # This row is also the default for later months. Move that default to the first later
        # month without a row of its own, unless a later default takes over first.
        later = {b.month: b for b in db.scalars(select(Budget).where(*mine, Budget.month > start))}
        nxt = add_months(start, 1)
        while nxt in later and not later[nxt].carry_forward:
            nxt = add_months(nxt, 1)
        if nxt not in later:
            db.add(
                Budget(
                    household_id=ctx.household_id,
                    category_id=category_id,
                    month=nxt,
                    amount=here.amount,
                )
            )
    before = db.scalar(
        select(Budget.amount)
        .where(*mine, Budget.month < start, Budget.carry_forward.is_(True))
        .order_by(Budget.month.desc())
        .limit(1)
    )
    if item.amount == (before or ZERO):
        # Same as what the month gets anyway: no row of its own needed.
        if here is not None:
            db.delete(here)
    elif here is not None:
        here.amount, here.carry_forward = item.amount, not only
    else:
        db.add(
            Budget(
                household_id=ctx.household_id,
                category_id=category_id,
                month=start,
                amount=item.amount,
                carry_forward=not only,
            )
        )


@router.put("/budgets", response_model=BudgetsOut)
def put_budgets(
    body: BudgetsIn, ctx: Ctx = Depends(require_owner), db: Session = Depends(get_db)
) -> BudgetsOut:
    """Sets the listed categories' budgets from this month on (or for this month only).

    Categories that aren't listed keep what they have. An amount of 0 means no budget.
    Months before the current one only ever change themselves.
    """
    start, _ = month_range(body.month)
    for item in body.items:
        if get_category(db, ctx, item.category_id).kind == "transfer":
            raise HTTPException(422, "Budgets are set on expense and income categories")
    for item in body.items:
        set_budget(db, ctx, start, item)
        db.flush()
    db.commit()
    return get_budgets(body.month, ctx, db)


@router.post("/budgets/copy", response_model=BudgetsOut, status_code=status.HTTP_201_CREATED)
def copy_budgets(
    body: BudgetCopyIn, ctx: Ctx = Depends(require_owner), db: Session = Depends(get_db)
) -> BudgetsOut:
    """Gives `to_month` its own copy of `from_month`'s budgets."""
    source, _ = month_range(body.from_month)
    target, _ = month_range(body.to_month)
    if db.scalar(
        select(func.count()).where(Budget.household_id == ctx.household_id, Budget.month == target)
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, f"{body.to_month} already has budgets")
    db.add_all(
        Budget(household_id=ctx.household_id, category_id=k, month=target, amount=v)
        for k, v in budgets_for(db, ctx, source).items()
    )
    db.commit()
    return get_budgets(body.to_month, ctx, db)


# ---- stats ----------------------------------------------------------------------------


def scoped(ctx: Ctx, scope: str) -> list[ColumnElement[bool]]:
    conditions = [ctx.visible_transaction()]
    if scope == "me":
        conditions.append(ctx.just_me())
    return conditions


def group_totals(
    db: Session, conditions: list[ColumnElement[bool]], start: date, end: date
) -> dict[str, Decimal]:
    rows = db.execute(
        select(Category.stats_group, func.sum(Transaction.amount))
        .join(Category, Category.id == Transaction.category_id)
        .where(*conditions, Transaction.date >= start, Transaction.date < end)
        .group_by(Category.stats_group)
    )
    totals = {group: total or ZERO for group, total in rows}
    # Uncategorized rows still count: expense as spend, income as earned.
    for kind, group in (("expense", "spend"), ("income", "earned")):
        loose = db.scalar(
            select(func.sum(Transaction.amount)).where(
                *conditions,
                Transaction.category_id.is_(None),
                Transaction.type == kind,
                Transaction.date >= start,
                Transaction.date < end,
            )
        )
        totals[group] = totals.get(group, ZERO) + (loose or ZERO)
    return totals


def rate(income: Decimal, saved: Decimal) -> float | None:
    return round(float(saved / income), 4) if income > 0 else None


def category_lines(
    db: Session, ctx: Ctx, conditions: list[ColumnElement[bool]], start: date, end: date
) -> list[CategoryLine]:
    budgets = budgets_for(db, ctx, start)
    actuals = dict(
        db.execute(
            select(Transaction.category_id, func.sum(Transaction.amount))
            .where(
                *conditions,
                Transaction.type.in_(("expense", "income")),
                Transaction.date >= start,
                Transaction.date < end,
            )
            .group_by(Transaction.category_id)
        ).all()
    )
    ids = {k for k in actuals if k is not None} | set(budgets)
    if not ids:
        return []
    categories = db.scalars(
        select(Category)
        .where(Category.id.in_(ids), Category.kind != "transfer")
        .order_by(Category.sort_order)
    )
    lines = []
    for c in categories:
        actual = actuals.get(c.id) or ZERO
        budget = budgets.get(c.id)
        expense = c.kind == "expense"
        lines.append(
            CategoryLine(
                category_id=c.id,
                kind=c.kind,
                parent_name=c.parent_name,
                sub_name=c.sub_name,
                stats_group=c.stats_group,
                budget=budget,
                actual=actual,
                diff=(budget or ZERO) - actual if expense else actual - (budget or ZERO),
                over_budget=expense and budget is not None and actual > budget,
            )
        )
    return lines


@router.get("/stats/month", response_model=MonthStats)
def month_stats(
    month: Month = Query(default_factory=this_month),
    scope: str = Query("household", pattern="^(household|me)$"),
    ctx: Ctx = Depends(get_ctx),
    db: Session = Depends(get_db),
) -> MonthStats:
    start, end = month_range(month)
    conditions = scoped(ctx, scope)
    totals = group_totals(db, conditions, start, end)
    income, spend = totals.get("earned", ZERO), totals.get("spend", ZERO)
    saved = income - spend
    lines = category_lines(db, ctx, conditions, start, end)
    return MonthStats(
        month=month,
        scope=scope,
        income=income,
        spend=spend,
        saved=saved,
        savings_rate=rate(income, saved),
        invested=totals.get("saving", ZERO),
        lent=totals.get("lent", ZERO),
        repaid=totals.get("repaid", ZERO),
        budget_total=sum((line.budget or ZERO for line in lines if line.kind == "expense"), ZERO),
        categories=lines,
    )


@router.get("/stats/trend", response_model=list[TrendPoint])
def trend(
    months: int = Query(6, ge=1, le=24),
    end_month: Month = Query(default_factory=this_month),
    scope: str = Query("household", pattern="^(household|me)$"),
    ctx: Ctx = Depends(get_ctx),
    db: Session = Depends(get_db),
) -> list[TrendPoint]:
    last, _ = month_range(end_month)
    conditions = scoped(ctx, scope)
    points = []
    for offset in range(months - 1, -1, -1):
        start = add_months(last, -offset)
        totals = group_totals(db, conditions, start, add_months(start, 1))
        income, spend = totals.get("earned", ZERO), totals.get("spend", ZERO)
        points.append(
            TrendPoint(
                month=month_key(start),
                income=income,
                spend=spend,
                saved=income - spend,
                savings_rate=rate(income, income - spend),
            )
        )
    return points


def outstanding_loans(db: Session, ctx: Ctx) -> list[LoanOut]:
    person = func.coalesce(func.nullif(func.trim(Transaction.counterparty), ""), "(no name)")
    signed = func.sum(
        case((Category.stats_group == "lent", Transaction.amount), else_=-Transaction.amount)
    )
    rows = db.execute(
        select(
            person,
            signed,
            func.max(case((Category.stats_group == "lent", Transaction.date))),
        )
        .join(Category, Category.id == Transaction.category_id)
        .where(ctx.visible_transaction(), Category.stats_group.in_(("lent", "repaid")))
        .group_by(person)
    )
    return [
        LoanOut(counterparty=name, outstanding=total, last_lent_on=last)
        for name, total, last in rows
        if total and total > 0 and last
    ]


@router.get("/stats/attention", response_model=AttentionOut)
def attention(
    month: Month = Query(default_factory=this_month),
    ctx: Ctx = Depends(get_ctx),
    db: Session = Depends(get_db),
) -> AttentionOut:
    start, end = month_range(month)
    in_month = and_(ctx.visible_transaction(), Transaction.date >= start, Transaction.date < end)
    uncategorized = db.scalar(
        select(func.count()).where(
            in_month, Transaction.category_id.is_(None), Transaction.type != "transfer"
        )
    )
    income_rows = db.scalar(select(func.count()).where(in_month, Transaction.type == "income"))
    card_bill = db.scalar(
        select(func.count())
        .select_from(Transaction)
        .join(Category, Category.id == Transaction.category_id)
        .where(in_month, Category.parent_name == "Debt", Category.sub_name == "Credit cards")
    )
    cutoff = datetime.now(UTC).date() - timedelta(days=OLD_LOAN_DAYS)
    lines = category_lines(db, ctx, [ctx.visible_transaction()], start, end)
    return AttentionOut(
        month=month,
        uncategorized=uncategorized or 0,
        over_budget=[line for line in lines if line.over_budget],
        old_loans=[loan for loan in outstanding_loans(db, ctx) if loan.last_lent_on <= cutoff],
        no_income=(income_rows or 0) == 0,
        credit_card_category_used=card_bill or 0,
    )
