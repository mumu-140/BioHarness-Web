"""R3.3 thin BFF for Memory MCP, Core resources/doctor, workspace SKILL.md,
Governance project documents, and redacted diagnostics.

No second Registry, Memory store, or Curator engine is created here: every query
forwards to the configured authoritative Core/Governance/Memory public interface.
"""
from __future__ import annotations

import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import domain_modules, mcp_tools
from .cli import CliRunner, ToolError
from .ledger import Ledger
from .settings import Settings, Workspace
from .sources import CORE_STATE_DIRECTORIES, Sources, path_redactor

_MAX_SKILL_BYTES = 32 * 1024
_MAX_DOC_SCAN = 40
_SAFE_DOC_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}\.(?:md|txt)$", re.IGNORECASE)
_CURATOR_GAP_NOTE = (
    "当前已安装的 bioharness-module-memory MCP 仅公开检索、展开、使用反馈、候选提案"
    "与只读诊断；交互式 Curator 审核发布（inspect_proposal / publish_reviewed）与受控 "
    "T3 来源登记（source_registration）目前属于 Memory 运维 CLI 边界，需 BioHarness-Modules "
    "暴露受控公开接口后接入。"
)
_DEEP_UNAVAILABLE_NOTE = (
    "bioharness-module-memory 当前仅公开 FAST 与 STANDARD 检索深度；DEEP 模式尚未公开"
    "（抛出 RECALL_MODE_NOT_IMPLEMENTED），且与 T3 原始来源展开属于独立维度。"
)


class CapabilityError(Exception):
    def __init__(self, code: str, message: str, status: int = 400, detail: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.detail = detail or {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _core_state_present(workspace: Workspace) -> bool:
    state = workspace.path / ".bioharness"
    return all((state / name).is_dir() for name in CORE_STATE_DIRECTORIES)


def _mcp_argv(raw_argv: tuple[str, ...], workspace: Workspace) -> list[str]:
    return [arg.replace("{workspace}", str(workspace.path)) for arg in raw_argv]


def _parse_mcp_payload(result: dict[str, Any]) -> dict[str, Any]:
    structured = result.get("structured_content")
    if isinstance(structured, dict):
        return structured
    text = str(result.get("text") or "").strip()
    if text:
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict):
                return parsed
            return {"value": parsed}
        except ValueError:
            return {"raw_text": text}
    return {}


async def discover_mcp_servers(
    settings: Settings,
    workspace: Workspace,
    *,
    probe: bool = False,
) -> dict[str, dict[str, Any]]:
    """Inspect configured MCP servers cleanly without fabricating callable status."""
    out: dict[str, dict[str, Any]] = {}
    for server_name, raw_argv in sorted(settings.mcp_servers.items()):
        argv = _mcp_argv(raw_argv, workspace)
        cmd = argv[0] if argv else ""
        cmd_found = bool(cmd) and (Path(cmd).is_file() or shutil.which(cmd) is not None)
        entry: dict[str, Any] = {
            "server": server_name,
            "command": Path(cmd).name if cmd else "",
            "declared": True,
            "installed": cmd_found,
            "callable": None,
            "tools": [],
            "error": None,
        }
        if probe:
            try:
                specs = await mcp_tools.list_tools(
                    argv,
                    timeout=min(15.0, settings.tool_timeout_seconds),
                    env_passthrough=settings.tool_env_passthrough,
                    cwd=str(workspace.path),
                )
                entry["installed"] = True
                entry["callable"] = True
                entry["tools"] = [{"name": s.name, "description": s.description} for s in specs]
            except ToolError as exc:
                entry["callable"] = False
                entry["error"] = {"code": exc.code, "message": exc.message}
        out[server_name] = entry
    return out


async def resolve_memory_server(
    settings: Settings,
    workspace: Workspace,
) -> tuple[str, list[str], set[str]] | None:
    """Find an explicitly configured MCP server that actually exposes Memory tools."""
    candidates = sorted(
        settings.mcp_servers.items(),
        key=lambda item: (0 if "memory" in item[0].lower() else 1, item[0]),
    )
    for server_name, raw_argv in candidates:
        argv = _mcp_argv(raw_argv, workspace)
        try:
            specs = await mcp_tools.list_tools(
                argv,
                timeout=min(15.0, settings.tool_timeout_seconds),
                env_passthrough=settings.tool_env_passthrough,
                cwd=str(workspace.path),
            )
        except ToolError:
            continue
        tool_names = {s.name for s in specs}
        if "memory_recall" in tool_names and "memory_status" in tool_names:
            return server_name, argv, tool_names
    return None


async def call_memory_tool(
    settings: Settings,
    workspace: Workspace,
    tool_name: str,
    arguments: dict[str, Any],
) -> tuple[str, dict[str, Any], set[str]]:
    resolved = await resolve_memory_server(settings, workspace)
    if resolved is None:
        raise CapabilityError(
            "MEMORY_MCP_UNAVAILABLE",
            "当前运行环境未配置或无法连接 Memory MCP 服务（需在 BIOHARNESS_WEB_MCP_SERVERS 中配置 bioharness-memory-mcp）。",
            503,
        )
    server_name, argv, tool_names = resolved
    if tool_name not in tool_names:
        raise CapabilityError(
            "MEMORY_TOOL_UNEXPOSED",
            f"Memory MCP 服务 {server_name} 未公开工具 {tool_name}。",
            501,
            {"server": server_name, "available_tools": sorted(tool_names)},
        )
    try:
        raw = await mcp_tools.call_tool(
            argv,
            tool_name,
            arguments,
            timeout=settings.module_tool_timeout_seconds,
            env_passthrough=settings.tool_env_passthrough,
            cwd=str(workspace.path),
        )
    except ToolError as exc:
        raise CapabilityError(exc.code, exc.message, 502) from None
    payload = _parse_mcp_payload(raw)
    if raw.get("is_error"):
        msg = str(payload.get("raw_text") or payload.get("message") or raw.get("text") or f"{tool_name} failed")
        status = 422 if "INVALID" in msg or "RECALL_" in msg else 502
        raise CapabilityError("MEMORY_TOOL_REFUSED", msg, status, {"payload": payload})
    return server_name, payload, tool_names


async def fetch_memory_overview(settings: Settings, workspace: Workspace) -> dict[str, Any]:
    resolved = await resolve_memory_server(settings, workspace)
    checked_at = _now_iso()
    if resolved is None:
        return {
            "configured": any("memory" in name.lower() for name in settings.mcp_servers),
            "callable": False,
            "server": None,
            "checked_at": checked_at,
            "tools": [],
            "status": None,
            "diagnose": None,
            "capabilities": {
                "recall_modes": {"FAST": False, "STANDARD": False, "DEEP": False},
                "deep_unavailable_reason": _DEEP_UNAVAILABLE_NOTE,
                "curator_interactive_publish": False,
                "curator_gap_note": _CURATOR_GAP_NOTE,
            },
            "error": {
                "code": "MEMORY_MCP_UNAVAILABLE",
                "message": "当前运行环境未配置或无法调用 Memory MCP 服务；请检查服务端 BIOHARNESS_WEB_MCP_SERVERS 配置。",
            },
        }
    server_name, argv, tool_names = resolved
    curator_tools = sorted(t for t in tool_names if "curator" in t.lower() or "publish" in t.lower())
    try:
        status_raw = await mcp_tools.call_tool(
            argv, "memory_status", {},
            timeout=min(30.0, settings.module_tool_timeout_seconds),
            env_passthrough=settings.tool_env_passthrough,
            cwd=str(workspace.path),
        )
        diag_raw = (
            await mcp_tools.call_tool(
                argv, "memory_diagnose", {},
                timeout=min(30.0, settings.module_tool_timeout_seconds),
                env_passthrough=settings.tool_env_passthrough,
                cwd=str(workspace.path),
            )
            if "memory_diagnose" in tool_names
            else None
        )
    except ToolError as exc:
        return {
            "configured": True,
            "callable": False,
            "server": server_name,
            "checked_at": checked_at,
            "tools": sorted(tool_names),
            "status": None,
            "diagnose": None,
            "capabilities": {
                "recall_modes": {"FAST": False, "STANDARD": False, "DEEP": False},
                "deep_unavailable_reason": _DEEP_UNAVAILABLE_NOTE,
                "curator_interactive_publish": bool(curator_tools),
                "curator_gap_note": _CURATOR_GAP_NOTE,
            },
            "error": {"code": exc.code, "message": exc.message},
        }
    if status_raw.get("is_error"):
        return {
            "configured": True,
            "callable": False,
            "server": server_name,
            "checked_at": checked_at,
            "tools": sorted(tool_names),
            "status": None,
            "diagnose": None,
            "capabilities": {
                "recall_modes": {"FAST": False, "STANDARD": False, "DEEP": False},
                "deep_unavailable_reason": _DEEP_UNAVAILABLE_NOTE,
                "curator_interactive_publish": bool(curator_tools),
                "curator_gap_note": _CURATOR_GAP_NOTE,
            },
            "error": {"code": "MEMORY_STATUS_FAILED", "message": status_raw.get("text") or "memory_status failed"},
        }
    status_data = _parse_mcp_payload(status_raw)
    diag_data = _parse_mcp_payload(diag_raw) if (diag_raw and not diag_raw.get("is_error")) else None
    return {
        "configured": True,
        "callable": True,
        "server": server_name,
        "checked_at": checked_at,
        "tools": sorted(tool_names),
        "status": status_data,
        "diagnose": diag_data,
        "capabilities": {
            "recall_modes": {"FAST": True, "STANDARD": True, "DEEP": False},
            "deep_unavailable_reason": _DEEP_UNAVAILABLE_NOTE,
            "curator_interactive_publish": bool(curator_tools),
            "curator_tools": curator_tools,
            "curator_gap_note": None if curator_tools else _CURATOR_GAP_NOTE,
        },
        "error": None,
    }


def _parse_skill_frontmatter(text: str, fallback_name: str) -> tuple[str, str]:
    name = fallback_name
    desc = ""
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 3:
            for line in parts[1].splitlines():
                if ":" not in line:
                    continue
                k, v = line.split(":", 1)
                k = k.strip().lower()
                v = v.strip().strip("\"\x27")
                if k == "name" and v:
                    name = v
                elif k == "description" and v:
                    desc = v
    if not desc:
        for line in text.splitlines():
            s = line.strip().lstrip("#").strip()
            if s and s != "---":
                desc = s[:180]
                break
    return name, desc


def scan_workspace_skills(workspace: Workspace) -> list[dict[str, Any]]:
    redact = path_redactor(workspace)
    ws_root = workspace.path.resolve()
    skills: list[dict[str, Any]] = []
    seen: set[Path] = set()
    for base_rel in (".claude/skills", "skills"):
        base = workspace.path / base_rel
        if base.is_symlink() or not base.is_dir():
            continue
        try:
            entries = sorted(base.iterdir(), key=lambda p: p.name.lower())
        except OSError:
            continue
        for entry in entries:
            if entry.is_symlink() or not entry.is_dir():
                continue
            skill_md = entry / "SKILL.md"
            if skill_md.is_symlink() or not skill_md.is_file():
                continue
            try:
                resolved = skill_md.resolve()
            except OSError:
                continue
            if not resolved.is_relative_to(ws_root) or resolved in seen:
                continue
            seen.add(resolved)
            try:
                raw = resolved.read_bytes()[: _MAX_SKILL_BYTES + 1]
            except OSError:
                continue
            truncated = len(raw) > _MAX_SKILL_BYTES
            text = raw[:_MAX_SKILL_BYTES].decode("utf-8", errors="replace")
            name, desc = _parse_skill_frontmatter(text, entry.name)
            skills.append({
                "id": entry.name,
                "name": name,
                "description": desc,
                "source": redact(str(resolved)),
                "truncated": truncated,
                "declared": True,
                "installed": True,
                "callable": None,
                "callable_note": "Markdown 技能指南，由 Agent 按需读取引用，非独立可执行 RPC",
            })
    return skills


def list_workspace_doc_candidates(workspace: Workspace) -> list[str]:
    """List workspace-relative .md/.txt files eligible for Governance context(documents=...)."""
    ws_root = workspace.path.resolve()
    state_dir = (workspace.path / ".bioharness").resolve()
    docs: list[str] = []
    for entry in sorted(workspace.path.iterdir(), key=lambda p: p.name.lower()):
        if entry.name.startswith(".") or entry.is_symlink() or not entry.is_file():
            continue
        if entry.suffix.lower() not in {".md", ".txt"}:
            continue
        try:
            resolved = entry.resolve()
        except OSError:
            continue
        if not resolved.is_relative_to(ws_root) or resolved.is_relative_to(state_dir):
            continue
        if resolved.stat().st_size > 65536:
            continue
        docs.append(str(resolved.relative_to(ws_root)))
        if len(docs) >= _MAX_DOC_SCAN:
            break
    return docs


async def build_capabilities_snapshot(
    *,
    settings: Settings,
    sources: Sources,
    runner: CliRunner,
    ledger: Ledger | None,
    workspace_id: str,
    scope_id: str | None = None,
    request_id: str | None = None,
    probe_mcp: bool = False,
    documents: dict[str, str] | None = None,
) -> dict[str, Any]:
    workspace = sources.workspace(workspace_id)
    redact = path_redactor(workspace)
    core_present = _core_state_present(workspace)

    # 1. Core doctor (only when .bioharness already exists, so read-only checks never initialize state)
    doctor_report: dict[str, Any] | None = None
    doctor_error: str | None = None
    declared_resources_from_doctor: list[dict[str, str]] = []
    if core_present:
        try:
            doctor_report = await runner.run_json(
                [settings.core_cli, "doctor", f"--workspace={workspace.path}"],
                timeout=min(30.0, settings.tool_timeout_seconds),
            )
            for chk in (doctor_report or {}).get("checks") or []:
                if chk.get("check") == "resources" and chk.get("status") == "OK":
                    detail = str(chk.get("detail") or "")
                    for token in detail.split(","):
                        token = token.strip()
                        if ":" in token:
                            kind, rid = token.split(":", 1)
                            declared_resources_from_doctor.append({"kind": kind.strip(), "id": rid.strip()})
        except ToolError as exc:
            doctor_error = f"{exc.code}: {exc.message}"

    # 2. Core resources from science_now (if request_id given)
    now_resources: list[dict[str, Any]] = []
    if core_present and request_id:
        try:
            now_snap = await sources.get(workspace_id, "now", {"request_id": request_id})
            if now_snap.get("ok") and isinstance(now_snap.get("data"), dict):
                nd = now_snap["data"]
                for item in nd.get("available_resources") or []:
                    if isinstance(item, dict):
                        now_resources.append(item)
                step = nd.get("step")
                if isinstance(step, dict):
                    for item in step.get("use_resources") or []:
                        if isinstance(item, dict) and not any(x.get("id") == item.get("id") for x in now_resources):
                            now_resources.append(item)
        except ToolError:
            pass

    # 3. Observed actual usage in Web SQLite ledger
    observed = ledger.observed_module_usage(workspace_id) if ledger is not None else {
        "servers": {}, "tools": {}, "total_tool_calls": 0,
    }

    # Merge Core declared resources with observed usage & MCP availability
    mcp_servers = await discover_mcp_servers(settings, workspace, probe=probe_mcp)
    resources_out: list[dict[str, Any]] = []
    seen_res_ids: set[str] = set()
    for r in now_resources:
        rid = str(r.get("id") or "")
        seen_res_ids.add(rid)
        used_count = int(observed["servers"].get(rid, 0) + observed["tools"].get(rid, 0))
        resources_out.append({
            **r,
            "declared": True,
            "installed": True,
            "callable": None if not probe_mcp else (mcp_servers.get(rid, {}).get("callable") if rid in mcp_servers else None),
            "actually_used": used_count > 0,
            "use_count": used_count,
        })
    for r in declared_resources_from_doctor:
        if r["id"] in seen_res_ids:
            continue
        rid = r["id"]
        used_count = int(observed["servers"].get(rid, 0) + observed["tools"].get(rid, 0))
        resources_out.append({
            "id": rid,
            "kind": r["kind"],
            "title": rid,
            "declared": True,
            "installed": True,
            "callable": mcp_servers.get(rid, {}).get("callable") if rid in mcp_servers else None,
            "actually_used": used_count > 0,
            "use_count": used_count,
        })

    # 4. Workspace SKILL.md entries with four-state tracking
    skills_out = []
    for sk in scan_workspace_skills(workspace):
        used_count = int(observed["tools"].get(sk["id"], 0))
        skills_out.append({**sk, "actually_used": used_count > 0, "use_count": used_count})

    # 5. Governance project documents (contract / guide / status / findings_index)
    doc_candidates = list_workspace_doc_candidates(workspace)
    selected_docs = documents
    if selected_docs is None:
        role_defaults = {
            "contract": ("CONTRACT.md", "contract.md"),
            "guide": ("GUIDE.md", "guide.md", "README.md"),
            "status": ("STATUS.md", "status.md"),
            "findings_index": ("FINDINGS.md", "findings_index.md", "findings.md"),
        }
        auto_docs: dict[str, str] = {}
        lower_map = {c.lower(): c for c in doc_candidates}
        for role, names in role_defaults.items():
            for candidate in names:
                if candidate.lower() in lower_map:
                    auto_docs[role] = lower_map[candidate.lower()]
                    break
        selected_docs = auto_docs

    governance_docs: dict[str, Any] = {}
    governance_docs_error: str | None = None
    if scope_id and core_present and selected_docs:
        clean_docs = {
            k: v for k, v in selected_docs.items()
            if k in {"contract", "guide", "status", "findings_index"} and _SAFE_DOC_NAME.fullmatch(v)
        }
        if clean_docs:
            try:
                ctx_raw = await runner.run_json([
                    settings.governance_cli,
                    f"--workspace={workspace.path}",
                    "context",
                    f"--scope-id={scope_id}",
                    f"--documents-json={json.dumps(clean_docs)}",
                ])
                if ctx_raw.get("ok"):
                    governance_docs = ((ctx_raw.get("shared") or {}).get("documents")) or {}
                else:
                    governance_docs_error = str(ctx_raw.get("error") or "governance context refused")
            except ToolError as exc:
                governance_docs_error = f"{exc.code}: {exc.message}"

    # 6. Known CLI modules real callability & observed usage (actively probed, never assumed from PATH alone)
    cli_modules = []
    lit_provider_ok = (
        domain_modules.probe_cli_callable(settings.paperseek_cli, ("--help",))["callable"]
        or domain_modules.probe_cli_callable(settings.scansci_cli, ("--help",))["callable"]
    )
    for mod_id, cmd_name, probe_args, desc in (
        ("core", settings.core_cli, ("--help",), "BioHarness Core 主线协调器 (bioharness-host)"),
        ("project-governance", settings.governance_cli, ("--help",), "项目树、上下文与证据引用只读投影 (bioharness-governance)"),
        ("literature", settings.literature_cli, ("--help",), "文献检索与获取 CLI 适配器 (KnowledgeSeek + ScanSci)"),
        ("statistics", settings.statistics_cli, ("--help",), "统计学报告确定性绑定与数值一致性校验"),
        ("protein-methods", settings.protein_cli, ("--version",), "蛋白结构与设计审计 CLI"),
    ):
        probe = domain_modules.probe_cli_callable(cmd_name, probe_args)
        is_callable = probe["callable"] and (lit_provider_ok if mod_id == "literature" else True)
        by_srv = int(observed["servers"].get(mod_id, 0))
        by_tool = sum(
            int(cnt) for name, cnt in observed["tools"].items()
            if name == mod_id or name.startswith(f"{mod_id}:")
        )
        used_count = max(by_srv, by_tool)
        cli_modules.append({
            "id": mod_id,
            "command": Path(cmd_name).name,
            "description": desc,
            "declared": True,
            "installed": probe["installed"],
            "callable": is_callable,
            "actually_used": used_count > 0,
            "use_count": used_count,
        })

    for srv_name, srv_info in mcp_servers.items():
        srv_info["actually_used"] = observed["servers"].get(srv_name, 0) > 0
        srv_info["use_count"] = observed["servers"].get(srv_name, 0)

    return redact({
        "service": settings.service_id,
        "workspace": workspace_id,
        "observed_at": _now_iso(),
        "core_state_present": core_present,
        "doctor": doctor_report,
        "doctor_error": doctor_error,
        "resources": resources_out,
        "skills": skills_out,
        "mcp_servers": list(mcp_servers.values()),
        "cli_modules": cli_modules,
        "documents": {
            "scope_id": scope_id,
            "candidates": doc_candidates,
            "selected": selected_docs,
            "loaded": governance_docs,
            "error": governance_docs_error,
        },
        "observed_usage": observed,
        "compute": {
            "remote_compute_enabled": False,
            "phase": "R4_DEFERRED",
            "note": "外部计算托管、长作业断点恢复与多机并发属于 R4 范围，当前版本不提供虚假远端调度按钮。",
        },
    })


async def build_diagnostics_report(
    *,
    settings: Settings,
    sources: Sources,
    runner: CliRunner,
    ledger: Ledger | None,
    workspace_id: str,
) -> dict[str, Any]:
    """Redacted operational & security posture report suitable for Settings → Diagnostics export."""
    workspace = sources.workspace(workspace_id)
    caps = await build_capabilities_snapshot(
        settings=settings,
        sources=sources,
        runner=runner,
        ledger=ledger,
        workspace_id=workspace_id,
        probe_mcp=True,
    )
    mem = await fetch_memory_overview(settings, workspace)
    return {
        "service": settings.service_id,
        "workspace": workspace_id,
        "exported_at": _now_iso(),
        "security_posture": {
            "auth_mode": "service_access_token_httponly_cookie",
            "token_length_ok": len(settings.access_token) >= 16,
            "upload_root_configured": workspace.upload_root is not None,
            "symlink_containment_enforced": True,
            "provider_keys_server_side_only": True,
            "arbitrary_shell_blocked": True,
            "remote_compute_enabled": False,
        },
        "runtime": {
            "enabled": settings.runtime_enabled,
            "model_configured": settings.model.name if settings.model else None,
            "mcp_servers": caps["mcp_servers"],
        },
        "core_doctor": caps["doctor"],
        "core_doctor_error": caps["doctor_error"],
        "memory": {
            "configured": mem["configured"],
            "callable": mem["callable"],
            "server": mem["server"],
            "status": mem["status"],
            "diagnose": mem["diagnose"],
            "error": mem["error"],
        },
        "cli_modules": caps["cli_modules"],
    }
