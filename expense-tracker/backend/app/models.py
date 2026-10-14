import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    true,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

KINDS = ("expense", "income", "transfer")
# A refund takes money back on an expense category. Buy and sell move a broker account's
# cash into and out of securities; they are neither income nor expense.
TX_TYPES = (*KINDS, "refund", "buy", "sell")
STATS_GROUPS = ("spend", "saving", "lent", "earned", "repaid", "transfer")
PAY_TYPES = ("bank", "credit_card", "share_broker", "cash")


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(v) for v in values)})"


class Base(DeclarativeBase):
    pass


def uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(primary_key=True, default=uuid.uuid4)


def created_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now())


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = uuid_pk()
    email: Mapped[str] = mapped_column(String(254), unique=True)
    display_name: Mapped[str] = mapped_column(String(100))
    password_hash: Mapped[str] = mapped_column(String(255))
    is_site_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = created_at()


class Household(Base):
    __tablename__ = "households"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(100))
    created_at: Mapped[datetime] = created_at()


class HouseholdMember(Base):
    __tablename__ = "household_members"
    __table_args__ = (CheckConstraint("role IN ('owner', 'member')", name="role_valid"),)

    household_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), primary_key=True
    )
    # Unique: one household per user in Phase 1.
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True, unique=True
    )
    role: Mapped[str] = mapped_column(String(10), default="member")
    joined_at: Mapped[datetime] = created_at()


class UserSession(Base):
    __tablename__ = "sessions"

    # SHA-256 of the cookie token; the raw token is never stored.
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    created_at: Mapped[datetime] = created_at()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class LoginAttempt(Base):
    __tablename__ = "login_attempts"
    __table_args__ = (Index("ix_login_attempts_email_at", "email", "attempted_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(254))
    succeeded: Mapped[bool] = mapped_column(Boolean)
    attempted_at: Mapped[datetime] = created_at()


class Invite(Base):
    __tablename__ = "invites"
    __table_args__ = (CheckConstraint("role IN ('owner', 'member')", name="role_valid"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    # NULL household: the person who accepts gets a new household of their own.
    household_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE")
    )
    new_household_name: Mapped[str | None] = mapped_column(String(100))
    role: Mapped[str] = mapped_column(String(10), default="member")
    note: Mapped[str | None] = mapped_column(String(200))
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = created_at()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    used_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))


class PasswordReset(Base):
    __tablename__ = "password_resets"

    id: Mapped[uuid.UUID] = uuid_pk()
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = created_at()
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class CategoryTemplate(Base):
    """Default categories copied into each new household. Managed on the admin page."""

    __tablename__ = "category_templates"
    __table_args__ = (
        UniqueConstraint("kind", "parent_name", "sub_name", name="uq_category_templates_name"),
        CheckConstraint(_in("kind", KINDS), name="kind_valid"),
        CheckConstraint(_in("stats_group", STATS_GROUPS), name="stats_group_valid"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    kind: Mapped[str] = mapped_column(String(10))
    parent_name: Mapped[str] = mapped_column(String(60))
    sub_name: Mapped[str] = mapped_column(String(60))
    stats_group: Mapped[str] = mapped_column(String(10))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Category(Base):
    __tablename__ = "categories"
    __table_args__ = (
        UniqueConstraint(
            "household_id", "kind", "parent_name", "sub_name", name="uq_categories_name"
        ),
        CheckConstraint(_in("kind", KINDS), name="kind_valid"),
        CheckConstraint(_in("stats_group", STATS_GROUPS), name="stats_group_valid"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String(10))
    parent_name: Mapped[str] = mapped_column(String(60))
    sub_name: Mapped[str] = mapped_column(String(60))
    stats_group: Mapped[str] = mapped_column(String(10))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (
        UniqueConstraint("household_id", "name", "pay_type", name="uq_accounts_name"),
        CheckConstraint(_in("pay_type", PAY_TYPES), name="pay_type_valid"),
        CheckConstraint("visibility IN ('shared', 'private')", name="visibility_valid"),
        CheckConstraint(
            "visibility = 'shared' OR owner_user_id IS NOT NULL", name="private_has_owner"
        ),
        CheckConstraint(
            "pay_type = 'credit_card' OR "
            "(credit_limit IS NULL AND statement_day IS NULL AND due_day IS NULL)",
            name="card_fields_on_cards",
        ),
        CheckConstraint(
            "pay_type = 'share_broker' OR "
            "(current_value IS NULL AND valued_on IS NULL AND opening_invested = 0)",
            name="broker_fields_on_brokers",
        ),
        CheckConstraint("credit_limit IS NULL OR credit_limit >= 0", name="credit_limit_valid"),
        CheckConstraint("statement_day BETWEEN 1 AND 31", name="statement_day_valid"),
        CheckConstraint("due_day BETWEEN 1 AND 31", name="due_day_valid"),
        CheckConstraint("opening_invested >= 0", name="opening_invested_valid"),
        CheckConstraint("current_value IS NULL OR current_value >= 0", name="current_value_valid"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), index=True
    )
    # The display name; renaming never touches transactions, which link by id.
    name: Mapped[str] = mapped_column(String(60))
    # Bank, card issuer or broker, e.g. "HDFC Bank" for both "HDFC" and "HDFC CC".
    institution: Mapped[str | None] = mapped_column(String(60))
    description: Mapped[str | None] = mapped_column(String(500))
    pay_type: Mapped[str] = mapped_column(String(15))
    # Bank, cash and broker: money held on opening_date. Credit card: amount owed then.
    opening_balance: Mapped[Decimal] = mapped_column(Numeric(12, 2), default=Decimal("0"))
    # Set: only transactions on or after it count toward the balance. NULL: all of them.
    opening_date: Mapped[date | None] = mapped_column(Date)
    credit_limit: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    statement_day: Mapped[int | None] = mapped_column(SmallInteger)
    due_day: Mapped[int | None] = mapped_column(SmallInteger)
    # Broker: cost of holdings already owned on opening_date.
    opening_invested: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), default=Decimal("0"), server_default="0"
    )
    # Broker: the latest value the user entered. Never fetched or estimated.
    current_value: Mapped[Decimal | None] = mapped_column(Numeric(14, 2))
    valued_on: Mapped[date | None] = mapped_column(Date)
    visibility: Mapped[str] = mapped_column(String(10), default="shared")
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = created_at()


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint(_in("type", TX_TYPES), name="type_valid"),
        CheckConstraint(
            "cost_basis IS NULL OR (type = 'sell' AND cost_basis >= 0)", name="cost_basis_on_sell"
        ),
        CheckConstraint("source IN ('manual', 'import')", name="source_valid"),
        CheckConstraint(
            "(type = 'transfer') = (to_account_id IS NOT NULL)", name="transfer_has_to_account"
        ),
        CheckConstraint(
            "to_account_id IS NULL OR to_account_id <> account_id", name="transfer_distinct"
        ),
        Index("ix_transactions_household_date", "household_id", "date"),
        Index("ix_transactions_household_category_date", "household_id", "category_id", "date"),
        Index("ix_transactions_household_account_date", "household_id", "account_id", "date"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"))
    date: Mapped[date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    type: Mapped[str] = mapped_column(String(10))
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="RESTRICT"))
    to_account_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("accounts.id", ondelete="RESTRICT")
    )
    # NULL = uncategorized; shows in the needs-attention box.
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("categories.id", ondelete="RESTRICT")
    )
    description: Mapped[str] = mapped_column(String(200), default="")
    # Sell only: what the units sold had cost. Gives realized profit/loss when present.
    cost_basis: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    counterparty: Mapped[str | None] = mapped_column(String(100))
    notes: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    source: Mapped[str] = mapped_column(String(10), default="manual")
    # Phase 2: set when a bank/card statement row is matched to this manual entry.
    statement_matched: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = created_at()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Budget(Base):
    """A category's budget from `month` on.

    A carry-forward row is the default for its month and every later month until the next
    carry-forward row. A row with carry_forward false applies to its own month only. An
    amount of 0 means no budget.
    """

    __tablename__ = "budgets"
    __table_args__ = (
        UniqueConstraint("category_id", "month", name="uq_budgets_category_month"),
        CheckConstraint("amount >= 0", name="amount_non_negative"),
        CheckConstraint("EXTRACT(DAY FROM month) = 1", name="month_is_first_day"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), index=True
    )
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("categories.id", ondelete="CASCADE"))
    month: Mapped[date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2))
    carry_forward: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true())


class CategoryRule(Base):
    __tablename__ = "category_rules"

    id: Mapped[uuid.UUID] = uuid_pk()
    household_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("households.id", ondelete="CASCADE"), index=True
    )
    # Case-insensitive substring matched against the description.
    pattern: Mapped[str] = mapped_column(String(100))
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("categories.id", ondelete="CASCADE"))
    priority: Mapped[int] = mapped_column(Integer, default=100)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = created_at()


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(50), primary_key=True)
    value: Mapped[str] = mapped_column(String(200))


class SeedLog(Base):
    """Every item the config seed has added or found, so it is never added twice.

    scope is "template" for the new-household template, else the household id. If someone
    deletes a seeded account or category in the app, its row here keeps it from coming back.
    """

    __tablename__ = "seed_log"

    scope: Mapped[str] = mapped_column(String(40), primary_key=True)
    item: Mapped[str] = mapped_column(String(200), primary_key=True)
    seeded_at: Mapped[datetime] = created_at()
