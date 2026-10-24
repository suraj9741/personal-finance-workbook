"""Broker value history

A new account_valuations table keeps every broker value the user enters, one per account
and date. accounts.current_value stays the latest value; the history lets a past month end
show the value it had then. Brokers that already have a value get it as their first entry,
dated valued_on (or the day the account was created when that is empty).

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "account_valuations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("valued_on", sa.Date(), nullable=False),
        sa.Column("value", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("value >= 0", name="value_valid"),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", "valued_on", name="uq_account_valuations_date"),
    )
    op.create_index(op.f("ix_account_valuations_account_id"), "account_valuations", ["account_id"])
    op.execute(
        "INSERT INTO account_valuations (id, account_id, valued_on, value) "
        "SELECT gen_random_uuid(), id, COALESCE(valued_on, created_at::date), current_value "
        "FROM accounts WHERE current_value IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_account_valuations_account_id"), table_name="account_valuations")
    op.drop_table("account_valuations")
