from __future__ import annotations

import base64
import hashlib
import hmac
import os
from contextlib import asynccontextmanager
from html.parser import HTMLParser
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from . import __version__
from .api import create_router, create_runtime_router
from .cli import CliRunner
from .core import CoreHost
from .ledger import Ledger
from .model_config import ModelConfigStore, create_model_settings_router
from .provider import ModelClient
from .runtime import Runtime
from .settings import Settings
from .sources import Sources

SESSION_COOKIE = "bhweb_session"

_STATIC_ASSET_EXTENSIONS = frozenset({
    ".js", ".mjs", ".cjs", ".css", ".map",
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp", ".avif",
    ".woff", ".woff2", ".ttf", ".otf", ".eot",
    ".mp3", ".wav", ".ogg", ".wasm",
    ".json", ".webmanifest", ".txt", ".xml", ".pdf",
})


class _InlineScriptExtractor(HTMLParser):
    """Collects raw inline <script> text so CSP can allowlist exact SHA-256 digests."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.scripts: list[str] = []
        self._capture = False
        self._buf: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "script":
            return
        attr_map = {k.lower(): (v or "") for k, v in attrs}
        if "src" in attr_map:
            return
        script_type = attr_map.get("type", "").strip().lower()
        if script_type in ("", "text/javascript", "application/javascript", "module"):
            self._capture = True
            self._buf = []

    def handle_data(self, data: str) -> None:
        if self._capture:
            self._buf.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "script" and self._capture:
            body = "".join(self._buf)
            if body:
                self.scripts.append(body)
            self._capture = False
            self._buf = []


def _inline_script_hashes(index_html: Path | None) -> list[str]:
    if index_html is None or not index_html.is_file():
        return []
    parser = _InlineScriptExtractor()
    parser.feed(index_html.read_text(encoding="utf-8", errors="replace"))
    seen: list[str] = []
    for body in parser.scripts:
        digest = base64.b64encode(hashlib.sha256(body.encode("utf-8")).digest()).decode("ascii")
        token = f"'sha256-{digest}'"
        if token not in seen:
            seen.append(token)
    return seen


def _make_csp_provider(index_html: Path | None):
    cached: dict[str, object] = {"sig": None, "csp": None}

    def get_csp() -> str:
        sig = None
        if index_html is not None:
            try:
                st = index_html.stat()
                sig = (st.st_mtime_ns, st.st_size)
            except OSError:
                sig = None
        if cached["csp"] is not None and cached["sig"] == sig:
            return cached["csp"]  # type: ignore[return-value]
        hashes = _inline_script_hashes(index_html) if sig is not None else []
        script_src = " ".join(["'self'", *hashes])
        csp = (
            f"default-src 'self'; "
            f"script-src {script_src}; "
            f"style-src 'self' 'unsafe-inline'; "
            f"img-src 'self' data: blob:; "
            f"font-src 'self' data:; "
            f"media-src 'self' data: blob:; "
            f"connect-src 'self'; "
            f"worker-src 'self' blob:; "
            f"frame-src 'self'; "
            f"frame-ancestors 'self'; "
            f"object-src 'none'; "
            f"base-uri 'self'; "
            f"form-action 'self'"
        )
        cached["sig"] = sig
        cached["csp"] = csp
        return csp

    return get_csp


def _session_value(token: str) -> str:
    """What the browser keeps instead of the access token itself."""
    return hmac.new(token.encode(), b"bioharness-web-session-v1", hashlib.sha256).hexdigest()


def _same(left: str, right: str) -> bool:
    return hmac.compare_digest(left.encode(), right.encode())


class Login(BaseModel):
    token: str = Field(max_length=1000)


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
    runner = CliRunner(timeout_seconds=settings.tool_timeout_seconds,
                       env_passthrough=settings.tool_env_passthrough)
    if sources is None:
        sources = Sources(settings, runner)
    model_store = ModelConfigStore(settings)
    runtime: Runtime | None = None
    if settings.runtime_enabled:
        ledger = Ledger(settings.ledger_path)  # type: ignore[arg-type]
        ledger.recover()  # nothing of a previous process is still in flight here
        effective_model = model_store.resolve_chat_settings() or settings.model
        runtime = Runtime(settings, ledger, CoreHost(settings, runner),
                          ModelClient(effective_model), sources)  # type: ignore[arg-type]
    session = _session_value(settings.access_token)

    def require_session(request: Request) -> None:
        header = request.headers.get("authorization", "")
        if header.startswith("Bearer ") and _same(header[7:], settings.access_token):
            return
        if _same(request.cookies.get(SESSION_COOKIE, ""), session):
            return
        raise HTTPException(401, {"origin": "web", "code": "UNAUTHENTICATED",
                                  "message": "sign in with the service access token"})

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        yield
        if runtime is not None:
            await runtime.close()
            runtime.ledger.close()

    app = FastAPI(title="BioHarness Research Workspace", version=__version__, lifespan=lifespan,
                  docs_url=None, redoc_url=None, openapi_url=None)
    app.state.runtime = runtime

    resolved_static_dir = _resolve_static_dir(static_dir)
    static_root = resolved_static_dir.resolve() if resolved_static_dir is not None else None
    index_file = (static_root / "index.html") if static_root is not None else None
    get_csp = _make_csp_provider(index_file)

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        response.headers.setdefault("Content-Security-Policy", get_csp())
        return response

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

    app.include_router(create_router(sources, settings, runtime),
                       dependencies=[Depends(require_session)])
    app.include_router(create_model_settings_router(model_store, runtime),
                       dependencies=[Depends(require_session)])
    if runtime is not None:
        app.include_router(create_runtime_router(runtime, settings),
                           dependencies=[Depends(require_session)])

    @app.get("/api", include_in_schema=False)
    @app.get("/api/{rest:path}", include_in_schema=False)
    def unknown_api_path(rest: str = ""):
        # Nothing under /api is ever answered from the static frontend directory.
        raise HTTPException(404, {"origin": "web", "code": "NOT_FOUND", "message": "no such API path"})

    if static_root is not None and index_file is not None:
        @app.api_route("/{full_path:path}", methods=["GET", "HEAD"], include_in_schema=False)
        def serve_frontend(full_path: str):
            if full_path == "api" or full_path.startswith("api/"):
                raise HTTPException(404, {"origin": "web", "code": "NOT_FOUND",
                                          "message": "no such API path"})
            cleaned = full_path.lstrip("/")
            if "\x00" in cleaned:
                raise HTTPException(404, {"origin": "web", "code": "NOT_FOUND",
                                          "message": "not found"})
            if cleaned:
                candidate = (static_root / cleaned).resolve()
                if not candidate.is_relative_to(static_root):
                    raise HTTPException(404, {"origin": "web", "code": "NOT_FOUND",
                                              "message": "not found"})
                if candidate.is_file():
                    headers = {"Cache-Control": "no-cache"} if candidate == index_file else {}
                    return FileResponse(candidate, headers=headers)
                if cleaned.startswith("assets/") or Path(cleaned).suffix.lower() in _STATIC_ASSET_EXTENSIONS:
                    raise HTTPException(404, {"origin": "web", "code": "NOT_FOUND",
                                              "message": "asset not found"})
            if not index_file.is_file():
                raise HTTPException(404, {"origin": "web", "code": "NOT_FOUND",
                                          "message": "frontend not built"})
            return FileResponse(index_file, media_type="text/html; charset=utf-8",
                                headers={"Cache-Control": "no-cache"})

    return app
