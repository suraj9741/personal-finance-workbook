"""Shared domain logic used by routers, the CLI and tests."""

import json
import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Account, AppSetting, Category, CategoryRule, CategoryTemplate, Household

CATEGORIES_JSON = Path(__file__).parent / "data" / "categories.json"
ACCOUNTS_JSON = Path(__file__).parent / "data" / "accounts.json"

# What a new, unrelated household starts with. The first admin's household gets every
# account from the finance script instead (see full_account_list).
DEFAULT_ACCOUNTS = [("HDFC", "bank", "0"), ("Yes Bank", "credit_card", "0"), ("Cash", "cash", "0")]


def full_category_list() -> list[dict[str, object]]:
    """Every category from the Apps Script Defaults.gs, family categories included."""
    rows: list[dict[str, object]] = json.loads(CATEGORIES_JSON.read_text())
    return rows


def full_account_list() -> list[dict[str, str]]:
    """Every account from the Apps Script Defaults.gs (SEED.PAY)."""
    rows: list[dict[str, str]] = json.loads(ACCOUNTS_JSON.read_text())
    return rows


def create_household(db: Session, name: str, *, full_seed: bool = False) -> Household:
    """New household with its own categories and accounts.

    full_seed: the first admin's household. It gets everything in the finance script,
    family categories and all accounts. Other households get the template and the basics.
    """
    household = Household(id=uuid.uuid4(), name=name)
    db.add(household)
    db.flush()
    if full_seed:
        source = [
            (r["kind"], r["parent_name"], r["sub_name"], r["stats_group"], r["sort_order"])
            for r in full_category_list()
        ]
    else:
        source = [
            (t.kind, t.parent_name, t.sub_name, t.stats_group, t.sort_order)
            for t in db.scalars(select(CategoryTemplate).order_by(CategoryTemplate.sort_order))
        ]
    db.add_all(
        Category(
            household_id=household.id,
            kind=str(kind),
            parent_name=str(parent),
            sub_name=str(sub),
            stats_group=str(group),
            sort_order=int(str(order)),
        )
        for kind, parent, sub, group, order in source
    )
    accounts = (
        [(a["name"], a["pay_type"], a["opening_balance"]) for a in full_account_list()]
        if full_seed
        else DEFAULT_ACCOUNTS
    )
    db.add_all(
        Account(
            household_id=household.id,
            name=acc_name,
            pay_type=pay_type,
            opening_balance=Decimal(opening),
        )
        for acc_name, pay_type, opening in accounts
    )
    db.flush()
    return household


def match_rule(
    db: Session, household_id: uuid.UUID, description: str, kind: str
) -> Category | None:
    """First rule (lowest priority number, then oldest) whose pattern is in the description."""
    text = description.lower()
    if not text:
        return None
    rules = db.execute(
        select(CategoryRule, Category)
        .join(Category, Category.id == CategoryRule.category_id)
        .where(
            CategoryRule.household_id == household_id,
            Category.kind == kind,
            Category.is_active.is_(True),
        )
        .order_by(CategoryRule.priority, CategoryRule.created_at)
    ).all()
    for rule, category in rules:
        if rule.pattern.lower() in text:
            return category
    return None


def get_setting(db: Session, key: str, default: str) -> str:
    row = db.get(AppSetting, key)
    return row.value if row else default


def month_start(value: date) -> date:
    return value.replace(day=1)


def add_months(value: date, months: int) -> date:
    index = value.year * 12 + value.month - 1 + months
    return date(index // 12, index % 12 + 1, 1)
