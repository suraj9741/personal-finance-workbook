"""Deploy-time seed from config/seed.yaml.

Add-only: an item is inserted when the database doesn't have it and the seed has never
handled it before (seed_log). Nothing is updated or deleted, so edits made in the app win,
and an account or category deleted in the app is not added back on the next deploy.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from pathlib import Path
from typing import Annotated, Literal

import structlog
import yaml
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import (
    Account,
    AppSetting,
    Category,
    CategoryTemplate,
    HouseholdMember,
    SeedLog,
    User,
)

log = structlog.get_logger("app.seed")

Kind = Literal["expense", "income", "transfer"]
Group = Literal["spend", "saving", "lent", "earned", "repaid", "transfer"]
PayType = Literal["bank", "credit_card", "share_broker", "cash"]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
DEFAULT_GROUP: dict[str, Group] = {"expense": "spend", "income": "earned", "transfer": "transfer"}


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class CategoryItem(Strict):
    name: Name
    counts_as: Group | None = None


class CategoryGroup(Strict):
    counts_as: Group | None = None
    items: list[Name | CategoryItem]


class AccountItem(Strict):
    name: Name
    opening_balance: Decimal = Decimal("0")


Categories = dict[Kind, dict[Name, list[Name | CategoryItem] | CategoryGroup]]


class HouseholdSeed(Strict):
    accounts: dict[PayType, list[Name | AccountItem]] = Field(default_factory=dict)
    categories: Categories = Field(default_factory=dict)
    # Category groups to tick as family (Settings > Categories), once, like everything else here.
    family: list[Name] = Field(default_factory=list)


class TemplateSeed(Strict):
    categories: Categories = Field(default_factory=dict)


class SeedConfig(Strict):
    settings: dict[str, str] = Field(default_factory=dict)
    admin_household: HouseholdSeed = Field(default_factory=HouseholdSeed)
    new_household: TemplateSeed = Field(default_factory=TemplateSeed)


def load(path: str | Path) -> SeedConfig:
    raw = yaml.safe_load(Path(path).read_text()) or {}
    return SeedConfig.model_validate(raw)


def flat_categories(categories: Categories) -> list[tuple[Kind, str, str, Group]]:
    """(kind, parent, sub, stats_group) in file order."""
    rows = []
    for kind, parents in categories.items():
        for parent, value in parents.items():
            group = value if isinstance(value, CategoryGroup) else CategoryGroup(items=value)
            for entry in group.items:
                item = entry if isinstance(entry, CategoryItem) else CategoryItem(name=entry)
                stats = item.counts_as or group.counts_as or DEFAULT_GROUP[kind]
                if (kind == "transfer") != (stats == "transfer"):
                    raise ValueError(f"{parent} > {item.name}: only transfers count as transfer")
                rows.append((kind, parent, item.name, stats))
    return rows


def flat_accounts(
    accounts: dict[PayType, list[Name | AccountItem]],
) -> list[tuple[PayType, AccountItem]]:
    return [
        (pay_type, a if isinstance(a, AccountItem) else AccountItem(name=a))
        for pay_type, items in accounts.items()
        for a in items
    ]


class _Log:
    def __init__(self, db: Session, scope: str) -> None:
        self.db, self.scope = db, scope
        self.done = set(db.scalars(select(SeedLog.item).where(SeedLog.scope == scope)))

    def should_add(self, item: str, exists: bool) -> bool:
        """True when the item is new to both the database and the seed's memory."""
        if item in self.done:
            return False
        self.db.add(SeedLog(scope=self.scope, item=item))
        self.done.add(item)
        return not exists


def admin_household_ids(db: Session) -> list[uuid.UUID]:
    return list(
        db.scalars(
            select(HouseholdMember.household_id)
            .join(User, User.id == HouseholdMember.user_id)
            .where(User.is_site_admin.is_(True))
            .distinct()
        )
    )


def seed_household(db: Session, household_id: uuid.UUID, seed: HouseholdSeed) -> dict[str, int]:
    seen = _Log(db, str(household_id))
    added = {"accounts": 0, "categories": 0}
    have_accounts = {
        (a.pay_type, a.name.lower())
        for a in db.scalars(select(Account).where(Account.household_id == household_id))
    }
    for pay_type, account in flat_accounts(seed.accounts):
        exists = (pay_type, account.name.lower()) in have_accounts
        if seen.should_add(f"account:{pay_type}:{account.name.lower()}", exists):
            db.add(
                Account(
                    household_id=household_id,
                    name=account.name,
                    pay_type=pay_type,
                    opening_balance=account.opening_balance,
                )
            )
            added["accounts"] += 1
    have_categories = {
        (c.kind, c.parent_name, c.sub_name)
        for c in db.scalars(select(Category).where(Category.household_id == household_id))
    }
    for order, (kind, parent, sub, stats) in enumerate(flat_categories(seed.categories), 1):
        exists = (kind, parent, sub) in have_categories
        if seen.should_add(f"category:{kind}:{parent}:{sub}", exists):
            db.add(
                Category(
                    household_id=household_id,
                    kind=kind,
                    parent_name=parent,
                    sub_name=sub,
                    stats_group=stats,
                    sort_order=order,
                )
            )
            added["categories"] += 1
    db.flush()
    # A group is ticked the first time the config names it; unticking it in the app sticks.
    for parent in seed.family:
        if seen.should_add(f"family:{parent.lower()}", False):
            for category in db.scalars(
                select(Category).where(
                    Category.household_id == household_id,
                    Category.parent_name == parent,
                    Category.kind != "transfer",
                )
            ):
                category.is_family = True
    return added


def seed_template(db: Session, seed: TemplateSeed) -> int:
    seen = _Log(db, "template")
    have = {(t.kind, t.parent_name, t.sub_name) for t in db.scalars(select(CategoryTemplate))}
    added = 0
    for order, (kind, parent, sub, stats) in enumerate(flat_categories(seed.categories), 1):
        exists = (kind, parent, sub) in have
        if seen.should_add(f"category:{kind}:{parent}:{sub}", exists):
            db.add(
                CategoryTemplate(
                    kind=kind, parent_name=parent, sub_name=sub, stats_group=stats, sort_order=order
                )
            )
            added += 1
    return added


def apply(db: Session, config: SeedConfig) -> dict[str, int]:
    """Apply the whole config and commit. Safe to run on every deploy."""
    totals = {"settings": 0, "template_categories": 0, "accounts": 0, "categories": 0}
    for key, value in config.settings.items():
        if db.get(AppSetting, key) is None:
            db.add(AppSetting(key=key, value=value))
            totals["settings"] += 1
    totals["template_categories"] = seed_template(db, config.new_household)
    for household_id in admin_household_ids(db):
        for name, count in seed_household(db, household_id, config.admin_household).items():
            totals[name] += count
    db.commit()
    log.info("seed applied", **totals)
    return totals
