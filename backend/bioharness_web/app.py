from __future__ import annotations

import hashlib
import hmac
import os
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import __version__
from .api import create_router
from .cli import CliRunner
from .settings import Settings
from .sources import Sources

SESSION_COOKIE = "bhweb_session"


def _session_value(token: str) -> str:
    """What the browser keeps instead of the access token itself."""
    return hmac.new(token.encode(), b"bioharness-web-session-v1", hashlib.sha256).hexdigest()


def _same(left: str, right: str) -> bool:
    return hmac.compare_digest(left.encode(), right.encode())


class Login(BaseModel):
    token: str


def _resolve_static_dir(value: str | Path | None) -> Path | None:
    raw = value if value is not None else os.environ.get("BIOHARNESS_WEB_STATIC_DIR", "").strip()
    if not raw:
        return None
    candidate = Path(raw)
    return candidate if candidate.is_dir() else None


def create_app(
    settings: Settings | None = None,
    *,
    sources: Sources | None = None,
    static_dir: str | Path | None = None,
) -> FastAPI:
    settings = settings or Settings.from_env()
    if sources is None:
        sources = Sources(settings, CliRunner(timeout_seconds=settings.tool_timeout_seconds))
    session = _session_value(settings.access_token)

    def require_session(request: Request) -> None:
        header = request.headers.get("authorization", "")
        if header.startswith("Bearer ") and _same(header[7:], settings.access_token):
            return
        if _same(request.cookies.get(SESSION_COOKIE, ""), session):
            return
        raise HTTPException(401, {"origin": "web", "code": "UNAUTHENTICATED",
                                  "message": "sign in with the service access token"})

    app = FastAPI(title="BioHarness Research Workspace", version=__version__,
                  docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.post("/api/session", status_code=204)
    def sign_in(login: Login, request: Request, response: Response):
        if not _same(login.token, settings.access_token):
            raise HTTPException(401, {"origin": "web", "code": "UNAUTHENTICATED",
                                      "message": "access token not accepted"})
        response.set_cookie(SESSION_COOKIE, session, httponly=True, samesite="strict",
                            secure=request.url.scheme == "https", path="/")

    app.include_router(create_router(sources, settings),
                       dependencies=[Depends(require_session)])

    @app.get("/api/{rest:path}", include_in_schema=False)
    def unknown_api_path(rest: str):
        # Nothing under /api is ever answered from the static frontend directory.
        raise HTTPException(404, {"origin": "web", "code": "NOT_FOUND", "message": "no such API path"})

    resolved_static_dir = _resolve_static_dir(static_dir)
    if resolved_static_dir is not None:
        app.mount("/", StaticFiles(directory=resolved_static_dir, html=True), name="frontend")
    return app
