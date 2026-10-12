"""add the finance script's accounts to the admin's household

The first admin's household now starts with every account in finance-sheet Defaults.gs
(SEED.PAY). Households created before that only have HDFC, Yes Bank and Cash, so this adds
the missing ones. Existing accounts are left exactly as they are.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-12
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Frozen copy of app/data/accounts.json at the time of this migration.
SCRIPT_ACCOUNTS = [
    ("HDFC", "bank"),
    ("SBI", "bank"),
    ("BOI", "bank"),
    ("Paytm", "bank"),
    ("FI", "bank"),
    ("Amazon Pay", "bank"),
    ("HDFC CC", "credit_card"),
    ("Amazon Pay", "credit_card"),
    ("ICICI", "credit_card"),
    ("Indusland", "credit_card"),
    ("SBI", "credit_card"),
    ("Yes Bank", "credit_card"),
    ("Zerodha", "share_broker"),
    ("Angel Broker", "share_broker"),
    ("Dhan", "share_broker"),
    ("Cash", "cash"),
]


def upgrade() -> None:
    insert = sa.text(
        """
        INSERT INTO accounts (id, household_id, name, pay_type, opening_balance,
                              visibility, owner_user_id, is_active)
        SELECT gen_random_uuid(), hm.household_id, :name, :pay_type, 0, 'shared', NULL, true
        FROM (SELECT DISTINCT m.household_id
              FROM household_members m JOIN users u ON u.id = m.user_id
              WHERE u.is_site_admin) AS hm
        ON CONFLICT ON CONSTRAINT uq_accounts_name DO NOTHING
        """
    )
    bind = op.get_bind()
    for name, pay_type in SCRIPT_ACCOUNTS:
        bind.execute(insert, {"name": name, "pay_type": pay_type})


def downgrade() -> None:
    # Accounts may have entries by now; removing them would lose data. Nothing to undo.
    pass
