"""Accounts are private unless their owner shares them

Every account gets an owner. Accounts that had none (the ones the config seed added) go to
their household's first owner and become private; the owner shares them from the app.
Accounts that already had an owner keep their setting.

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-01
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0010"
down_revision: str | None = "0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE accounts a
        SET owner_user_id = (
                SELECT m.user_id FROM household_members m
                WHERE m.household_id = a.household_id AND m.role = 'owner'
                ORDER BY m.joined_at, m.user_id
                LIMIT 1
            ),
            visibility = 'private'
        WHERE a.owner_user_id IS NULL
          AND EXISTS (
                SELECT 1 FROM household_members m
                WHERE m.household_id = a.household_id AND m.role = 'owner'
            )
        """
    )


def downgrade() -> None:
    # Owners stay set; nothing to undo safely.
    pass
