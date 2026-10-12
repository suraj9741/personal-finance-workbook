"""Budgets carry forward to later months

A budget row is now the default for its month and every later month, until the next one.
Rows for months before the current one become this-month-only, so every past month keeps
exactly the budgets it had. Rows for this month and later carry forward.

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "budgets",
        sa.Column("carry_forward", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.execute(
        "UPDATE budgets SET carry_forward = false "
        "WHERE month < date_trunc('month', now() AT TIME ZONE 'UTC')::date"
    )


def downgrade() -> None:
    # Zero rows only mean something with carry-forward; before it, a missing row was no budget.
    op.execute("DELETE FROM budgets WHERE amount = 0")
    op.drop_column("budgets", "carry_forward")
