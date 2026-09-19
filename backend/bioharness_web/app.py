from contextlib import asynccontextmanager

from fastapi import FastAPI

from .api import create_router
from .db import ReadOnlyDatabase
from .repository import BioHarnessReadRepository
from .service import ObservatoryService
from .settings import Settings


def create_app(
    *,
    service=None,
    settings: Settings | None = None,
    poll_interval_seconds: float | None = None,
) -> FastAPI:
    database: ReadOnlyDatabase | None = None

    if service is None:
        settings = settings or Settings.from_env()
        database = ReadOnlyDatabase(settings.database_url)
        service = ObservatoryService(BioHarnessReadRepository(database))

    if poll_interval_seconds is None:
        poll_interval_seconds = (
            settings.poll_interval_seconds if settings is not None else 2.0
        )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        yield
        if database is not None:
            database.dispose()

    app = FastAPI(
        title="BioHarness Observatory",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.include_router(
        create_router(
            service,
            poll_interval_seconds=poll_interval_seconds,
        )
    )
    return app
