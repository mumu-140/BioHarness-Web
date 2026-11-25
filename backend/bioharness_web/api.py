"""Read-only application API: snapshots, evidence preview and change notifications."""
from __future__ import annotations

import asyncio
import os
import shutil

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from . import evidence
from .cli import ToolError
from .runtime import Runtime, RuntimeRefusal
from .settings import Settings
from .sources import (GOVERNANCE, SelectorError, Sources, UnknownWorkspace, source_error,
                      normalize_selector, path_redactor)
from .stream import conversation_stream, version_stream


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


MAX_MESSAGE_CHARS = 50_000  # one user message; large data is referenced, not pasted


class Scope(BaseModel):
    """The research scope the user chose for a new request; Core validates it."""

    model_config = ConfigDict(extra="forbid")
    id: str = Field(max_length=200)
    create: bool = False
    parent_id: str | None = Field(None, max_length=200)
    related_request_ids: list[Annotated[str, Field(max_length=200)]] | None = Field(None, max_length=50)


class NewConversation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str | None = Field(None, max_length=MAX_MESSAGE_CHARS)
    request_id: str | None = Field(None, max_length=200)
    scope: Scope | None = None


class NewRun(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str | None = Field(None, max_length=MAX_MESSAGE_CHARS)  # absent: resume from Core's state


class Attach(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(max_length=200)


def _public(conversation: dict) -> dict:
    # The session identity Core's hooks see never leaves the server.
    return {key: value for key, value in conversation.items() if key != "native_session"}


def _refusal(error: RuntimeRefusal) -> HTTPException:
    return HTTPException(error.status, {"origin": "web", "code": error.code, "message": error.message})


def create_runtime_router(runtime: Runtime, settings: Settings) -> APIRouter:
    """Conversations and runs of the native runtime. A run lives in the backend; these
    routes start it, watch it and ask for its cancellation."""
    router = APIRouter(prefix="/api/workspaces/{workspace_id}/conversations",
                       dependencies=[Depends(_no_store)])

    def workspace_exists(workspace_id: str) -> None:
        if workspace_id not in settings.workspaces:
            raise HTTPException(404, {"origin": "web", "code": "WORKSPACE_UNKNOWN",
                                      "message": "unknown workspace"})

    @router.get("")
    def list_conversations(workspace_id: str):
        workspace_exists(workspace_id)
        return [_public(item) for item in runtime.ledger.conversations(workspace_id)]

    @router.post("", status_code=201)
    async def new_conversation(workspace_id: str, body: NewConversation):
        workspace_exists(workspace_id)
        if body.request_id and body.scope:
            raise HTTPException(422, {"origin": "web", "code": "SCOPE_NOT_APPLICABLE",
                                      "message": "a scope is chosen only when a new request begins"})
        if not body.request_id and not (body.text or "").strip():
            raise HTTPException(422, {"origin": "web", "code": "QUESTION_REQUIRED",
                                      "message": "give the question, or the request to continue"})
        conversation = runtime.create(workspace_id)
        run_id = None
        try:
            if body.request_id:
                await runtime.attach(workspace_id, conversation["id"], body.request_id)
            if body.text is not None and body.text.strip():
                scope = body.scope.model_dump(exclude_none=True) if body.scope else None
                run_id = runtime.start_run(workspace_id, conversation["id"], body.text, scope)
        except RuntimeRefusal as error:
            runtime.ledger.discard_unused(conversation["id"])  # nothing was started for it
            raise _refusal(error) from None
        return {"conversation": _public(runtime.ledger.conversation(conversation["id"])), "run_id": run_id}

    @router.get("/{conversation_id}")
    async def get_conversation(workspace_id: str, conversation_id: str):
        workspace_exists(workspace_id)
        try:
            candidates, listing = await runtime.begin_candidates(workspace_id, conversation_id)
        except RuntimeRefusal as error:
            raise _refusal(error) from None
        except ToolError as error:
            raise _http_error(error) from None
        conversation = runtime.ledger.conversation(conversation_id)
        return {
            "conversation": _public(conversation),
            "active_run": runtime.ledger.active_run(conversation_id),
            # Why the conversation has no request although science_begin was sent, if so:
            # OUTCOME_UNKNOWN (no answer) or EXISTING_REQUEST (Core answered with a request
            # that already existed). Either way the user attaches a request explicitly.
            "begin_reconcile": runtime.begin_reconcile(conversation_id),
            "begin_candidates": path_redactor(settings.workspaces[workspace_id])(candidates),
            # Core lists at most 20 open requests: a request may exist without being a candidate.
            "open_listing": listing,
        }

    @router.put("/{conversation_id}/request")
    async def attach_request(workspace_id: str, conversation_id: str, body: Attach):
        workspace_exists(workspace_id)
        try:
            return {"conversation": _public(await runtime.attach(workspace_id, conversation_id, body.request_id))}
        except RuntimeRefusal as error:
            raise _refusal(error) from None

    @router.post("/{conversation_id}/runs", status_code=202)
    async def new_run(workspace_id: str, conversation_id: str, body: NewRun):
        workspace_exists(workspace_id)
        text = body.text if body.text is not None and body.text.strip() else None
        try:
            return {"run_id": runtime.start_run(workspace_id, conversation_id, text)}
        except RuntimeRefusal as error:
            raise _refusal(error) from None

    @router.post("/{conversation_id}/runs/{run_id}/cancel", status_code=202)
    async def cancel_run(workspace_id: str, conversation_id: str, run_id: str):
        workspace_exists(workspace_id)
        try:
            runtime.cancel(workspace_id, conversation_id, run_id)
        except RuntimeRefusal as error:
            raise _refusal(error) from None
        # Requested, not yet confirmed: the run's final event says how it ended.
        return {"cancel": "REQUESTED"}

    @router.get("/{conversation_id}/events")
    async def conversation_events(workspace_id: str, conversation_id: str, request: Request,
                                  after: int = Query(0, ge=0)):
        workspace_exists(workspace_id)
        conversation = runtime.ledger.conversation(conversation_id)
        if conversation is None or conversation["workspace"] != workspace_id:
            raise HTTPException(404, {"origin": "web", "code": "CONVERSATION_UNKNOWN",
                                      "message": "unknown conversation"})
        resumed = request.headers.get("last-event-id", "")
        start = max(after, int(resumed)) if resumed.isdigit() else after
        return StreamingResponse(
            conversation_stream(runtime, conversation_id, start),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return router


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
            # Whether this service can conduct work itself; the read side works either way.
            "runtime": {"enabled": settings.runtime_enabled,
                        "model": settings.model.name if settings.model else None,
                        "module_tool_servers": sorted(settings.mcp_servers)},
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
