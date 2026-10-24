import datetime as dt
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

Kind = Literal["expense", "income", "transfer"]
TxType = Literal["expense", "income", "transfer", "refund", "buy", "sell"]
StatsGroup = Literal["spend", "saving", "lent", "earned", "repaid", "transfer"]
PayType = Literal["bank", "credit_card", "share_broker", "cash"]
Visibility = Literal["shared", "private"]
Role = Literal["owner", "member"]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
Money = Annotated[Decimal, Field(max_digits=12, decimal_places=2)]
PositiveMoney = Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2)]
Day = Annotated[int, Field(ge=1, le=31)]
Institution = Annotated[str, StringConstraints(strip_whitespace=True, max_length=60)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]
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
    institution: str | None
    description: str | None
    pay_type: PayType
    opening_balance: Decimal
    opening_date: date | None
    credit_limit: Decimal | None
    statement_day: int | None
    due_day: int | None
    opening_invested: Decimal
    current_value: Decimal | None
    valued_on: date | None
    visibility: Visibility
    owner_user_id: uuid.UUID | None
    is_active: bool


class AccountFields(Strict):
    """Fields shared by create and edit. Card and broker fields only fit their own type."""

    institution: Institution | None = None
    description: Description | None = None
    opening_date: date | None = None
    credit_limit: PositiveMoney | None = None
    statement_day: Day | None = None
    due_day: Day | None = None
    opening_invested: PositiveMoney | None = None
    current_value: Annotated[Decimal, Field(ge=0, max_digits=14, decimal_places=2)] | None = None
    valued_on: date | None = None


class AccountIn(AccountFields):
    name: Name
    pay_type: PayType
    opening_balance: Money = Decimal("0")
    visibility: Visibility = "shared"


class AccountPatchIn(AccountFields):
    """The type can't change: it decides what every past transaction means for the balance.

    Optional fields can be cleared by sending null.
    """

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
    type: TxType = "expense"
    account_id: uuid.UUID
    to_account_id: uuid.UUID | None = None
    # Omitted: a matching rule fills it in. Explicit null: leave uncategorized.
    category_id: uuid.UUID | None = None
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] = ""
    cost_basis: PositiveMoney | None = None
    posted_on: dt.date | None = None
    counterparty: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)] | None
    ) = None
    notes: Annotated[str, StringConstraints(max_length=2000)] | None = None


class TransactionPatchIn(Strict):
    date: dt.date | None = None
    amount: Annotated[Decimal, Field(gt=0, max_digits=12, decimal_places=2)] | None = None
    type: TxType | None = None
    account_id: uuid.UUID | None = None
    to_account_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    description: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = (
        None
    )
    cost_basis: PositiveMoney | None = None
    posted_on: dt.date | None = None
    counterparty: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=100)] | None
    ) = None
    notes: Annotated[str, StringConstraints(max_length=2000)] | None = None


class TransactionOut(Orm):
    id: uuid.UUID
    date: dt.date
    amount: Decimal
    type: TxType
    account_id: uuid.UUID
    to_account_id: uuid.UUID | None
    category_id: uuid.UUID | None
    description: str
    cost_basis: Decimal | None
    posted_on: dt.date | None
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
    type: TxType
    category_id: uuid.UUID | None
    account_id: uuid.UUID
    amount: Decimal


# ---- budgets / stats ------------------------------------------------------------------


class BudgetItem(BaseModel):
    category_id: uuid.UUID
    amount: Annotated[Decimal, Field(ge=0, max_digits=12, decimal_places=2)]
    # Only this month; later months keep the default. Months before the current one are
    # always saved this way, so a past month never changes the months after it.
    this_month_only: bool = False


class BudgetLine(BaseModel):
    category_id: uuid.UUID
    amount: Decimal
    this_month_only: bool
    # The month the amount was set in. Earlier than `month` means it carried forward.
    set_in: str


class NextChange(BaseModel):
    """A later month where a different default budget, set earlier, takes over."""

    category_id: uuid.UUID
    month: str
    amount: Decimal


class BudgetsOut(BaseModel):
    month: str
    # False for past months: changes there apply to that month only.
    carries_forward: bool
    items: list[BudgetLine]
    next_changes: list[NextChange] = []


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
    kind: Kind
    parent_name: str
    sub_name: str
    stats_group: StatsGroup
    budget: Decimal | None
    actual: Decimal
    # Positive is good: money left for an expense, more earned than planned for income.
    diff: Decimal
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


# ---- account balances / overview --------------------------------------------------------


class AccountFigures(BaseModel):
    """One account's numbers. All-time figures ignore the month; month figures use it only.

    Fields that don't apply to the account's type are null.
    """

    account: AccountOut
    # Bank, cash and broker cash: money in the account now, from entries dated up to today.
    balance: Decimal | None
    # Bank, cash and broker cash: the balance as the month began and as its last day ends,
    # counting entries already dated later in the month. Null for cards.
    balance_month_start: Decimal | None = None
    balance_month_end: Decimal | None = None
    # Credit card: owed now (negative means the card is in credit).
    outstanding: Decimal | None
    # Credit card: limit minus outstanding, never below 0. Null without a limit.
    available_credit: Decimal | None
    next_due_date: date | None
    # Broker: cost of what is held (opening invested + buys - cost of what was sold).
    invested: Decimal | None
    deposited: Decimal | None
    withdrawn: Decimal | None
    # Broker: only from the value the user entered; null when there is none.
    current_value: Decimal | None
    unrealized_pl: Decimal | None
    # Broker: from sells that carry a cost. realized_complete is false when some sells don't.
    realized_pl: Decimal | None
    realized_complete: bool
    # The month's activity on this account.
    month_income: Decimal
    month_expenses: Decimal
    month_refunds: Decimal
    month_transfers_in: Decimal
    month_transfers_out: Decimal
    month_buys: Decimal
    month_sells: Decimal
    # Credit card with a statement day: the statement that closes in the month, using each
    # entry's posted date when it has one. statement_end is the statement day itself; a cycle
    # still open (statement_end on or after today) holds what is in it so far. All null for
    # other accounts and for cards without a statement day.
    statement_start: date | None = None
    statement_end: date | None = None
    statement_purchases: Decimal | None = None  # purchases less refunds
    statement_refunds: Decimal | None = None
    statement_payments: Decimal | None = None
    statement_credits: Decimal | None = None  # cashback and other income on the card
    # Purchases less refunds since the last statement that closed before today.
    unbilled_since: date | None = None
    unbilled: Decimal | None = None


class OverviewTotals(BaseModel):
    """Active accounts only for balances; every visible account for the month's activity."""

    bank_balance: Decimal
    # The bank balance as the month began and as it ends (see AccountFigures).
    bank_balance_month_start: Decimal
    bank_balance_month_end: Decimal
    card_outstanding: Decimal
    # Null when no active card has a credit limit set.
    available_credit: Decimal | None
    broker_cash: Decimal
    invested: Decimal
    # Null unless every active broker has a value entered.
    portfolio_value: Decimal | None
    brokers_valued: int
    brokers: int
    month_income: Decimal
    # Expenses less refunds. Transfers, buys and sells are never in either.
    month_expenses: Decimal
    # Bank balance minus card outstanding. Investments are not in it.
    net_cash: Decimal


class OverviewOut(BaseModel):
    month: str
    totals: OverviewTotals
    accounts: list[AccountFigures]
