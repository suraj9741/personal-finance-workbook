"""reference data: category template for new households, default app settings

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-12
"""

import json
import uuid
from collections.abc import Sequence
from pathlib import Path

import sqlalchemy as sa
from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

CATEGORIES = Path(__file__).resolve().parents[1] / "data" / "0002_categories.json"

templates = sa.table(
    "category_templates",
    sa.column("id", sa.Uuid()),
    sa.column("kind", sa.String()),
    sa.column("parent_name", sa.String()),
    sa.column("sub_name", sa.String()),
    sa.column("stats_group", sa.String()),
    sa.column("sort_order", sa.Integer()),
)
settings = sa.table("app_settings", sa.column("key", sa.String()), sa.column("value", sa.String()))

DEFAULT_SETTINGS = {"currency_symbol": "₹", "invite_expiry_days": "7"}


def upgrade() -> None:
    rows = json.loads(CATEGORIES.read_text())
    # Family categories (Gotu, Mom, Baba, Pratiksha, Farm) are kept out of the template.
    op.bulk_insert(
        templates,
        [
            {
                "id": uuid.uuid4(),
                "kind": r["kind"],
                "parent_name": r["parent_name"],
                "sub_name": r["sub_name"],
                "stats_group": r["stats_group"],
                "sort_order": r["sort_order"],
            }
            for r in rows
            if not r["family_only"]
        ],
    )
    op.bulk_insert(settings, [{"key": k, "value": v} for k, v in DEFAULT_SETTINGS.items()])


def downgrade() -> None:
    op.execute("DELETE FROM app_settings")
    op.execute("DELETE FROM category_templates")
