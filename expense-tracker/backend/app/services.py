"""Shared domain logic used by routers, the CLI and tests."""

import uuid
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AppSetting, Category, CategoryRule, CategoryTemplate, Household


def create_household(db: Session, name: str) -> Household:
    """New household with a copy of the category template and no accounts.

    The template comes from config/seed.yaml (new_household) and the Admin page; it is empty
    unless you fill it, so new people start fresh. The admin's household is filled by the seed.
    """
    household = Household(id=uuid.uuid4(), name=name)
    db.add(household)
    db.flush()
    db.add_all(
        Category(
            household_id=household.id,
            kind=t.kind,
            parent_name=t.parent_name,
            sub_name=t.sub_name,
            stats_group=t.stats_group,
            sort_order=t.sort_order,
        )
        for t in db.scalars(select(CategoryTemplate).order_by(CategoryTemplate.sort_order))
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
