from contextlib import asynccontextmanager
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .api import create_router
from .db import ReadOnlyDatabase
from .evidence import EvidencePreviewer
from .repository import BioHarnessReadRepository
from .service import ObservatoryService
from .settings import Settings


def _resolve_static_dir(value: str | Path | None) -> Path | None:
    if value is not None:
        candidate = Path(value)
        return candidate if candidate.is_dir() else None

    configured = os.environ.get("BIOHARNESS_WEB_STATIC_DIR", "").strip()
    candidate = Path(configured) if configured else Path("/app/static")
    return candidate if candidate.is_dir() else None


def create_app(
    *,
    service=None,
    settings: Settings | None = None,
    poll_interval_seconds: float | None = None,
    static_dir: str | Path | None = None,
) -> FastAPI:
    database: ReadOnlyDatabase | None = None

    if service is None:
        settings = settings or Settings.from_env()
        database = ReadOnlyDatabase(settings.database_url)
        evidence_previewer = None
        if settings.evidence_host_root and settings.evidence_mount_root:
            evidence_previewer = EvidencePreviewer(
                host_root=Path(settings.evidence_host_root),
                mount_root=Path(settings.evidence_mount_root),
                max_bytes=settings.evidence_preview_max_bytes,
            )
        service = ObservatoryService(
            BioHarnessReadRepository(database),
            evidence_previewer=evidence_previewer,
        )

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

    resolved_static_dir = _resolve_static_dir(static_dir)
    if resolved_static_dir is not None:
        app.mount(
            "/",
            StaticFiles(directory=resolved_static_dir, html=True),
            name="frontend",
        )

    return app
