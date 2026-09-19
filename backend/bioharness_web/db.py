from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import Connection


class ReadOnlyDatabase:
    def __init__(self, database_url: str):
        self._engine: Engine = create_engine(database_url, pool_pre_ping=True)

    @contextmanager
    def connection(self) -> Iterator[Connection]:
        with self._engine.connect() as connection:
            transaction = connection.begin()
            connection.execute(text("SET TRANSACTION READ ONLY"))
            try:
                yield connection
            finally:
                transaction.rollback()

    def dispose(self) -> None:
        self._engine.dispose()
