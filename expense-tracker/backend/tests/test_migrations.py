from alembic import command
from sqlalchemy import text

from app.db import get_engine
from tests.conftest import alembic_config


def test_downgrade_and_upgrade_again() -> None:
    config = alembic_config()
    command.downgrade(config, "base")
    command.upgrade(config, "head")
    with get_engine().connect() as conn:
        # 0002's starter template is removed by 0004; the seed config fills it now.
        assert conn.execute(text("SELECT count(*) FROM category_templates")).scalar() == 0
        assert conn.execute(text("SELECT count(*) FROM seed_log")).scalar() == 0
