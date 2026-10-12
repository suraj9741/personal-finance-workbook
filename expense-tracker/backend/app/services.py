"""Shared domain logic used by routers, the CLI and tests."""

import json
import uuid
from datetime import date
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Account, AppSetting, Category, CategoryRule, CategoryTemplate, Household

CATEGORIES_JSON = Path(__file__).parent / "data" / "categories.json"

DEFAULT_ACCOUNTS = [("HDFC", "bank"), ("Yes Bank", "credit_card"), ("Cash", "cash")]


def full_category_list() -> list[dict[str, object]]:
    """Every category from the Apps Script Defaults.gs, family categories included."""
    rows: list[dict[str, object]] = json.loads(CATEGORIES_JSON.read_text())
    return rows


def create_household(
    db: Session, name: str, *, include_family_categories: bool = False
) -> Household:
    """New household with its own copy of the categories and the default accounts."""
    household = Household(id=uuid.uuid4(), name=name)
    db.add(household)
    db.flush()
    if include_family_categories:
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
    db.add_all(
        Account(household_id=household.id, name=acc_name, pay_type=pay_type)
        for acc_name, pay_type in DEFAULT_ACCOUNTS
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
