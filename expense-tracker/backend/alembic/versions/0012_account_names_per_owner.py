"""Account names are unique per owner, not per household

Two family members can each have an "SBI". Before, the household-wide rule refused the second
one and, with private accounts, told the second member that someone else's hidden account existed.

Revision ID: 0012
Revises: 0011
Create Date: 2026-11-01
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("uq_accounts_name", "accounts", type_="unique")
    # NULLS NOT DISTINCT: accounts with no owner (left by a removed user) still can't repeat.
    op.create_unique_constraint(
        "uq_accounts_name",
        "accounts",
        ["household_id", "owner_user_id", "name", "pay_type"],
        postgresql_nulls_not_distinct=True,
    )


def downgrade() -> None:
    # Fails if two members now have accounts with the same name and type: rename one first.
    op.drop_constraint("uq_accounts_name", "accounts", type_="unique")
    op.create_unique_constraint("uq_accounts_name", "accounts", ["household_id", "name", "pay_type"])
