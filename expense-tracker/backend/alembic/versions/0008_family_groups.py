"""Family category groups

Categories get an is_family flag. The Family tick in Settings sets it on every category of a
group (expense and income alike), and the year view lists those groups as family. Existing
rows start unticked; the seed config ticks the groups it names, once.

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "categories",
        sa.Column("is_family", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("categories", "is_family")
