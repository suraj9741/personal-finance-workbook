"""Card statement totals

A new card_statements table keeps the "Total amount due" the user copies from a card's bank
statement, one per card and statement date. The app compares it with the closing balance it
works out for the same cycle; nothing here is calculated.

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-17
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "card_statements",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("account_id", sa.Uuid(), nullable=False),
        sa.Column("statement_end", sa.Date(), nullable=False),
        sa.Column("amount_due", sa.Numeric(precision=14, scale=2), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["account_id"], ["accounts.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("account_id", "statement_end", name="uq_card_statements_end"),
    )
    op.create_index(op.f("ix_card_statements_account_id"), "card_statements", ["account_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_card_statements_account_id"), table_name="card_statements")
    op.drop_table("card_statements")
