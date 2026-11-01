import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from prometheus_client import Counter
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import Ctx, get_ctx, not_found
from app.models import Account, Category, CategoryRule, Transaction, User
from app.routers.catalog import can_manage, ensure_unique_pattern, get_account, get_category
from app.schemas import (
    Kind,
    Month,
    RuleOut,
    SuggestionOut,
    TransactionIn,
    TransactionOut,
    TransactionPage,
    TransactionPatchIn,
    TxType,
)
from app.services import add_months, match_rule

router = APIRouter(prefix="/transactions", tags=["transactions"])

CREATED = Counter("transactions_created_total", "Transactions created", ["type"])
for _label in ("expense", "income", "transfer", "refund", "buy", "sell"):
    CREATED.labels(_label)  # export zeros from boot


def month_range(month: str) -> tuple[date, date]:
    start = date(int(month[:4]), int(month[5:7]), 1)
    return start, add_months(start, 1)


# The category kind each transaction type takes. Buys and sells take none.
CATEGORY_KIND = {
    "expense": "expense",
    "income": "income",
    "transfer": "transfer",
    "refund": "expense",
}


def posted_on_allowed(account: Account, tx_type: str) -> bool:
    return account.pay_type == "credit_card" and tx_type in ("expense", "refund")


def check_own_accounts(
    db: Session, ctx: Ctx, row: Transaction, before: tuple[object, object] = (None, None)
) -> None:
    """Entries go only on your own accounts: a shared account is for the household to see,
    not to write on for its owner. Accounts an edit leaves as they were aren't checked, so
    the household owner can still fix a member's entry on the member's account."""
    for account_id, old in ((row.account_id, before[0]), (row.to_account_id, before[1])):
        if account_id is None or account_id == old:
            continue
        if not can_manage(ctx, get_account(db, ctx, account_id)):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "You can only add entries on your own accounts"
            )


def validate(db: Session, ctx: Ctx, row: Transaction) -> None:
    """Rules the database can't express: visibility, household and kind matching."""
    account = get_account(db, ctx, row.account_id)
    if row.type in ("buy", "sell"):
        if account.pay_type != "share_broker":
            raise HTTPException(422, "Buys and sells are on share market broker accounts")
        if row.category_id is not None:
            raise HTTPException(422, "Buys and sells don't take a category")
    if row.cost_basis is not None and row.type != "sell":
        raise HTTPException(422, "Only a sell has a cost basis")
    if row.posted_on is not None:
        if not posted_on_allowed(account, row.type):
            raise HTTPException(422, "Only a card purchase or refund has a posted date")
        if row.posted_on < row.date:
            raise HTTPException(422, "The posted date can't be before the purchase date")
    if row.type == "transfer":
        if row.to_account_id is None:
            raise HTTPException(422, "A transfer needs a 'to' account")
        if row.to_account_id == row.account_id:
            raise HTTPException(422, "Transfer accounts must differ")
        get_account(db, ctx, row.to_account_id)
    elif row.to_account_id is not None:
        raise HTTPException(422, "Only transfers have a 'to' account")
    if row.category_id is not None:
        category = get_category(db, ctx, row.category_id)
        if category.kind != CATEGORY_KIND.get(row.type):
            raise HTTPException(422, f"Category is for {category.kind}, not {row.type}")


def to_out(
    row: Transaction, names: dict[uuid.UUID, str], editable: set[uuid.UUID]
) -> TransactionOut:
    out = TransactionOut.model_validate(row)
    out.created_by_name = names.get(row.created_by) if row.created_by else None
    out.can_edit = row.id in editable
    return out


def editable_ids(db: Session, ctx: Ctx, rows: list[Transaction]) -> set[uuid.UUID]:
    if not rows:
        return set()
    query = select(Transaction.id).where(
        Transaction.id.in_([r.id for r in rows]), ctx.editable_transaction()
    )
    return set(db.scalars(query))


def user_names(db: Session, rows: list[Transaction]) -> dict[uuid.UUID, str]:
    ids = {r.created_by for r in rows if r.created_by}
    if not ids:
        return {}
    return dict(db.execute(select(User.id, User.display_name).where(User.id.in_(ids))).all())


def get_visible(db: Session, ctx: Ctx, transaction_id: uuid.UUID) -> Transaction:
    row = db.scalar(
        select(Transaction).where(Transaction.id == transaction_id, ctx.visible_transaction())
    )
    if row is None:
        raise not_found("Transaction not found")
    return row


def get_editable(db: Session, ctx: Ctx, transaction_id: uuid.UUID) -> Transaction:
    """404 when the row isn't visible, 403 when it is but someone else added it."""
    row = get_visible(db, ctx, transaction_id)
    if not editable_ids(db, ctx, [row]):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only the person who added this entry can change it"
        )
    return row


@router.get("", response_model=TransactionPage)
def list_transactions(
    month: Month | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    type: TxType | None = None,
    category_id: uuid.UUID | None = None,
    # A whole group ("Everyday" of the expense categories): every category under it.
    category_group: str | None = Query(None, max_length=60),
    category_kind: Kind = "expense",
    account_id: uuid.UUID | None = None,
    created_by: uuid.UUID | None = None,
    uncategorized: bool = False,
    scope: str = Query("household", pattern="^(household|me)$"),
    q: str | None = Query(None, max_length=100),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    ctx: Ctx = Depends(get_ctx),
    db: Session = Depends(get_db),
) -> TransactionPage:
    conditions = [ctx.visible_transaction()]
    if scope == "me":
        conditions.append(ctx.just_me())
    if month:
        start, end = month_range(month)
        conditions += [Transaction.date >= start, Transaction.date < end]
    if date_from:
        conditions.append(Transaction.date >= date_from)
    if date_to:
        conditions.append(Transaction.date <= date_to)
    if type:
        conditions.append(Transaction.type == type)
    if category_id:
        conditions.append(Transaction.category_id == category_id)
    if category_group:
        conditions.append(
            Transaction.category_id.in_(
                select(Category.id).where(
                    Category.household_id == ctx.household_id,
                    Category.kind == category_kind,
                    Category.parent_name == category_group,
                )
            )
        )
    if uncategorized:
        conditions += [
            Transaction.category_id.is_(None),
            Transaction.type.in_(("expense", "income", "refund")),
        ]
    if account_id:
        conditions.append(
            (Transaction.account_id == account_id) | (Transaction.to_account_id == account_id)
        )
    if created_by:
        conditions.append(Transaction.created_by == created_by)
    if q:
        like = f"%{q.replace('%', r'\%').replace('_', r'\_')}%"
        conditions.append(
            Transaction.description.ilike(like) | Transaction.counterparty.ilike(like)
        )
    total = db.scalar(select(func.count()).select_from(Transaction).where(*conditions)) or 0
    rows = list(
        db.scalars(
            select(Transaction)
            .where(*conditions)
            .order_by(Transaction.date.desc(), Transaction.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
    )
    names, editable = user_names(db, rows), editable_ids(db, ctx, rows)
    return TransactionPage(items=[to_out(r, names, editable) for r in rows], total=total)


@router.post("", response_model=TransactionOut, status_code=status.HTTP_201_CREATED)
def create_transaction(
    body: TransactionIn, ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)
) -> TransactionOut:
    row = Transaction(
        household_id=ctx.household_id,
        created_by=ctx.user.id,
        source="manual",
        **body.model_dump(),
    )
    if "category_id" not in body.model_fields_set and row.type in ("expense", "income", "refund"):
        category = match_rule(db, ctx.household_id, row.description, CATEGORY_KIND[row.type])
        row.category_id = category.id if category else None
    validate(db, ctx, row)
    check_own_accounts(db, ctx, row)
    db.add(row)
    db.commit()
    CREATED.labels(row.type).inc()
    return to_out(row, {ctx.user.id: ctx.user.display_name}, {row.id})


@router.get("/suggest", response_model=list[SuggestionOut])
def suggest(
    q: str = Query(..., min_length=1, max_length=100),
    ctx: Ctx = Depends(get_ctx),
    db: Session = Depends(get_db),
) -> list[SuggestionOut]:
    """Past descriptions starting with q, each with its most recent category/account/amount."""
    prefix = q.replace("%", r"\%").replace("_", r"\_") + "%"
    latest = (
        select(Transaction)
        .where(ctx.visible_transaction(), Transaction.description.ilike(prefix))
        .ext(distinct_on(func.lower(Transaction.description)))
        .order_by(
            func.lower(Transaction.description),
            Transaction.date.desc(),
            Transaction.created_at.desc(),
        )
        .subquery()
    )
    rows = db.execute(select(latest).order_by(latest.c.date.desc()).limit(8)).all()
    return [
        SuggestionOut(
            description=r.description,
            type=r.type,
            category_id=r.category_id,
            account_id=r.account_id,
            amount=r.amount,
        )
        for r in rows
    ]


@router.get("/{transaction_id}", response_model=TransactionOut)
def get_transaction(
    transaction_id: uuid.UUID, ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)
) -> TransactionOut:
    row = get_visible(db, ctx, transaction_id)
    return to_out(row, user_names(db, [row]), editable_ids(db, ctx, [row]))


@router.patch("/{transaction_id}", response_model=TransactionOut)
def patch_transaction(
    transaction_id: uuid.UUID,
    body: TransactionPatchIn,
    ctx: Ctx = Depends(get_ctx),
    db: Session = Depends(get_db),
) -> TransactionOut:
    row = get_editable(db, ctx, transaction_id)
    before = (row.account_id, row.to_account_id)
    changes = body.model_dump(exclude_unset=True)
    for field, value in changes.items():
        if value is None and field in {"date", "amount", "type", "account_id", "description"}:
            raise HTTPException(422, f"{field} can't be empty")
        setattr(row, field, value)
    if changes.get("type") and changes["type"] != "transfer" and "to_account_id" not in changes:
        row.to_account_id = None
    if changes.get("type") and changes["type"] != "sell" and "cost_basis" not in changes:
        row.cost_basis = None
    # A posted date that no longer fits (moved off the card, or the purchase date moved past
    # it) is dropped rather than refused, like the 'to' account and cost basis above.
    if row.posted_on is not None and "posted_on" not in changes:
        with db.no_autoflush:
            account = get_account(db, ctx, row.account_id)
        if not posted_on_allowed(account, row.type) or row.posted_on < row.date:
            row.posted_on = None
    validate(db, ctx, row)
    check_own_accounts(db, ctx, row, before)
    db.commit()
    db.refresh(row)
    return to_out(row, user_names(db, [row]), {row.id})


@router.delete("/{transaction_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transaction(
    transaction_id: uuid.UUID, ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)
) -> None:
    db.delete(get_editable(db, ctx, transaction_id))
    db.commit()


@router.post(
    "/{transaction_id}/make-rule", response_model=RuleOut, status_code=status.HTTP_201_CREATED
)
def make_rule(
    transaction_id: uuid.UUID, ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)
) -> CategoryRule:
    """Future entries with this description get this row's category automatically."""
    row = get_visible(db, ctx, transaction_id)
    pattern = row.description.strip().lower()
    if row.category_id is None or len(pattern) < 2:
        raise HTTPException(422, "Give the entry a category and a description first")
    if db.get(Category, row.category_id) is None:
        raise not_found("Category not found")
    ensure_unique_pattern(db, ctx, pattern)
    rule = CategoryRule(
        household_id=ctx.household_id,
        pattern=pattern,
        category_id=row.category_id,
        created_by=ctx.user.id,
    )
    db.add(rule)
    db.commit()
    return rule
