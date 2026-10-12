import datetime as dt
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

Kind = Literal["expense", "income", "transfer"]
StatsGroup = Literal["spend", "saving", "lent", "earned", "repaid", "transfer"]
PayType = Literal["bank", "credit_card", "share_broker", "cash"]
Visibility = Literal["shared", "private"]
Role = Literal["owner", "member"]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
Money = Annotated[Decimal, Field(max_digits=12, decimal_places=2)]
Password = Annotated[str, StringConstraints(min_length=10, max_length=200)]
Email = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True, to_lower=True, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$"
    ),
]
Month = Annotated[str, StringConstraints(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Orm(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---- auth / users ---------------------------------------------------------------------


class LoginIn(Strict):
    email: Email
    password: Annotated[str, StringConstraints(min_length=1, max_length=200)]


class MeOut(BaseModel):
    id: uuid.UUID
    email: str
    display_name: str
    is_site_admin: bool
    household_id: uuid.UUID | None
    household_name: str | None
    role: Role | None


class PasswordChangeIn(Strict):
    current_password: str
    new_password: Password


class ResetIn(Strict):
    password: Password


class InviteCreateIn(Strict):
    role: Role = "member"
    note: Annotated[str, StringConstraints(max_length=200)] | None = None


class AdminInviteCreateIn(Strict):
    """Admin invite: into an existing household, or a brand-new one for the invitee."""

    household_id: uuid.UUID | None = None
    new_household_name: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)] | None
    ) = None
    role: Role = "owner"
    note: Annotated[str, StringConstraints(max_length=200)] | None = None


class InviteOut(BaseModel):
    id: uuid.UUID
    url: str
    expires_at: datetime
    role: Role
    household_name: str | None


class InviteInfoOut(BaseModel):
    household_name: str | None
    new_household: bool
    expires_at: datetime


class InviteAcceptIn(Strict):
    email: Email
    display_name: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)
    ]
    password: Password


class LinkOut(BaseModel):
    url: str
    expires_at: datetime


class MemberOut(BaseModel):
    user_id: uuid.UUID
    display_name: str
    email: str
    role: Role
    is_active: bool


class MemberPatchIn(Strict):
    role: Role


class AdminUserOut(Orm):
    id: uuid.UUID
    email: str
    display_name: str
    is_site_admin: bool
    is_active: bool
    created_at: datetime
    household_id: uuid.UUID | None = None
    household_name: str | None = None


class AdminUserPatchIn(Strict):
    display_name: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
        | None
    ) = None
    is_site_admin: bool | None = None
    is_active: bool | None = None


class AdminHouseholdOut(BaseModel):
    id: uuid.UUID
    name: str
    created_at: datetime
    members: list[MemberOut]


class HouseholdPatchIn(Strict):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class SettingsOut(BaseModel):
    values: dict[str, str]


class SettingsIn(Strict):
    values: dict[
        Annotated[str, StringConstraints(max_length=50)],
        Annotated[str, StringConstraints(max_length=200)],
    ]


# ---- categories / accounts / rules ----------------------------------------------------


class CategoryOut(Orm):
    id: uuid.UUID
    kind: Kind
    parent_name: str
    sub_name: str
    stats_group: StatsGroup
    is_active: bool
    sort_order: int


class CategoryIn(Strict):
    kind: Kind
    parent_name: Name
    sub_name: Name
    stats_group: StatsGroup | None = None
    sort_order: int = 1000


class CategoryPatchIn(Strict):
    parent_name: Name | None = None
    sub_name: Name | None = None
    stats_group: StatsGroup | None = None
    is_active: bool | None = None
    sort_order: int | None = None


class TemplateOut(Orm):
    id: uuid.UUID
    kind: Kind
    parent_name: str
    sub_name: str
    stats_group: StatsGroup
    sort_order: int


class AccountOut(Orm):
    id: uuid.UUID
    name: str
    pay_type: PayType
    opening_balance: Decimal
    visibility: Visibility
    owner_user_id: uuid.UUID | None
    is_active: bool


class AccountIn(Strict):
    name: Name
    pay_type: PayType
    opening_balance: Money = Decimal("0")
    visibility: Visibility = "shared"


class AccountPatchIn(Strict):
    name: Name | None = None
    opening_balance: Money | None = None
    is_active: bool | None = None


class RuleOut(Orm):
    id: uuid.UUID
    pattern: str
    category_id: uuid.UUID
    priority: int
    created_by: uuid.UUID | None


class RuleIn(Strict):
    pattern: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=100)]
    category_id: uuid.UUID
    priority: int = Field(100, ge=0, le=10000)


class RulePatchIn(Strict):
    pattern: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=100)]
        | None
    ) = None
    category_id: uuid.UUID | None = None
    priority: int | None = Field(None, ge=0, le=10000)


# ---- transactions ---------------------------------------------------------------------


class TransactionIn(Strict):
    date: dt.date
    amount: Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=2)]
    type: Kind = "expense"
    account_id: uuid.UUID
    to_account_id: uuid.UUID | None = None
    # Omitted: a matching rule fills it in. Explicit null: leave uncategorized.
    category_id: uuid.UUID | None = None
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] = ""
    counterparty: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)] | None
    ) = None
    notes: Annotated[str, StringConstraints(max_length=2000)] | None = None


class TransactionPatchIn(Strict):
    date: dt.date | None = None
    amount: Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=2)] | None = None
    type: Kind | None = None
    account_id: uuid.UUID | None = None
    to_account_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = (
        None
    )
    counterparty: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)] | None
    ) = None
    notes: Annotated[str, StringConstraints(max_length=2000)] | None = None


class TransactionOut(Orm):
    id: uuid.UUID
    date: dt.date
    amount: Decimal
    type: Kind
    account_id: uuid.UUID
    to_account_id: uuid.UUID | None
    category_id: uuid.UUID | None
    description: str
    counterparty: str | None
    notes: str | None
    created_by: uuid.UUID | None
    created_by_name: str | None = None
    source: str
    statement_matched: bool
    created_at: datetime
    updated_at: datetime


class TransactionPage(BaseModel):
    items: list[TransactionOut]
    total: int


class SuggestionOut(BaseModel):
    description: str
    type: Kind
    category_id: uuid.UUID | None
    account_id: uuid.UUID
    amount: Decimal


# ---- budgets / stats ------------------------------------------------------------------


class BudgetItem(BaseModel):
    category_id: uuid.UUID
    amount: Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2)]


class BudgetsOut(BaseModel):
    month: str
    items: list[BudgetItem]


class BudgetsIn(Strict):
    month: Month
    items: list[BudgetItem]


class BudgetCopyIn(Strict):
    from_month: Month
    to_month: Month

    @field_validator("to_month")
    @classmethod
    def different(cls, value: str, info: object) -> str:
        data = getattr(info, "data", {})
        if data.get("from_month") == value:
            raise ValueError("to_month must differ from from_month")
        return value


class CategoryLine(BaseModel):
    category_id: uuid.UUID
    parent_name: str
    sub_name: str
    stats_group: StatsGroup
    budget: Decimal | None
    actual: Decimal
    over_budget: bool


class MonthStats(BaseModel):
    month: str
    scope: Literal["household", "me"]
    income: Decimal
    spend: Decimal
    saved: Decimal
    savings_rate: float | None
    invested: Decimal
    lent: Decimal
    repaid: Decimal
    budget_total: Decimal
    categories: list[CategoryLine]
    includes_only_visible: bool = True


class TrendPoint(BaseModel):
    month: str
    income: Decimal
    spend: Decimal
    saved: Decimal
    savings_rate: float | None


class LoanOut(BaseModel):
    counterparty: str
    outstanding: Decimal
    last_lent_on: date


class AttentionOut(BaseModel):
    month: str
    uncategorized: int
    over_budget: list[CategoryLine]
    old_loans: list[LoanOut]
    no_income: bool
    credit_card_category_used: int
