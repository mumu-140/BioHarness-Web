import os

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DBAPIError


DATABASE_URL = os.environ.get("BIOHARNESS_WEB_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DATABASE_URL,
    reason="BIOHARNESS_WEB_TEST_DATABASE_URL is not configured",
)


def test_web_role_can_select_but_cannot_mutate():
    engine = create_engine(DATABASE_URL, pool_pre_ping=True)
    try:
        with engine.connect() as connection:
            mode = connection.execute(
                text("SHOW default_transaction_read_only")
            ).scalar_one()
            assert mode == "on"

            count = connection.execute(
                text("SELECT count(*) FROM scientific_task_specs")
            ).scalar_one()
            assert count >= 0

            with pytest.raises(DBAPIError):
                connection.execute(
                    text(
                        "CREATE TABLE observatory_write_probe "
                        "(id integer primary key)"
                    )
                )
    finally:
        engine.dispose()
