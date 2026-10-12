"""placeholder (no changes)

An early draft of the accounts work used revision 0003 to insert accounts. Accounts now come
from config/seed.yaml, so this revision does nothing; it stays so a database that ran the
draft still has a known revision to upgrade from.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-12
"""

from collections.abc import Sequence

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
