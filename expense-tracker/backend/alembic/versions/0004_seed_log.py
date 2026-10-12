"""seed_log table; starter categories move from migrations to config/seed.yaml

Accounts and categories now come from config/seed.yaml at deploy time (app.seed), not from
migrations. This adds the table the seed uses to remember what it has handled, and removes
the 0002 category template rows that are still exactly as 0002 wrote them, so new
households start empty unless the config or the Admin page fills the template. Template
rows someone edited, and every household's own categories, are left alone.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-12
"""

import json
from collections.abc import Sequence
from pathlib import Path

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

SEEDED_BY_0002 = Path(__file__).resolve().parents[1] / "data" / "0002_categories.json"


def upgrade() -> None:
    op.create_table(
        "seed_log",
        sa.Column("scope", sa.String(length=40), nullable=False),
        sa.Column("item", sa.String(length=200), nullable=False),
        sa.Column(
            "seeded_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.PrimaryKeyConstraint("scope", "item"),
    )
    delete = sa.text(
        "DELETE FROM category_templates WHERE kind = :kind AND parent_name = :parent_name "
        "AND sub_name = :sub_name AND stats_group = :stats_group AND sort_order = :sort_order"
    )
    bind = op.get_bind()
    for row in json.loads(SEEDED_BY_0002.read_text()):
        if not row["family_only"]:
            bind.execute(delete, {k: row[k] for k in ("kind", "parent_name", "sub_name",
                                                      "stats_group", "sort_order")})


def downgrade() -> None:
    op.drop_table("seed_log")
