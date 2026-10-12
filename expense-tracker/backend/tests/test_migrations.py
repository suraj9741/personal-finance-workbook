from alembic import command
from sqlalchemy import text

from app.db import get_engine
from tests.conftest import alembic_config


def test_downgrade_and_upgrade_again() -> None:
    config = alembic_config()
    command.downgrade(config, "base")
    command.upgrade(config, "head")
    with get_engine().connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM category_templates")).scalar() == 101
