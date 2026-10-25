"""Budgets and the numbers behind the dashboard. Every total is bounded by a date range."""

import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import ColumnElement, and_, case, func, or_, select
from sqlalchemy.orm import Session

from app import balances
from app.db import get_db
from app.deps import Ctx, get_ctx, require_owner
from app.models import Account, Budget, Category, Transaction
from app.routers.catalog import get_account, get_category
from app.routers.transactions import month_range
from app.schemas import (
    AccountFigures,
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
    OverviewOut,
    TrendPoint,
    YearBudgetCell,
    YearBudgetRow,
    YearExpense,
    YearFamily,
    YearGroup,
    YearMonth,
    YearStats,
)
from app.services import CATEGORY_ORDER, add_months, family_group_names

router = APIRouter(tags=["stats"])

ZERO = Decimal("0")
OLD_LOAN_DAYS = 60
# The year view lists this many of the largest expenses, and counts those of at least BIG_EXPENSE.
TOP_EXPENSES = 10
BIG_EXPENSE = Decimal("10000")


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


# A refund takes money back off its expense category, so it counts negative.
SIGNED_AMOUNT = case((Transaction.type == "refund", -Transaction.amount), else_=Transaction.amount)


def group_totals(
    db: Session, conditions: list[ColumnElement[bool]], start: date, end: date
) -> dict[str, Decimal]:
    rows = db.execute(
        select(Category.stats_group, func.sum(SIGNED_AMOUNT))
        .join(Category, Category.id == Transaction.category_id)
        .where(*conditions, Transaction.date >= start, Transaction.date < end)
        .group_by(Category.stats_group)
    )
    totals = {group: total or ZERO for group, total in rows}
    # Uncategorized rows still count: expense (less refunds) as spend, income as earned.
    for kinds, group in ((("expense", "refund"), "spend"), (("income",), "earned")):
        loose = db.scalar(
            select(func.sum(SIGNED_AMOUNT)).where(
                *conditions,
                Transaction.category_id.is_(None),
                Transaction.type.in_(kinds),
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
    actuals: dict[uuid.UUID | None, Decimal] = dict(
        db.execute(
            select(Transaction.category_id, func.sum(SIGNED_AMOUNT))
            .where(
                *conditions,
                Transaction.type.in_(("expense", "income", "refund")),
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
        .order_by(*CATEGORY_ORDER)
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


# ---- year -----------------------------------------------------------------------------

# Spending as the month figures count it: spend categories, plus expenses and refunds with none.
IS_SPEND = or_(
    Category.stats_group == "spend",
    and_(Transaction.category_id.is_(None), Transaction.type.in_(("expense", "refund"))),
)
IS_CARD_BILL = and_(Category.parent_name == "Debt", Category.sub_name == "Credit cards")


def month_status(start: date, end: date, first_entry: date | None, now: date) -> str:
    if start > now:
        return "future"
    if first_entry is None or first_entry >= end:
        return "untracked"
    return "partial" if first_entry > start else "tracked"


def spend_by_group_and_month(
    db: Session, conditions: list[ColumnElement[bool]], start: date, end: date
) -> dict[str | None, list[Decimal]]:
    month = func.extract("month", Transaction.date)
    rows = db.execute(
        select(Category.parent_name, month, func.sum(SIGNED_AMOUNT))
        .select_from(Transaction)
        .outerjoin(Category, Category.id == Transaction.category_id)
        .where(*conditions, IS_SPEND, Transaction.date >= start, Transaction.date < end)
        .group_by(Category.parent_name, month)
    )
    groups: dict[str | None, list[Decimal]] = {}
    for parent, index, total in rows:
        groups.setdefault(parent, [ZERO] * 12)[int(index) - 1] = total or ZERO
    return groups


@router.get("/stats/year", response_model=YearStats)
def year_stats(
    year: int = Query(default_factory=lambda: today().year, ge=2000, le=2100),
    scope: str = Query("household", pattern="^(household|me)$"),
    ctx: Ctx = Depends(get_ctx),
    db: Session = Depends(get_db),
) -> YearStats:
    """January to December: each month counted as /stats/month counts it, and the year as their sum.

    Months before the first entry are "untracked", so a year that started in October doesn't read
    as nine months of zero.
    """
    conditions = scoped(ctx, scope)
    start, end = date(year, 1, 1), date(year + 1, 1, 1)
    now = today()
    first_entry = db.scalar(select(func.min(Transaction.date)).where(*conditions))
    spend_categories: dict[uuid.UUID, str] = dict(
        db.execute(
            select(Category.id, Category.parent_name).where(
                Category.household_id == ctx.household_id,
                Category.kind == "expense",
                Category.stats_group == "spend",
            )
        ).all()
    )

    months: list[YearMonth] = []
    # Each group's budget per month; a group with no budgeted category has None that month.
    group_budgets: dict[str, list[Decimal | None]] = {}
    for index in range(12):
        m_start = add_months(start, index)
        m_end = add_months(m_start, 1)
        totals = group_totals(db, conditions, m_start, m_end)
        budget: Decimal | None = None
        for category, amount in budgets_for(db, ctx, m_start).items():
            parent = spend_categories.get(category)
            if parent is None:
                continue
            budget = (budget or ZERO) + amount
            row = group_budgets.setdefault(parent, [None] * 12)
            row[index] = (row[index] or ZERO) + amount
        income, spend = totals.get("earned", ZERO), totals.get("spend", ZERO)
        months.append(
            YearMonth(
                month=month_key(m_start),
                status=month_status(m_start, m_end, first_entry, now),
                income=income,
                spend=spend,
                saved=income - spend,
                invested=totals.get("saving", ZERO),
                lent=totals.get("lent", ZERO),
                repaid=totals.get("repaid", ZERO),
                budget=budget,
            )
        )

    spent = spend_by_group_and_month(db, conditions, start, end)
    groups = sorted(
        (YearGroup(parent_name=p, total=sum(m, ZERO), months=m) for p, m in spent.items()),
        key=lambda g: (-g.total, g.parent_name or ""),
    )
    order = {g.parent_name: i for i, g in enumerate(groups)}
    budget_grid = [
        YearBudgetRow(
            parent_name=parent,
            months=[
                YearBudgetCell(budget=b, actual=spent.get(parent, [ZERO] * 12)[i])
                for i, b in enumerate(row)
            ],
        )
        for parent, row in sorted(
            group_budgets.items(), key=lambda item: (order.get(item[0], len(order)), item[0])
        )
    ]

    in_year = [*conditions, Transaction.date >= start, Transaction.date < end]
    big_rows = db.execute(
        select(Transaction, Category.parent_name, Category.sub_name, Account.name)
        .outerjoin(Category, Category.id == Transaction.category_id)
        .outerjoin(Account, Account.id == Transaction.account_id)
        .where(*in_year, IS_SPEND, Transaction.type == "expense")
        .order_by(Transaction.amount.desc(), Transaction.date.desc())
        .limit(TOP_EXPENSES)
    ).all()
    big_count, big_total = db.execute(
        select(func.count(), func.sum(Transaction.amount))
        .select_from(Transaction)
        .outerjoin(Category, Category.id == Transaction.category_id)
        .where(*in_year, IS_SPEND, Transaction.type == "expense", Transaction.amount >= BIG_EXPENSE)
    ).one()

    family_rows = db.execute(
        select(Category.parent_name, Category.kind, func.sum(SIGNED_AMOUNT))
        .select_from(Transaction)
        .join(Category, Category.id == Transaction.category_id)
        .where(
            *in_year,
            Category.kind != "transfer",
            Category.parent_name.in_(family_group_names(ctx.household_id)),
        )
        .group_by(Category.parent_name, Category.kind)
    ).all()
    family_groups = db.scalars(
        select(Category.parent_name)
        .where(
            Category.household_id == ctx.household_id,
            Category.parent_name.in_(family_group_names(ctx.household_id)),
            Category.kind == "expense",
        )
        .distinct()
    ).all()
    given = {p: t or ZERO for p, kind, t in family_rows if kind == "expense"}
    received = {p: t or ZERO for p, kind, t in family_rows if kind == "income"}
    family = sorted(
        (
            YearFamily(parent_name=p, given=given.get(p, ZERO), received=received.get(p, ZERO))
            for p in family_groups
        ),
        key=lambda f: (-f.given, f.parent_name),
    )

    card_count, card_total = db.execute(
        select(func.count(), func.sum(SIGNED_AMOUNT))
        .select_from(Transaction)
        .join(Category, Category.id == Transaction.category_id)
        .where(*in_year, IS_CARD_BILL)
    ).one()

    def total(field: str) -> Decimal:
        return sum((getattr(m, field) for m in months), ZERO)

    income, spend = total("income"), total("spend")
    so_far = [m.budget for m in months if m.status in ("partial", "tracked")]
    return YearStats(
        year=year,
        scope=scope,
        first_entry=first_entry,
        income=income,
        spend=spend,
        saved=income - spend,
        savings_rate=rate(income, income - spend),
        invested=total("invested"),
        lent=total("lent"),
        repaid=total("repaid"),
        budget_to_date=sum((b for b in so_far if b is not None), ZERO)
        if any(b is not None for b in so_far)
        else None,
        months=months,
        groups=groups,
        budget_grid=budget_grid,
        biggest=[
            YearExpense(
                id=tx.id,
                date=tx.date,
                description=tx.description,
                amount=tx.amount,
                parent_name=parent,
                sub_name=sub,
                account_name=account,
            )
            for tx, parent, sub, account in big_rows
        ],
        big_count=big_count or 0,
        big_total=big_total or ZERO,
        big_threshold=BIG_EXPENSE,
        family=family,
        card_bills_count=card_count or 0,
        card_bills_total=card_total or ZERO,
    )


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
            in_month,
            Transaction.category_id.is_(None),
            Transaction.type.in_(("expense", "income", "refund")),
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


# ---- accounts overview ----------------------------------------------------------------


def today() -> date:
    return datetime.now(UTC).date()


@router.get("/stats/overview", response_model=OverviewOut)
def overview(
    month: Month = Query(default_factory=this_month),
    ctx: Ctx = Depends(get_ctx),
    db: Session = Depends(get_db),
) -> OverviewOut:
    """Every visible account with its balance and the month's activity, plus the totals.

    Inactive accounts are listed (flagged) so history stays visible; balance totals skip them.
    The month only changes the month figures, never a balance.
    """
    start, end = month_range(month)
    accounts = list(db.scalars(select(Account).where(ctx.visible_account()).order_by(Account.name)))
    rows = balances.figures(db, accounts, start, end, today())
    return OverviewOut(month=month, totals=balances.totals(rows), accounts=rows)


@router.get("/accounts/{account_id}/summary", response_model=AccountFigures)
def account_summary(
    account_id: uuid.UUID,
    month: Month = Query(default_factory=this_month),
    ctx: Ctx = Depends(get_ctx),
    db: Session = Depends(get_db),
) -> AccountFigures:
    start, end = month_range(month)
    return balances.figures(db, [get_account(db, ctx, account_id)], start, end, today())[0]
