"""Account details, refunds and broker trades

Accounts get an institution, a description, an opening date, card fields (credit limit,
statement and due day) and broker fields (opening invested amount, a manually entered
current value). Transactions get three more types: refund, buy and sell, and a cost basis
for sells. Every existing row is kept as it is: transactions already link to accounts by id.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

OLD_TYPES = "type IN ('expense', 'income', 'transfer')"
NEW_TYPES = "type IN ('expense', 'income', 'transfer', 'refund', 'buy', 'sell')"

ACCOUNT_CHECKS = {
    "card_fields_on_cards": "pay_type = 'credit_card' OR "
    "(credit_limit IS NULL AND statement_day IS NULL AND due_day IS NULL)",
    "broker_fields_on_brokers": "pay_type = 'share_broker' OR "
    "(current_value IS NULL AND valued_on IS NULL AND opening_invested = 0)",
    "credit_limit_valid": "credit_limit IS NULL OR credit_limit >= 0",
    "statement_day_valid": "statement_day BETWEEN 1 AND 31",
    "due_day_valid": "due_day BETWEEN 1 AND 31",
    "opening_invested_valid": "opening_invested >= 0",
    "current_value_valid": "current_value IS NULL OR current_value >= 0",
}


def upgrade() -> None:
    op.add_column("accounts", sa.Column("institution", sa.String(60), nullable=True))
    op.add_column("accounts", sa.Column("description", sa.String(500), nullable=True))
    op.add_column("accounts", sa.Column("opening_date", sa.Date(), nullable=True))
    op.add_column("accounts", sa.Column("credit_limit", sa.Numeric(12, 2), nullable=True))
    op.add_column("accounts", sa.Column("statement_day", sa.SmallInteger(), nullable=True))
    op.add_column("accounts", sa.Column("due_day", sa.SmallInteger(), nullable=True))
    op.add_column(
        "accounts",
        sa.Column("opening_invested", sa.Numeric(12, 2), nullable=False, server_default="0"),
    )
    op.add_column("accounts", sa.Column("current_value", sa.Numeric(14, 2), nullable=True))
    op.add_column("accounts", sa.Column("valued_on", sa.Date(), nullable=True))
    for name, condition in ACCOUNT_CHECKS.items():
        op.create_check_constraint(name, "accounts", condition)

    op.add_column("transactions", sa.Column("cost_basis", sa.Numeric(12, 2), nullable=True))
    op.drop_constraint("type_valid", "transactions", type_="check")
    op.create_check_constraint("type_valid", "transactions", NEW_TYPES)
    op.create_check_constraint(
        "cost_basis_on_sell",
        "transactions",
        "cost_basis IS NULL OR (type = 'sell' AND cost_basis >= 0)",
    )


def downgrade() -> None:
    # Refunds, buys and sells have no meaning before this revision. Refuse rather than lose them.
    count = (
        op.get_bind()
        .execute(sa.text("SELECT count(*) FROM transactions WHERE type IN ('refund', 'buy', 'sell')"))
        .scalar()
    )
    if count:
        raise RuntimeError(
            f"{count} refund/buy/sell transactions exist. Change or delete them first."
        )
    op.drop_constraint("cost_basis_on_sell", "transactions", type_="check")
    op.drop_constraint("type_valid", "transactions", type_="check")
    op.create_check_constraint("type_valid", "transactions", OLD_TYPES)
    op.drop_column("transactions", "cost_basis")
    for name in ACCOUNT_CHECKS:
        op.drop_constraint(name, "accounts", type_="check")
    for column in (
        "valued_on",
        "current_value",
        "opening_invested",
        "due_day",
        "statement_day",
        "credit_limit",
        "opening_date",
        "description",
        "institution",
    ):
        op.drop_column("accounts", column)
