"""Posted date on card entries

Transactions get an optional posted_on date: the day the bank posted a card purchase or
refund, when that was later than the purchase. It only moves the entry to a later card
statement; balances and month totals still use the purchase date. Existing rows stay as
they are (NULL).

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("transactions", sa.Column("posted_on", sa.Date(), nullable=True))
    op.create_check_constraint(
        "posted_on_valid",
        "transactions",
        "posted_on IS NULL OR (type IN ('expense', 'refund') AND posted_on >= date)",
    )


def downgrade() -> None:
    op.drop_constraint("posted_on_valid", "transactions", type_="check")
    op.drop_column("transactions", "posted_on")
