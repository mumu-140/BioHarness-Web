"""Read-only application API: snapshots, evidence preview and change notifications."""
from __future__ import annotations

import asyncio
import os
import shutil

from typing import Annotated, Any, Literal
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from . import capabilities, evidence, inputs
from .cli import ToolError
from .model_config import ModelConfigStore
from .runtime import Runtime, RuntimeRefusal, run_strategies
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


class ModelOverride(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider_id: str = Field(min_length=1, max_length=64)
    model: str = Field(min_length=1, max_length=200)


class NewConversation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str | None = Field(None, max_length=MAX_MESSAGE_CHARS)
    request_id: str | None = Field(None, max_length=200)
    scope: Scope | None = None
    model_override: ModelOverride | None = None
    strategy: Literal["standard", "concise", "thorough"] | None = None


class NewRun(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str | None = Field(None, max_length=MAX_MESSAGE_CHARS)  # absent: resume from Core's state
    model_override: ModelOverride | None = None
    strategy: Literal["standard", "concise", "thorough"] | None = None


class Attach(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(max_length=200)


class MemoryRecallBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: str = Field(min_length=1, max_length=2000)
    task_conditions: dict[str, str] | None = None
    mode: Literal["FAST", "STANDARD", "DEEP"] = "FAST"
    limit: int = Field(default=10, ge=1, le=32)


class MemoryExpandBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    memory_ref: str = Field(min_length=1, max_length=200)
    task_conditions: dict[str, str] | None = None
    detail: Literal["T1", "T2", "T3"] = "T2"


class MemoryReportUseBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    event_id: str = Field(min_length=1, max_length=128)
    memory_ref: str = Field(min_length=1, max_length=128)
    task_ref: str = Field(min_length=1, max_length=128)
    stage: Literal["selected", "consumed", "outcome_reported"]
    outcome: Literal["reported_success", "reported_failure", "reported_unknown"] | None = None


class MemoryProposeBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["candidate", "scientific"] = "candidate"
    event_id: str = Field(min_length=1, max_length=128)
    summary: str | None = Field(default=None, max_length=1500)
    evidence_locator: str = Field(default="", max_length=240)
    memory_id: str | None = Field(default=None, max_length=128)
    t1_core: str | None = Field(default=None, max_length=600)
    t2_detail: dict[str, Any] | None = None
    required_conditions: dict[str, str] | None = None
    evidence: list[dict[str, Any]] | None = None


def _public(conversation: dict) -> dict:
    # The session identity Core's hooks see never leaves the server.
    return {key: value for key, value in conversation.items() if key != "native_session"}


def _refusal(error: RuntimeRefusal) -> HTTPException:
    return HTTPException(error.status, {"origin": "web", "code": error.code, "message": error.message})


def create_runtime_router(
    runtime: Runtime, settings: Settings, model_store: ModelConfigStore | None = None
) -> APIRouter:
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
        resolved_override = None
        override_pid = None
        if body.model_override is not None:
            if model_store is None:
                raise HTTPException(
                    422,
                    {"origin": "web", "code": "MODEL_OVERRIDE_UNAVAILABLE",
                     "message": "当前运行模式不支持按次模型覆盖。"},
                )
            resolved_override = model_store.resolve_model_override(
                body.model_override.provider_id, body.model_override.model
            )
            override_pid = body.model_override.provider_id
        conversation = runtime.create(workspace_id)
        run_id = None
        try:
            if body.request_id:
                await runtime.attach(workspace_id, conversation["id"], body.request_id)
            if body.text is not None and body.text.strip():
                scope = body.scope.model_dump(exclude_none=True) if body.scope else None
                run_id = runtime.start_run(
                    workspace_id,
                    conversation["id"],
                    body.text,
                    scope,
                    model_override=resolved_override,
                    provider_id=override_pid,
                    strategy=body.strategy,
                )
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

    @router.get("/{conversation_id}/invocations")
    def invocations(workspace_id: str, conversation_id: str,
                    before: int | None = Query(None, ge=1, le=2**63 - 1),
                    limit: int = Query(50, ge=1, le=100)):
        workspace_exists(workspace_id)
        try:
            return runtime.invocations(workspace_id, conversation_id, before, limit)
        except RuntimeRefusal as error:
            raise _refusal(error) from None

    @router.get("/{conversation_id}/modules")
    def modules(workspace_id: str, conversation_id: str):
        workspace_exists(workspace_id)
        try:
            return runtime.modules(workspace_id, conversation_id)
        except RuntimeRefusal as error:
            raise _refusal(error) from None

    @router.post("/{conversation_id}/runs", status_code=202)
    async def new_run(workspace_id: str, conversation_id: str, body: NewRun):
        workspace_exists(workspace_id)
        resolved_override = None
        override_pid = None
        if body.model_override is not None:
            if model_store is None:
                raise HTTPException(
                    422,
                    {"origin": "web", "code": "MODEL_OVERRIDE_UNAVAILABLE",
                     "message": "当前运行模式不支持按次模型覆盖。"},
                )
            resolved_override = model_store.resolve_model_override(
                body.model_override.provider_id, body.model_override.model
            )
            override_pid = body.model_override.provider_id
        text = body.text if body.text is not None and body.text.strip() else None
        try:
            return {
                "run_id": runtime.start_run(
                    workspace_id,
                    conversation_id,
                    text,
                    model_override=resolved_override,
                    provider_id=override_pid,
                    strategy=body.strategy,
                )
            }
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


def create_router(
    sources: Sources,
    settings: Settings,
    runtime: Runtime | None = None,
    model_store: ModelConfigStore | None = None,
) -> APIRouter:
    router = APIRouter(prefix="/api", dependencies=[Depends(_no_store)])

    @router.get("/meta")
    def meta():
        def tool(command: str) -> dict:
            # Found on PATH is not proof that a call works; only an answer is.
            return {"command": os.path.basename(command),
                    "found": shutil.which(command) is not None}

        active_model = (
            runtime.model.settings.name
            if runtime is not None
            else (settings.model.name if settings.model else None)
        )
        return {
            "service": settings.service_id,
            "workspaces": sorted(settings.workspaces),
            "workspace_details": {
                ws_id: {"upload_enabled": ws.upload_root is not None}
                for ws_id, ws in sorted(settings.workspaces.items())
            },
            "poll_interval_seconds": settings.poll_interval_seconds,
            "tools": {"core": tool(settings.core_cli),
                      "project-governance": tool(settings.governance_cli)},
            # Whether this service can conduct work itself; the read side works either way.
            "runtime": {
                "enabled": settings.runtime_enabled,
                "model": active_model,
                "module_tool_servers": sorted(settings.mcp_servers),
                **(
                    {
                        "available_models": model_store.available_models() if model_store is not None else [],
                        "strategies": run_strategies(settings),
                    }
                    if settings.runtime_enabled
                    else {}
                ),
            },
        }

    @router.get("/workspaces/{workspace_id}/inputs")
    def list_inputs(workspace_id: str):
        try:
            workspace = sources.workspace(workspace_id)
        except UnknownWorkspace as error:
            raise _http_error(error) from None
        return inputs.list_workspace_inputs(workspace, max_upload_bytes=settings.max_upload_bytes)

    @router.get("/workspaces/{workspace_id}/capabilities")
    async def workspace_capabilities(
        workspace_id: str,
        scope_id: str | None = None,
        request_id: str | None = None,
        probe_mcp: bool = False,
        doc_contract: str | None = None,
        doc_guide: str | None = None,
        doc_status: str | None = None,
        doc_findings_index: str | None = None,
    ):
        try:
            sources.workspace(workspace_id)
        except UnknownWorkspace as error:
            raise _http_error(error) from None
        selected_docs = {
            k: v
            for k, v in (
                ("contract", doc_contract),
                ("guide", doc_guide),
                ("status", doc_status),
                ("findings_index", doc_findings_index),
            )
            if v
        } or None
        return await capabilities.build_capabilities_snapshot(
            settings=settings,
            sources=sources,
            runner=sources.runner,
            ledger=runtime.ledger if runtime is not None else None,
            workspace_id=workspace_id,
            scope_id=scope_id,
            request_id=request_id,
            probe_mcp=probe_mcp,
            documents=selected_docs,
        )

    @router.get("/workspaces/{workspace_id}/diagnostics")
    async def workspace_diagnostics(workspace_id: str):
        try:
            sources.workspace(workspace_id)
        except UnknownWorkspace as error:
            raise _http_error(error) from None
        return await capabilities.build_diagnostics_report(
            settings=settings,
            sources=sources,
            runner=sources.runner,
            ledger=runtime.ledger if runtime is not None else None,
            workspace_id=workspace_id,
        )

    @router.get("/workspaces/{workspace_id}/memory/status")
    async def memory_status(workspace_id: str):
        try:
            ws = sources.workspace(workspace_id)
        except UnknownWorkspace as error:
            raise _http_error(error) from None
        return await capabilities.fetch_memory_overview(settings, ws)

    @router.post("/workspaces/{workspace_id}/memory/recall")
    async def memory_recall(workspace_id: str, body: MemoryRecallBody):
        try:
            ws = sources.workspace(workspace_id)
        except UnknownWorkspace as error:
            raise _http_error(error) from None
        if body.mode == "DEEP":
            raise HTTPException(
                501,
                {
                    "origin": "bioharness-module-memory",
                    "code": "RECALL_MODE_NOT_IMPLEMENTED",
                    "message": capabilities._DEEP_UNAVAILABLE_NOTE,
                },
            )
        try:
            server, payload, _ = await capabilities.call_memory_tool(
                settings,
                ws,
                "memory_recall",
                {
                    "query": body.query,
                    "task_conditions": body.task_conditions or {},
                    "mode": body.mode,
                    "limit": body.limit,
                },
            )
            return {"server": server, "mode": body.mode, "result": payload}
        except capabilities.CapabilityError as exc:
            raise HTTPException(
                exc.status,
                {"origin": "bioharness-module-memory", "code": exc.code, "message": exc.message, "detail": exc.detail},
            ) from None

    @router.post("/workspaces/{workspace_id}/memory/expand")
    async def memory_expand(workspace_id: str, body: MemoryExpandBody):
        try:
            ws = sources.workspace(workspace_id)
        except UnknownWorkspace as error:
            raise _http_error(error) from None
        try:
            server, payload, _ = await capabilities.call_memory_tool(
                settings,
                ws,
                "memory_expand",
                {
                    "memory_ref": body.memory_ref,
                    "task_conditions": body.task_conditions or {},
                    "detail": body.detail,
                },
            )
            return {"server": server, "detail": body.detail, "result": payload}
        except capabilities.CapabilityError as exc:
            raise HTTPException(
                exc.status,
                {"origin": "bioharness-module-memory", "code": exc.code, "message": exc.message, "detail": exc.detail},
            ) from None

    @router.post("/workspaces/{workspace_id}/memory/report-use")
    async def memory_report_use(workspace_id: str, body: MemoryReportUseBody):
        try:
            ws = sources.workspace(workspace_id)
        except UnknownWorkspace as error:
            raise _http_error(error) from None
        args: dict[str, object] = {
            "event_id": body.event_id,
            "memory_ref": body.memory_ref,
            "task_ref": body.task_ref,
            "stage": body.stage,
        }
        if body.outcome is not None:
            args["outcome"] = body.outcome
        try:
            server, payload, _ = await capabilities.call_memory_tool(
                settings, ws, "memory_report_use", args
            )
            return {"server": server, "result": payload}
        except capabilities.CapabilityError as exc:
            raise HTTPException(
                exc.status,
                {"origin": "bioharness-module-memory", "code": exc.code, "message": exc.message, "detail": exc.detail},
            ) from None

    @router.post("/workspaces/{workspace_id}/memory/propose")
    async def memory_propose(workspace_id: str, body: MemoryProposeBody):
        try:
            ws = sources.workspace(workspace_id)
        except UnknownWorkspace as error:
            raise _http_error(error) from None
        if body.kind == "scientific":
            if not (body.memory_id and body.t1_core and body.t2_detail and body.evidence):
                raise HTTPException(
                    422,
                    {"origin": "web", "code": "MEMORY_PROPOSAL_INCOMPLETE",
                     "message": "科学经验候选需提供 memory_id、t1_core、t2_detail 与 evidence 来源锚点。"},
                )
            tool_name = "memory_propose_scientific"
            args = {
                "event_id": body.event_id,
                "agent_ref": "bioharness-web-user",
                "session_ref": f"ws:{workspace_id}",
                "memory_id": body.memory_id,
                "t1_core": body.t1_core,
                "t2_detail": body.t2_detail,
                "required_conditions": body.required_conditions or {},
                "evidence": body.evidence,
            }
        else:
            if not (body.summary and body.summary.strip()):
                raise HTTPException(
                    422,
                    {"origin": "web", "code": "MEMORY_SUMMARY_REQUIRED", "message": "请填写候选经验摘要。"},
                )
            tool_name = "memory_capture_candidate"
            args = {
                "event_id": body.event_id,
                "agent_ref": "bioharness-web-user",
                "session_ref": f"ws:{workspace_id}",
                "summary": body.summary.strip(),
                "evidence_locator": body.evidence_locator,
            }
        try:
            server, payload, _ = await capabilities.call_memory_tool(settings, ws, tool_name, args)
            return {"server": server, "tool": tool_name, "result": payload}
        except capabilities.CapabilityError as exc:
            raise HTTPException(
                exc.status,
                {"origin": "bioharness-module-memory", "code": exc.code, "message": exc.message, "detail": exc.detail},
            ) from None

    @router.post("/workspaces/{workspace_id}/inputs", status_code=201)
    async def upload_input(workspace_id: str, request: Request):
        try:
            workspace = sources.workspace(workspace_id)
        except UnknownWorkspace as error:
            raise _http_error(error) from None
        raw_filename = unquote(request.headers.get("x-bioharness-filename", ""))
        raw_scope = unquote(request.headers.get("x-bioharness-scope", "")) or None
        limit = settings.max_upload_bytes
        chunks: list[bytes] = []
        total = 0
        async for chunk in request.stream():
            if not chunk:
                continue
            total += len(chunk)
            if total > limit:
                raise HTTPException(
                    413,
                    {
                        "origin": "web",
                        "code": "INPUT_TOO_LARGE",
                        "message": f"文件超过单文件上传上限（{limit // (1024 * 1024)} MiB）；大型数据集请保留在服务器存储并使用路径引用。",
                    },
                )
            chunks.append(chunk)
        try:
            return inputs.save_workspace_input(
                workspace,
                raw_filename,
                b"".join(chunks),
                scope_id=raw_scope,
                max_upload_bytes=limit,
            )
        except inputs.InputError as error:
            raise HTTPException(
                error.status,
                {"origin": "web", "code": error.code, "message": error.message},
            ) from None

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

    @router.api_route("/workspaces/{workspace_id}/evidence-content", methods=["GET", "HEAD"])
    async def evidence_content(
        request: Request,
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
            raise HTTPException(404, redact(source_error(GOVERNANCE, raw or {})))
        try:
            data, meta = await asyncio.to_thread(evidence.read_verified_content, workspace, item)
        except evidence.EvidenceContentError as err:
            raise HTTPException(err.status, {"origin": "web", "code": err.code,
                                             "message": err.message, **err.extra}) from None
        size = int(meta["size_bytes"])
        etag = f'"{meta["sha256"]}"'
        range_header = request.headers.get("range")
        if_range = request.headers.get("if-range")
        if range_header and if_range and if_range.strip() != etag:
            range_header = None
        try:
            start, end, is_partial = evidence.parse_byte_range(range_header, size)
        except evidence.EvidenceContentError as err:
            headers = {"Content-Range": f"bytes */{size}", "Accept-Ranges": "bytes", "Cache-Control": "no-store"}
            raise HTTPException(416, {"origin": "web", "code": err.code, "message": err.message},
                                headers=headers) from None

        length = (end - start + 1) if size > 0 else 0
        disposition = "inline" if meta["inline"] else "attachment"
        headers = {
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
            "Content-Length": str(length),
            "Content-Disposition": f'{disposition}; filename="{meta["safe_name"]}"',
            "ETag": etag,
            "X-Evidence-Identity": str(meta["current_file_identity"]),
            "X-Content-Type-Options": "nosniff",
        }
        if is_partial:
            headers["Content-Range"] = f"bytes {start}-{end}/{size}"
        status_code = 206 if is_partial else 200

        if request.method == "HEAD":
            return Response(status_code=status_code, media_type=meta["media_type"], headers=headers)

        # Return only bytes from the immutable buffer whose exact SHA-256 was
        # checked. Each range request independently verifies that same anchor.
        return Response(
            content=data[start:end + 1] if length else b"",
            status_code=status_code,
            media_type=meta["media_type"],
            headers=headers,
        )

    @router.get("/workspaces/{workspace_id}/evidence-table")
    async def evidence_table(
        workspace_id: str,
        request_id: str,
        submission_index: int,
        evidence_id: str,
        sha256: str,
        offset: int = Query(0, ge=0, le=1_000_000),
        limit: int = Query(100, ge=1, le=500),
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
        table = await asyncio.to_thread(
            evidence.table_page, workspace, item, offset=offset, limit=limit)
        # Keep cell values unmodified; redact only path/metadata fields outside rows.
        rows = table.pop("rows", [])
        columns = table.pop("columns", [])
        return {
            "ok": True,
            "selector": selector,
            "recorded_reference": raw.get("recorded_reference"),
            "snapshot_integrity": raw.get("snapshot_integrity"),
            "source_note": raw.get("note"),
            "table": {**redact(table), "columns": columns, "rows": rows},
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
