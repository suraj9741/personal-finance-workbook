"""Categories, accounts and auto-categorization rules for the current household."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import exists, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import Ctx, get_ctx, not_found, require_owner
from app.models import Account, Category, CategoryRule, Transaction
from app.schemas import (
    AccountIn,
    AccountOut,
    AccountPatchIn,
    CategoryIn,
    CategoryOut,
    CategoryPatchIn,
    FamilyGroupIn,
    RuleIn,
    RuleOut,
    RulePatchIn,
)

router = APIRouter(tags=["catalog"])

DEFAULT_GROUP = {"expense": "spend", "income": "earned", "transfer": "transfer"}


def conflict(message: str) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, message)


def commit_or_conflict(db: Session, message: str) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise conflict(message) from exc


# ---- categories -----------------------------------------------------------------------


def get_category(db: Session, ctx: Ctx, category_id: uuid.UUID) -> Category:
    category = db.get(Category, category_id)
    if category is None or category.household_id != ctx.household_id:
        raise not_found("Category not found")
    return category


@router.get("/categories", response_model=list[CategoryOut])
def list_categories(
    include_inactive: bool = False, ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)
) -> list[Category]:
    query = select(Category).where(Category.household_id == ctx.household_id)
    if not include_inactive:
        query = query.where(Category.is_active.is_(True))
    return list(db.scalars(query.order_by(Category.sort_order, Category.parent_name)))


@router.post("/categories", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
def create_category(
    body: CategoryIn, ctx: Ctx = Depends(require_owner), db: Session = Depends(get_db)
) -> Category:
    group = body.stats_group or DEFAULT_GROUP[body.kind]
    if (body.kind == "transfer") != (group == "transfer"):
        raise HTTPException(422, "Transfer categories use the transfer group, and only they do")
    category = Category(
        household_id=ctx.household_id,
        kind=body.kind,
        parent_name=body.parent_name,
        sub_name=body.sub_name,
        stats_group=group,
        sort_order=body.sort_order,
    )
    db.add(category)
    commit_or_conflict(db, "That category already exists")
    return category


@router.patch("/categories/{category_id}", response_model=CategoryOut)
def patch_category(
    category_id: uuid.UUID,
    body: CategoryPatchIn,
    ctx: Ctx = Depends(require_owner),
    db: Session = Depends(get_db),
) -> Category:
    category = get_category(db, ctx, category_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(category, field, value)
    if (category.kind == "transfer") != (category.stats_group == "transfer"):
        raise HTTPException(422, "Transfer categories use the transfer group, and only they do")
    commit_or_conflict(db, "That category already exists")
    return category


@router.put("/categories/family", response_model=list[CategoryOut])
def set_family_group(
    body: FamilyGroupIn, ctx: Ctx = Depends(require_owner), db: Session = Depends(get_db)
) -> list[Category]:
    """Tick or untick a whole group as family: its expense and its income categories alike."""
    categories = list(
        db.scalars(
            select(Category).where(
                Category.household_id == ctx.household_id,
                Category.parent_name == body.parent_name,
                Category.kind != "transfer",
            )
        )
    )
    if not categories:
        raise not_found("Category group not found")
    for category in categories:
        category.is_family = body.is_family
    db.commit()
    return categories


@router.delete("/categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_category(
    category_id: uuid.UUID, ctx: Ctx = Depends(require_owner), db: Session = Depends(get_db)
) -> None:
    category = get_category(db, ctx, category_id)
    if db.scalar(select(exists().where(Transaction.category_id == category.id))):
        raise conflict("Category is used by transactions. Deactivate it instead.")
    db.delete(category)
    db.commit()


# ---- accounts -------------------------------------------------------------------------


def get_account(db: Session, ctx: Ctx, account_id: uuid.UUID) -> Account:
    """404 for other households and for other members' private accounts."""
    account = db.scalar(select(Account).where(Account.id == account_id, ctx.visible_account()))
    if account is None:
        raise not_found("Account not found")
    return account


def can_manage(ctx: Ctx, account: Account) -> bool:
    if account.visibility == "private":
        return account.owner_user_id == ctx.user.id
    return ctx.is_owner


CARD_FIELDS = ("credit_limit", "statement_day", "due_day")
BROKER_FIELDS = ("opening_invested", "current_value", "valued_on")
REQUIRED_FIELDS = ("name", "opening_balance", "is_active")


def check_type_fields(pay_type: str, values: dict[str, object]) -> None:
    """Card fields only on cards and broker fields only on brokers (the DB checks this too)."""
    for fields, owner, label in (
        (CARD_FIELDS, "credit_card", "credit cards"),
        (BROKER_FIELDS, "share_broker", "share market brokers"),
    ):
        if pay_type != owner:
            used = [f for f in fields if values.get(f) not in (None, 0)]
            if used:
                raise HTTPException(422, f"{', '.join(used)} only apply to {label}")


@router.get("/accounts", response_model=list[AccountOut])
def list_accounts(
    include_inactive: bool = False, ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)
) -> list[Account]:
    query = select(Account).where(ctx.visible_account())
    if not include_inactive:
        query = query.where(Account.is_active.is_(True))
    return list(db.scalars(query.order_by(Account.pay_type, Account.name)))


@router.get("/accounts/{account_id}", response_model=AccountOut)
def read_account(
    account_id: uuid.UUID, ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)
) -> Account:
    return get_account(db, ctx, account_id)


@router.post("/accounts", response_model=AccountOut, status_code=status.HTTP_201_CREATED)
def create_account(
    body: AccountIn, ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)
) -> Account:
    # Anyone may add their own private account; shared accounts are the owner's call.
    if body.visibility == "shared" and not ctx.is_owner:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only the household owner adds shared accounts"
        )
    values = body.model_dump()
    check_type_fields(body.pay_type, values)
    values["opening_invested"] = values["opening_invested"] or 0
    account = Account(household_id=ctx.household_id, owner_user_id=ctx.user.id, **values)
    db.add(account)
    commit_or_conflict(db, "An account with that name and type already exists")
    return account


@router.patch("/accounts/{account_id}", response_model=AccountOut)
def patch_account(
    account_id: uuid.UUID,
    body: AccountPatchIn,
    ctx: Ctx = Depends(get_ctx),
    db: Session = Depends(get_db),
) -> Account:
    account = get_account(db, ctx, account_id)
    if not can_manage(ctx, account):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can't change this account")
    changes = body.model_dump(exclude_unset=True)
    check_type_fields(account.pay_type, changes)
    for field, value in changes.items():
        if value is None and field in REQUIRED_FIELDS:
            continue
        if value is None and field == "opening_invested":
            value = 0
        setattr(account, field, value)
    commit_or_conflict(db, "An account with that name and type already exists")
    return account


@router.delete("/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(
    account_id: uuid.UUID, ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)
) -> None:
    account = get_account(db, ctx, account_id)
    if not can_manage(ctx, account):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can't delete this account")
    used = select(
        exists().where(
            or_(Transaction.account_id == account.id, Transaction.to_account_id == account.id)
        )
    )
    if db.scalar(used):
        raise conflict("Account has transactions. Deactivate it instead.")
    db.delete(account)
    db.commit()


# ---- rules ----------------------------------------------------------------------------


def get_rule(db: Session, ctx: Ctx, rule_id: uuid.UUID) -> CategoryRule:
    rule = db.get(CategoryRule, rule_id)
    if rule is None or rule.household_id != ctx.household_id:
        raise not_found("Rule not found")
    return rule


@router.get("/rules", response_model=list[RuleOut])
def list_rules(ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)) -> list[CategoryRule]:
    return list(
        db.scalars(
            select(CategoryRule)
            .where(CategoryRule.household_id == ctx.household_id)
            .order_by(CategoryRule.priority, CategoryRule.created_at)
        )
    )


def ensure_unique_pattern(
    db: Session, ctx: Ctx, pattern: str, exclude: uuid.UUID | None = None
) -> None:
    query = select(CategoryRule).where(
        CategoryRule.household_id == ctx.household_id, CategoryRule.pattern.ilike(pattern)
    )
    if exclude:
        query = query.where(CategoryRule.id != exclude)
    if db.scalar(query):
        raise conflict("A rule with this pattern already exists")


@router.post("/rules", response_model=RuleOut, status_code=status.HTTP_201_CREATED)
def create_rule(
    body: RuleIn, ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)
) -> CategoryRule:
    get_category(db, ctx, body.category_id)
    ensure_unique_pattern(db, ctx, body.pattern)
    rule = CategoryRule(
        household_id=ctx.household_id,
        pattern=body.pattern,
        category_id=body.category_id,
        priority=body.priority,
        created_by=ctx.user.id,
    )
    db.add(rule)
    db.commit()
    return rule


@router.patch("/rules/{rule_id}", response_model=RuleOut)
def patch_rule(
    rule_id: uuid.UUID,
    body: RulePatchIn,
    ctx: Ctx = Depends(get_ctx),
    db: Session = Depends(get_db),
) -> CategoryRule:
    rule = get_rule(db, ctx, rule_id)
    if not (ctx.is_owner or rule.created_by == ctx.user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can't change this rule")
    if body.category_id is not None:
        get_category(db, ctx, body.category_id)
        rule.category_id = body.category_id
    if body.pattern is not None:
        ensure_unique_pattern(db, ctx, body.pattern, exclude=rule.id)
        rule.pattern = body.pattern
    if body.priority is not None:
        rule.priority = body.priority
    db.commit()
    return rule


@router.delete("/rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_rule(
    rule_id: uuid.UUID, ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)
) -> None:
    rule = get_rule(db, ctx, rule_id)
    if not (ctx.is_owner or rule.created_by == ctx.user.id):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "You can't delete this rule")
    db.delete(rule)
    db.commit()


@router.post("/rules/apply")
def apply_rules(ctx: Ctx = Depends(get_ctx), db: Session = Depends(get_db)) -> dict[str, int]:
    """Fill in categories on visible uncategorized expense/income rows."""
    from app.services import match_rule

    rows = db.scalars(
        select(Transaction).where(
            ctx.visible_transaction(),
            Transaction.category_id.is_(None),
            Transaction.type.in_(("expense", "income")),
        )
    ).all()
    updated = 0
    for row in rows:
        category = match_rule(db, ctx.household_id, row.description, row.type)
        if category is not None:
            row.category_id = category.id
            updated += 1
    db.commit()
    return {"updated": updated}
