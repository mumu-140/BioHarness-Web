"""Read-only application API: snapshots, evidence preview and change notifications."""
from __future__ import annotations

import asyncio
import os
import shutil

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import StreamingResponse

from . import evidence
from .cli import ToolError
from .settings import Settings
from .sources import (GOVERNANCE, SelectorError, Sources, UnknownWorkspace, source_error,
                      normalize_selector, path_redactor)
from .stream import version_stream


def _http_error(error: Exception) -> HTTPException:
    if isinstance(error, UnknownWorkspace):
        return HTTPException(404, {"origin": "web", "code": "WORKSPACE_UNKNOWN",
                                   "message": "unknown workspace"})
    if isinstance(error, SelectorError):
        return HTTPException(422, {"origin": "web", "code": "SELECTOR_INVALID",
                                   "message": str(error)})
    if isinstance(error, ToolError):
        status = 504 if error.code == "TOOL_TIMEOUT" else 502
        return HTTPException(status, {"origin": "web", "code": error.code,
                                      "message": error.message})
    return HTTPException(500, {"origin": "web", "code": "INTERNAL_ERROR",
                               "message": "the request could not be served"})


def _no_store(response: Response) -> None:
    """Snapshots and previews are research content: never kept by a browser or proxy cache."""
    response.headers["Cache-Control"] = "no-store"


def create_router(sources: Sources, settings: Settings) -> APIRouter:
    router = APIRouter(prefix="/api", dependencies=[Depends(_no_store)])

    @router.get("/meta")
    def meta():
        def tool(command: str) -> dict:
            # Found on PATH is not proof that a call works; only an answer is.
            return {"command": os.path.basename(command),
                    "found": shutil.which(command) is not None}

        return {
            "service": settings.service_id,
            "workspaces": sorted(settings.workspaces),
            "poll_interval_seconds": settings.poll_interval_seconds,
            "tools": {"core": tool(settings.core_cli),
                      "project-governance": tool(settings.governance_cli)},
        }

    @router.get("/workspaces/{workspace_id}/views/{view}")
    async def read_view(
        workspace_id: str,
        view: str,
        project_id: str | None = None,
        scope_id: str | None = None,
        request_id: str | None = None,
        evidence_id: str | None = None,
        sha256: str | None = None,
        submission_index: int | None = None,
        offset: int | None = None,
        limit: int | None = None,
        include_descendants: bool = False,
        include_related: bool = False,
    ):
        selector = dict(
            project_id=project_id, scope_id=scope_id, request_id=request_id,
            evidence_id=evidence_id, sha256=sha256, submission_index=submission_index,
            offset=offset, limit=limit, include_descendants=include_descendants,
            include_related=include_related,
        )
        try:
            return await sources.get(workspace_id, view, selector)
        except (UnknownWorkspace, SelectorError, ToolError) as error:
            raise _http_error(error) from None

    @router.get("/workspaces/{workspace_id}/evidence-preview")
    async def evidence_preview(
        workspace_id: str,
        request_id: str,
        submission_index: int,
        evidence_id: str,
        sha256: str,
    ):
        try:
            workspace = sources.workspace(workspace_id)
            selector = normalize_selector("evidence", dict(
                request_id=request_id, submission_index=submission_index,
                evidence_id=evidence_id, sha256=sha256))
            raw = await sources.raw(workspace, "evidence", selector)
        except (UnknownWorkspace, SelectorError, ToolError) as error:
            raise _http_error(error) from None
        redact = path_redactor(workspace)
        item = (raw or {}).get("evidence")
        if not raw or raw.get("ok") is not True or not isinstance(item, dict):
            return {"ok": False, "selector": selector,
                    "error": redact(source_error(GOVERNANCE, raw or {}))}
        result = await asyncio.to_thread(
            evidence.preview, workspace, item, settings.evidence_preview_max_bytes)
        # File content is evidence and is shown as recorded; only metadata is relabelled.
        content = result.pop("content", None)
        return {
            "ok": True,
            "selector": selector,
            "recorded_reference": raw.get("recorded_reference"),
            "snapshot_integrity": raw.get("snapshot_integrity"),
            "source_note": raw.get("note"),
            "preview": {**redact(result), "content": content},
        }

    @router.get("/workspaces/{workspace_id}/stream")
    async def stream(
        workspace_id: str,
        project_id: str | None = Query(None),
        request_id: str | None = Query(None),
    ):
        try:
            sources.workspace(workspace_id)
            watches = [("open", {}),
                       ("tree", normalize_selector("tree", {"project_id": project_id}))]
            if request_id is not None:
                watches.append(("now", normalize_selector("now", {"request_id": request_id})))
        except (UnknownWorkspace, SelectorError) as error:
            raise _http_error(error) from None
        return StreamingResponse(
            version_stream(sources, workspace_id, watches, settings.poll_interval_seconds),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return router
