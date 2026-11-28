"""R3.4/R3-audit thin BFF for BioHarness professional scientific modules.

Strict architectural boundaries:
- Never re-implements literature search/fetch, statistical calculation, scientific review,
  or protein structure algorithms in Web.
- Zero hardcoded user home paths, domain vocabularies, or static module version strings:
  discovers installed versions and verifies CLI callability dynamically at runtime.
- Reuses the existing Web SQLite technical ledger (`ledger.py`) and authorized writable
  `upload_root` (`inputs.py`) for real invocation recording and deterministic artifact persistence.
"""
from __future__ import annotations

import hashlib
import json
import logging
import stat
import os
import re
import shutil
import subprocess
import tempfile
import tomllib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import evidence, inputs
from .cli import CliRunner, ToolError
from .ledger import Ledger
from .settings import Settings, Workspace
from .sources import path_redactor

log = logging.getLogger(__name__)

_MAX_INSPECT_BYTES = 4 * 1024 * 1024
_MAX_SCAN_FILES = 100
_PROTEIN_OPS = frozenset({
    "task-review",
    "manifest-review",
    "structure-inventory",
    "structure-compare",
    "run-audit",
    "outcome-audit",
})
_PROTEIN_MODES = frozenset({
    "paper-method-review",
    "intrinsic-capability-study",
    "hybrid-method-study",
})


class DomainModuleError(Exception):
    def __init__(self, code: str, message: str, status: int = 400, detail: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.detail = detail or {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _modules_root() -> Path:
    env_root = os.environ.get("BIOHARNESS_MODULES_ROOT", "").strip()
    if env_root:
        return Path(env_root).expanduser()
    return Path.home() / ".local" / "share" / "bioharness-modules"


def _resolve_cli_path(cmd: str) -> Path | None:
    if not cmd or not cmd.strip():
        return None
    p = Path(cmd)
    if p.is_absolute() or "/" in cmd:
        return p if (p.is_file() and os.access(p, os.X_OK)) else None
    found = shutil.which(cmd)
    return Path(found) if found else None


def probe_cli_callable(cmd: str, probe_args: tuple[str, ...] = ("--help",)) -> dict[str, Any]:
    """Actively verify that a CLI is both installed and executable/responsive (bounded 5s)."""
    resolved = _resolve_cli_path(cmd)
    if resolved is None:
        return {"installed": False, "callable": False, "version_output": None, "error": "CLI_NOT_FOUND"}
    try:
        proc = subprocess.run(
            [str(resolved), *probe_args],
            capture_output=True,
            text=True,
            timeout=5.0,
            check=False,
        )
        ok = proc.returncode == 0
        out_line = (proc.stdout or proc.stderr or "").strip().splitlines()
        return {
            "installed": True,
            "callable": ok,
            "version_output": out_line[0][:120] if out_line else None,
            "error": None if ok else f"exit={proc.returncode}",
        }
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"installed": True, "callable": False, "version_output": None, "error": str(exc)[:120]}


def _read_installed_release_meta(slug: str, cli_cmd: str | None = None) -> dict[str, Any]:
    """Dynamically inspect installed module metadata from resolved CLI location or modules root."""
    out: dict[str, Any] = {
        "installed_dir_present": False,
        "version": None,
        "source_sha": None,
        "releases": [],
        "direct_model_api_supported": None,
    }
    base = _modules_root() / slug
    cur = base / "current"

    # Also locate release directory by walking up from resolved CLI symlink if present
    search_dirs: list[Path] = []
    if cur.is_dir():
        search_dirs.append(cur)
    if cli_cmd:
        resolved = _resolve_cli_path(cli_cmd)
        if resolved is not None:
            try:
                real = resolved.resolve()
                for anc in list(real.parents)[:5]:
                    if (anc / "VERSION").is_file() or (anc / "SOURCE_SHA").is_file():
                        if anc not in search_dirs:
                            search_dirs.append(anc)
                        break
            except OSError:
                pass

    for candidate in search_dirs:
        out["installed_dir_present"] = True
        vfile = candidate / "VERSION"
        sfile = candidate / "SOURCE_SHA"
        if vfile.is_file() and not out["version"]:
            try:
                out["version"] = vfile.read_text(encoding="utf-8").strip()
            except OSError:
                pass
        if sfile.is_file() and not out["source_sha"]:
            try:
                out["source_sha"] = sfile.read_text(encoding="utf-8").strip()[:12]
            except OSError:
                pass

    rel_dir = base / "releases"
    if rel_dir.is_dir():
        try:
            for entry in sorted(rel_dir.iterdir(), key=lambda p: p.name):
                if not entry.is_dir():
                    continue
                ver = None
                vf = entry / "VERSION"
                if vf.is_file():
                    try:
                        ver = vf.read_text(encoding="utf-8").strip()
                    except OSError:
                        pass
                out["releases"].append({"sha": entry.name[:12], "version": ver})
        except OSError:
            pass



    return out


def _inspect_workspace_advisor_config(workspace: Workspace) -> dict[str, Any]:
    """Read-only check whether Core workspace config.toml declares an [advisor] block."""
    cfg = workspace.path / ".bioharness" / "config.toml"
    if cfg.is_symlink() or not cfg.is_file():
        return {"configured": False, "factory": None, "timeout_seconds": None}
    try:
        parsed = tomllib.loads(cfg.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError):
        return {"configured": False, "factory": None, "timeout_seconds": None, "parse_error": True}
    adv = parsed.get("advisor")
    if not isinstance(adv, dict) or not adv.get("factory"):
        return {"configured": False, "factory": None, "timeout_seconds": None}
    return {
        "configured": True,
        "factory": str(adv.get("factory")),
        "timeout_seconds": adv.get("timeout_seconds"),
    }


def resolve_workspace_file(workspace: Workspace, rel_path: str) -> Path:
    """Resolve a workspace-relative regular file safely without symlink escape or .bioharness access."""
    if not isinstance(rel_path, str) or not rel_path.strip():
        raise DomainModuleError("PATH_REQUIRED", "请提供工作区内相对文件路径。", 422)
    raw = rel_path.strip()
    if raw.startswith("$WORKSPACE/"):
        raw = raw[len("$WORKSPACE/"):]
    if raw.startswith("/") or "\\" in raw or any(ord(c) < 32 for c in raw):
        raise DomainModuleError("PATH_INVALID", "文件路径必须为合法的工作区相对路径。", 422)
    parts = [p for p in raw.split("/") if p]
    if not parts or any(p in (".", "..") or p.startswith(".bioharness") or p == ".git" for p in parts):
        raise DomainModuleError("PATH_FORBIDDEN", "禁止访问越界路径或受保护的 .bioharness 状态目录。", 403)
    ws_root = workspace.path.resolve()
    cur = ws_root
    for part in parts:
        cur = cur / part
        if cur.is_symlink():
            raise DomainModuleError("SYMLINK_REFUSED", "拒绝沿符号链接读取文件。", 403)
    try:
        resolved = cur.resolve(strict=True)
    except OSError:
        raise DomainModuleError("FILE_NOT_FOUND", f"工作区内未找到文件：{raw}", 404) from None
    if not resolved.is_relative_to(ws_root) or not resolved.is_file():
        raise DomainModuleError("FILE_OUTSIDE_WORKSPACE", "目标文件不在授权工作区内。", 403)
    return resolved


def _read_inspection_bytes(workspace: Workspace, path: Path, *, size_code: str = "BUNDLE_TOO_LARGE") -> bytes:
    fd = evidence._open_checked(workspace, path)
    if fd is None:
        raise DomainModuleError("FILE_UNAVAILABLE", "文件无法在授权范围内安全读取。", 403)
    with os.fdopen(fd, "rb") as fh:
        if os.fstat(fh.fileno()).st_size > _MAX_INSPECT_BYTES:
            raise DomainModuleError(size_code, "结构化产物超过 4 MB 在线审阅上限。", 413)
        data = fh.read(_MAX_INSPECT_BYTES + 1)
    if len(data) > _MAX_INSPECT_BYTES:
        raise DomainModuleError(size_code, "结构化产物超过 4 MB 在线审阅上限。", 413)
    return data


def list_workspace_module_files(workspace: Workspace) -> dict[str, list[str]]:
    """List bounded workspace-relative candidate files (including saved module artifacts)."""
    ws_root = workspace.path.resolve()
    buckets: dict[str, list[str]] = {"json": [], "templates": [], "structures": []}
    total = 0
    for dirpath, dirnames, filenames in os.walk(ws_root, followlinks=False):
        dirnames[:] = sorted(
            d for d in dirnames
            if not d.startswith(".") and d not in {"node_modules", "__pycache__", ".venv", "venv"}
        )
        current_dir = Path(dirpath)
        for fname in sorted(filenames):
            if fname.startswith("."):
                continue
            fpath = current_dir / fname
            if fpath.is_symlink() or not fpath.is_file():
                continue
            try:
                rel = str(fpath.relative_to(ws_root))
            except ValueError:
                continue
            ext = fpath.suffix.lower()
            if ext == ".json":
                buckets["json"].append(rel)
            elif ext in {".md", ".txt"}:
                buckets["templates"].append(rel)
            elif ext in {".pdb", ".cif", ".mmcif"}:
                buckets["structures"].append(rel)
            else:
                continue
            total += 1
            if total >= _MAX_SCAN_FILES:
                return buckets
    return buckets


def build_domain_modules_snapshot(
    *,
    settings: Settings,
    workspace: Workspace,
    ledger: Ledger | None,
) -> dict[str, Any]:
    """Build dynamic, verified discovery & availability snapshot for professional scientific modules."""
    observed = ledger.observed_module_usage(workspace.id) if ledger is not None else {
        "servers": {}, "tools": {}, "total_tool_calls": 0,
    }
    recent_invocations = ledger.module_invocations(workspace.id, limit=20) if ledger is not None else []

    def _usage_count(mod_id: str) -> int:
        direct = int(observed["servers"].get(mod_id, 0))
        by_tool = sum(
            int(cnt) for name, cnt in observed["tools"].items()
            if name == mod_id or name.startswith(f"{mod_id}:")
        )
        return max(direct, by_tool)

    lit_meta = _read_installed_release_meta("literature", settings.literature_cli)
    lit_probe = probe_cli_callable(settings.literature_cli, ("--help",))
    ps_probe = probe_cli_callable(settings.paperseek_cli, ("--help",))
    sc_probe = probe_cli_callable(settings.scansci_cli, ("--help",))
    lit_used = _usage_count("literature")

    stat_meta = _read_installed_release_meta("statistics", settings.statistics_cli)
    stat_probe = probe_cli_callable(settings.statistics_cli, ("--help",))
    stat_used = _usage_count("statistics")

    rev_meta = _read_installed_release_meta("scientific-review")
    advisor_cfg = _inspect_workspace_advisor_config(workspace)
    rev_used = _usage_count("scientific-review")

    pm_meta = _read_installed_release_meta("protein-methods", settings.protein_cli)
    pm_probe = probe_cli_callable(settings.protein_cli, ("--version",))
    pm_ver = pm_meta["version"]
    if not pm_ver and pm_probe["version_output"]:
        # e.g. "bioharness-protein-methods 0.2.0"
        tokens = pm_probe["version_output"].split()
        pm_ver = tokens[-1] if tokens else None
    pm_used = _usage_count("protein-methods")

    # Dynamically summarize installed Scientific Review releases without hardcoding versions
    rev_ver_summary_parts = []
    if rev_meta["version"]:
        rev_ver_summary_parts.append(
            f"current={rev_meta['version']}" + (f" ({rev_meta['source_sha']})" if rev_meta["source_sha"] else "")
        )
    other_rels = [
        f"{r['version'] or 'unknown'} ({r['sha']})"
        for r in rev_meta["releases"]
        if r["sha"] != rev_meta["source_sha"]
    ]
    if other_rels:
        rev_ver_summary_parts.append("其它已装版本: " + ", ".join(other_rels))
    rev_ver_desc = "；".join(rev_ver_summary_parts) if rev_ver_summary_parts else "本地未检测到已安装版本元数据"

    rev_gap_note = (
        f"当前探测到的 scientific-review（{rev_ver_desc}）仅通过 Core [advisor] 公共契约接入；"
        "Web 不做源码关键字推断，也不提供直连模型 API 审查执行入口。"
        "任何审查器适配器扩展均归属 BioHarness-Modules，Web 仅非阻断展示 Core 记录的审查结论、依据、分歧与修订记录。"
    )

    lit_callable = lit_probe["callable"] and (ps_probe["callable"] or sc_probe["callable"])
    modules = [
        {
            "id": "literature",
            "title": "文献检索与获取 (Literature)",
            "owner": "BioHarness-Modules",
            "command": Path(settings.literature_cli).name,
            "version": lit_meta["version"],
            "source_sha": lit_meta["source_sha"],
            "declared": True,
            "installed": lit_probe["installed"],
            "callable": lit_callable,
            "inspectable": True,
            "actually_used": lit_used > 0,
            "use_count": lit_used,
            "status": (
                "CALLABLE"
                if (lit_probe["callable"] and ps_probe["callable"] and sc_probe["callable"])
                else (
                    "PARTIAL_PROVIDERS"
                    if lit_callable
                    else ("ADAPTER_ONLY_PROVIDERS_MISSING" if lit_probe["callable"] else "NOT_INSTALLED")
                )
            ),
            "providers": {
                "paperseek": {
                    "command": Path(settings.paperseek_cli).name,
                    "available": ps_probe["callable"],
                    "installed": ps_probe["installed"],
                    "role": "KnowledgeSeek 文献检索上游 CLI",
                },
                "scansci_pdf": {
                    "command": Path(settings.scansci_cli).name,
                    "available": sc_probe["callable"],
                    "installed": sc_probe["installed"],
                    "role": "ScanSci PDF 文献全文获取上游 CLI",
                },
                "paperqa2": {
                    "command": "paperqa2",
                    "available": False,
                    "installed": _resolve_cli_path("paperqa2") is not None,
                    "status": "NOT_PRODUCTION_ENABLED",
                    "role": "只读观察适配器（未作为生产检索/下载 Provider 启用）",
                },
            },
            "note": (
                "支持审阅工作区内 bioharness-literature 生成的 search.json / downloads.json（保留覆盖边界与截断声明）；"
                "在线 search/fetch 仅在对应上游 CLI 经实际探活可用时启用，并支持留存产物至授权目录。"
            ),
        },
        {
            "id": "statistics",
            "title": "统计语义与确定性报告绑定 (Statistics)",
            "owner": "BioHarness-Modules",
            "command": Path(settings.statistics_cli).name,
            "version": stat_meta["version"],
            "source_sha": stat_meta["source_sha"],
            "declared": True,
            "installed": stat_probe["installed"],
            "callable": stat_probe["callable"],
            "inspectable": True,
            "actually_used": stat_used > 0,
            "use_count": stat_used,
            "status": "CALLABLE" if stat_probe["callable"] else ("INSTALLED_NOT_CALLABLE" if stat_probe["installed"] else "NOT_INSTALLED"),
            "actions": ["inspect", "render", "verify"],
            "subcomponents": {
                "report_binding_cli": "CALLABLE" if stat_probe["callable"] else "UNAVAILABLE",
                "clinical_subgroup_reviewers": "PRODUCTION_NOT_ENABLED",
                "legacy_cohens_d_archive": "SOURCE_ARCHIVED / NOT_RUNNABLE",
            },
            "note": (
                "直接调用模块拥有的 bioharness-statistics-report-binding render / verify 执行确定性数值绑定与校验，"
                "render 产物可持久化至授权目录供后续 verify 或对话引用；前端不重算任何统计量。"
            ),
        },
        {
            "id": "scientific-review",
            "title": "独立科学审查 (Scientific Review)",
            "owner": "BioHarness-Modules",
            "command": "Core [advisor]",
            "version": rev_meta["version"],
            "source_sha": rev_meta["source_sha"],
            "releases": rev_meta["releases"],
            "declared": True,
            "installed": rev_meta["installed_dir_present"],
            "callable": None if advisor_cfg["configured"] else False,
            "inspectable": True,
            "actually_used": rev_used > 0,
            "use_count": rev_used,
            "advisor_config": advisor_cfg,
            "status": (
                "ADVISOR_CONFIGURED"
                if advisor_cfg["configured"]
                else ("INSTALLED_ADVISOR_NOT_CONFIGURED" if rev_meta["installed_dir_present"] else "NOT_INSTALLED")
            ),
            "direct_model_api_gap_note": rev_gap_note,
            "note": (
                "科学审查意见始终为非阻断咨询记录（SUPPORTED / SUPPORTED_WITH_LIMITATIONS / CONCERNS / NOT_SUPPORTED / UNCLASSIFIED），"
                "审查未通过或服务缺失不会阻断科研主线。"
            ),
        },
        {
            "id": "protein-methods",
            "title": "蛋白结构与设计审计 (Protein Methods)",
            "owner": "BioHarness-Modules",
            "command": Path(settings.protein_cli).name,
            "version": pm_ver,
            "source_sha": pm_meta["source_sha"],
            "declared": True,
            "installed": pm_probe["installed"],
            "callable": pm_probe["callable"],
            "inspectable": True,
            "actually_used": pm_used > 0,
            "use_count": pm_used,
            "operations": sorted(_PROTEIN_OPS),
            "status": "CALLABLE" if pm_probe["callable"] else ("INSTALLED_NOT_CALLABLE" if pm_probe["installed"] else "NOT_INSTALLED"),
            "note": (
                "提供 6 个公开结构化审计子命令（structure-inventory / structure-compare / task-review / "
                "manifest-review / run-audit / outcome-audit），结果可留存至授权目录并记入技术账本。"
            ),
        },
        {
            "id": "dapseq",
            "title": "DAP-seq 受管适配器（仅历史参考）",
            "owner": "BioHarness-Modules",
            "command": None,
            "version": None,
            "source_sha": None,
            "declared": True,
            "installed": (_modules_root() / "dapseq").is_dir(),
            "callable": False,
            "inspectable": False,
            "actually_used": False,
            "use_count": 0,
            "status": "SOURCE_HANDOFF_ONLY / NOT_PUBLISHED",
            "note": "仅保留历史参考适配器与源码归档，尚未泛化为通用在线模块；Web 不复现 DAP-seq 算法。",
        },
        {
            "id": "genome-web-tf",
            "title": "Genome-web TF 适配器（仅工程参考）",
            "owner": "BioHarness-Modules",
            "command": None,
            "version": None,
            "source_sha": None,
            "declared": True,
            "installed": (_modules_root() / "genome-web-tf").is_dir(),
            "callable": False,
            "inspectable": False,
            "actually_used": False,
            "use_count": 0,
            "status": "ENGINEERING_REFERENCE_ONLY / NOT_RUNNABLE",
            "note": "只读工程参考适配，不可直接运行；不提供虚假启动按钮。",
        },
        {
            "id": "sequence",
            "title": "Sequence / FASTA QC（源码归档）",
            "owner": "BioHarness-Modules",
            "command": None,
            "version": None,
            "source_sha": None,
            "declared": True,
            "installed": (_modules_root() / "sequence").is_dir(),
            "callable": False,
            "inspectable": False,
            "actually_used": False,
            "use_count": 0,
            "status": "SOURCE_ARCHIVED / NOT_RUNNABLE",
            "note": "历史源码归档，计算工厂不可执行；须待独立模块验收后按需接入。",
        },
    ]

    return {
        "service": settings.service_id,
        "workspace": workspace.id,
        "observed_at": _now_iso(),
        "upload_enabled": workspace.upload_root is not None,
        "modules": modules,
        "workspace_files": list_workspace_module_files(workspace),
        "observed_usage": observed,
        "recent_invocations": recent_invocations,
    }


def inspect_literature_artifact(
    workspace: Workspace,
    rel_path: str,
    *,
    offset: int = 0,
    limit: int = 25,
) -> dict[str, Any]:
    """Read and paginate a real bioharness-literature search.json or downloads.json artifact."""
    resolved = resolve_workspace_file(workspace, rel_path)
    raw = _read_inspection_bytes(workspace, resolved, size_code="ARTIFACT_TOO_LARGE")
    if len(raw) > _MAX_INSPECT_BYTES:
        raise DomainModuleError("ARTIFACT_TOO_LARGE", "文献 JSON 文件超过 4 MB 浏览上限。", 413)
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise DomainModuleError("INVALID_JSON", f"无法解析文献 JSON 文件：{exc}", 422) from None
    if not isinstance(payload, dict):
        raise DomainModuleError("INVALID_LITERATURE_ARTIFACT", "文献产物必须为 JSON 对象。", 422)

    op = payload.get("operation")
    if op == "fetch" or isinstance(payload.get("entries"), list):
        items_all = payload.get("entries") or []
        kind = "fetch"
    elif op == "search" or isinstance(payload.get("papers"), list) or isinstance(payload.get("ranked"), list):
        items_all = payload.get("papers") if isinstance(payload.get("papers"), list) else (payload.get("ranked") or [])
        kind = "search"
    else:
        raise DomainModuleError(
            "UNRECOGNIZED_LITERATURE_SCHEMA",
            "JSON 缺少 bioharness-literature 的 papers 或 entries 列表。",
            422,
        )

    total_items = len(items_all)
    start = max(0, min(offset, total_items))
    end = min(total_items, start + max(1, min(limit, 100)))
    redact = path_redactor(workspace)

    return redact({
        "operation": kind,
        "source_file": rel_path.strip(),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "upstream_contract": payload.get("upstream_contract"),
        "question": payload.get("question"),
        "source": payload.get("source"),
        "query": payload.get("query"),
        "coverage": payload.get("coverage"),
        "reported_total_results": payload.get("reported_total_results"),
        "returned_records": payload.get("returned_records", total_items),
        "input_records": payload.get("input_records"),
        "requested_identifiers": payload.get("requested_identifiers"),
        "downloaded_identifiers": payload.get("downloaded_identifiers"),
        "unresolved_records": payload.get("unresolved_records"),
        "validation_scope": payload.get("validation_scope"),
        "parameters": payload.get("parameters"),
        "total_items": total_items,
        "offset": start,
        "limit": end - start,
        "has_more": end < total_items,
        "items": items_all[start:end],
    })


def _http_status_for_tool_error(code: str) -> int:
    if code == "TOOL_UNAVAILABLE":
        return 503
    if code == "TOOL_TIMEOUT":
        return 504
    return 502


def _persist_literature_pdfs(
    workspace: Workspace,
    out_dir: Path,
    payload: dict[str, Any],
    *,
    max_upload_bytes: int,
    save_output: bool = True,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Preserve the exact file named by each module-owned download record.

    Download success and host retention are independent. Never substitute a
    same-named file, alter a DOI, or advertise a soon-to-be-deleted temp path.
    """
    updated = json.loads(json.dumps(payload, ensure_ascii=False))
    entries = updated.get("entries")
    saved_pdfs: list[dict[str, Any]] = []
    saved_by_path: dict[Path, dict[str, Any]] = {}
    retained, not_retained = 0, 0
    output_available = out_dir.is_dir() and not out_dir.is_symlink()
    out_root = out_dir.resolve() if output_available else out_dir.absolute()
    requested = save_output and workspace.upload_root is not None
    if isinstance(entries, list):
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            raw_file = entry.get("file") or entry.get("pdf_path") or entry.get("path")
            # Keep the scientific module's original status and identity.
            # A downloaded entry with no usable file is a retention failure.
            if not raw_file and entry.get("status") != "downloaded":
                continue
            saved = None
            reason = "NOT_REQUESTED" if not save_output else "NO_UPLOAD_ROOT"
            if requested:
                reason = "FILE_NOT_RETAINED"
                try:
                    if not output_available:
                        raise ValueError("OUTPUT_DIRECTORY_UNAVAILABLE")
                    if not isinstance(raw_file, str) or not raw_file.strip():
                        raise ValueError("DOWNLOAD_PATH_MISSING")
                    candidate = Path(raw_file)
                    if not candidate.is_absolute():
                        candidate = out_root / candidate
                    if ".." in candidate.parts or not candidate.is_relative_to(out_root):
                        raise ValueError("DOWNLOAD_PATH_OUTSIDE_OUTPUT")
                    cur = out_root
                    for part in candidate.relative_to(out_root).parts:
                        cur = cur / part
                        if cur.is_symlink():
                            raise ValueError("DOWNLOAD_SYMLINK")
                    resolved = candidate.resolve(strict=True)
                    if not resolved.is_relative_to(out_root) or resolved.suffix.lower() != ".pdf":
                        raise ValueError("DOWNLOAD_PATH_INVALID")
                    if resolved in saved_by_path:
                        prior = saved_by_path[resolved]
                        if entry.get("sha256") and entry["sha256"] != prior["sha256"]:
                            raise ValueError("DOWNLOAD_SHA_MISMATCH")
                        if isinstance(entry.get("bytes"), int) and entry["bytes"] != prior["bytes"]:
                            raise ValueError("DOWNLOAD_SIZE_MISMATCH")
                        saved = prior
                    else:
                        fd = os.open(resolved, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                        with os.fdopen(fd, "rb") as fh:
                            st = os.fstat(fh.fileno())
                            opened = Path(os.readlink(f"/proc/self/fd/{fh.fileno()}"))
                            if opened != resolved or not stat.S_ISREG(st.st_mode):
                                raise ValueError("DOWNLOAD_PATH_CHANGED")
                            if not 0 < st.st_size <= max_upload_bytes:
                                raise ValueError("DOWNLOAD_SIZE_LIMIT")
                            data = fh.read(max_upload_bytes + 1)
                            end = os.fstat(fh.fileno())
                            if len(data) != st.st_size or end.st_mtime_ns != st.st_mtime_ns or end.st_ctime_ns != st.st_ctime_ns:
                                raise ValueError("DOWNLOAD_CHANGED")
                        digest = hashlib.sha256(data).hexdigest()
                        if not data.startswith(b"%PDF-"):
                            raise ValueError("DOWNLOAD_NOT_PDF")
                        if entry.get("sha256") and entry["sha256"] != digest:
                            raise ValueError("DOWNLOAD_SHA_MISMATCH")
                        if isinstance(entry.get("bytes"), int) and entry["bytes"] != len(data):
                            raise ValueError("DOWNLOAD_SIZE_MISMATCH")
                        saved = inputs.save_module_artifact(workspace, "literature", resolved.name, data)
                        if saved is not None:
                            saved_by_path[resolved] = saved
                            saved_pdfs.append(saved)
                except ValueError as exc:
                    reason = str(exc)
                except (OSError, inputs.InputError):
                    reason = "DOWNLOAD_READ_OR_SAVE_FAILED"
            # Remove all ephemeral aliases, even when the output was not retained.
            for key in ("file", "pdf_path", "path", "relative_path", "saved_artifact"):
                entry.pop(key, None)
            if saved is not None:
                retained += 1
                entry.update(file=saved["server_path"], relative_path=saved["relative_path"],
                             sha256=saved["sha256"], bytes=saved["bytes"], saved_artifact=saved,
                             retention_status="RETAINED")
            else:
                not_retained += 1
                entry.update(file=None, retention_status="NOT_RETAINED", retention_reason=reason)
    reported = updated.get("downloaded_identifiers")
    unmapped = max(0, reported - retained - not_retained) if isinstance(reported, int) else 0
    not_retained += unmapped
    updated["saved_pdfs"] = saved_pdfs
    updated["retention"] = {
        "status": ("NOT_REQUESTED" if not save_output else
                   "NO_UPLOAD_ROOT" if not requested else
                   "MANIFEST_UNAVAILABLE" if not isinstance(entries, list) else
                   "PARTIAL" if not_retained and retained else
                   "NOT_RETAINED" if not_retained else "COMPLETE"),
        "retained_identifiers": retained,
        "not_retained_identifiers": not_retained,
        "unmapped_identifiers": unmapped,
    }
    return saved_pdfs, updated


async def run_literature_cli(
    *,
    settings: Settings,
    runner: CliRunner,
    workspace: Workspace,
    operation: str,
    question: str | None = None,
    source: str = "openalex",
    maximum: int = 10,
    iterations: int = 2,
    search_json_path: str | None = None,
    lanes: bool = True,
    save_output: bool = True,
    conversation_id: str | None = None,
    request_id: str | None = None,
    scope_id: str | None = None,
    ledger: Ledger | None = None,
) -> dict[str, Any]:
    """Invoke real `bioharness-literature search|fetch`, persist JSON & downloaded PDFs, and track lifecycle in ledger."""
    if operation not in {"search", "fetch"}:
        raise DomainModuleError("INVALID_OPERATION", "仅支持 search 或 fetch 操作。", 422)
    if operation == "search" and (not question or not question.strip()):
        raise DomainModuleError("QUESTION_REQUIRED", "执行文献检索需要提供检索问题。", 422)
    if operation == "fetch" and (not search_json_path or not search_json_path.strip()):
        raise DomainModuleError("SEARCH_JSON_REQUIRED", "执行文献获取需要指定工作区内的 search.json 路径。", 422)

    redact = path_redactor(workspace)
    input_meta: dict[str, Any] = (
        {"operation": "search", "question": question.strip() if question else "", "source": source, "maximum": maximum}
        if operation == "search"
        else {"operation": "fetch", "search_json_path": search_json_path, "lanes": lanes}
    )

    search_file: Path | None = None
    if operation == "fetch":
        search_file = resolve_workspace_file(workspace, search_json_path or "")

    ledger_ev_id: str | None = None
    if ledger is not None:
        try:
            started = ledger.start_module_operation(
                workspace.id,
                module_id="literature",
                operation=operation,
                input_data=redact(input_meta),
                conversation_id=conversation_id,
                request_id=request_id,
                scope_id=scope_id,
            )
            ledger_ev_id = started["id"]
        except ValueError as exc:
            raise DomainModuleError("CONVERSATION_UNKNOWN", str(exc), 404) from None

    tmpdir = None
    cleanup = False
    try:
        tmpdir = Path(tempfile.mkdtemp(prefix="bhweb-lit-"))
        os.chmod(tmpdir, 0o700)
        out_dir = tmpdir / "out"
        if operation == "search":
            argv = [
                settings.literature_cli,
                "search",
                (question or "").strip(),
                "--source", source.strip() or "openalex",
                "--output", str(out_dir),
                "--max", str(max(1, min(maximum, 50))),
                "--iterations", str(max(1, min(iterations, 10))),
                "--paperseek", settings.paperseek_cli,
            ]
        else:
            argv = [
                settings.literature_cli,
                "fetch",
                str(search_file),
                "--output", str(out_dir),
                "--scansci", settings.scansci_cli,
            ]
            if not lanes:
                argv.append("--no-lanes")

        try:
            payload = await runner.run_json(argv, timeout=min(120.0, settings.module_tool_timeout_seconds))
            if not isinstance(payload, dict):
                raise ToolError("TOOL_BAD_OUTPUT", "bioharness-literature did not return a JSON object")
        except ToolError as exc:
            if ledger is not None and ledger_ev_id is not None:
                ledger.finish_module_operation(
                    ledger_ev_id,
                    state="UNKNOWN" if exc.code in {"TOOL_TIMEOUT", "TOOL_BAD_OUTPUT", "TOOL_OUTPUT_TOO_LARGE"} else "FAILED",
                    error_data={"code": exc.code, "message": redact(exc.message)},
                )
            raise DomainModuleError(exc.code, redact(exc.message), _http_status_for_tool_error(exc.code)) from None

        if payload.get("ok") is False:
            err_code = str(payload.get("error") or payload.get("code") or "LITERATURE_FAILED")
            err_msg = redact(str(payload.get("message") or f"bioharness-literature {operation} failed"))
            if ledger is not None and ledger_ev_id is not None:
                ledger.finish_module_operation(
                    ledger_ev_id,
                    state="FAILED",
                    output_data=redact(payload),
                    error_data={"code": err_code, "message": err_msg},
                )
            err_status = 503 if any(k in err_code.upper() for k in ("UNAVAILABLE", "NOT_FOUND", "MISSING")) else 502
            raise DomainModuleError(err_code, err_msg, err_status)

        saved_pdfs: list[dict[str, Any]] = []
        saved_artifact = None
        save_note = None
        final_payload = payload
        if operation == "fetch":
            art_file = out_dir / "downloads.json"
            raw_downloads = payload
            if not out_dir.is_symlink() and art_file.is_file() and not art_file.is_symlink():
                try:
                    with art_file.open("rb") as fh:
                        raw = fh.read(_MAX_INSPECT_BYTES + 1)
                    if len(raw) <= _MAX_INSPECT_BYTES:
                        parsed = json.loads(raw)
                        if isinstance(parsed, dict):
                            raw_downloads = parsed
                except (OSError, ValueError):
                    pass
            saved_pdfs, final_payload = _persist_literature_pdfs(
                workspace, out_dir, raw_downloads,
                max_upload_bytes=settings.max_upload_bytes, save_output=save_output)
            retention = final_payload["retention"]
            if retention["status"] == "MANIFEST_UNAVAILABLE":
                save_note = "模块未返回可核对的下载条目，不能确认 PDF 完整留存。"
            elif retention["not_retained_identifiers"]:
                save_note = (f"PDF 留存 {retention['retained_identifiers']} 项，"
                             f"未留存 {retention['not_retained_identifiers']} 项；"
                             "下载成功与实际留存是不同状态。")
            if save_output and workspace.upload_root is not None:
                art_bytes = (json.dumps(redact(final_payload), ensure_ascii=False, indent=2) + "\n").encode("utf-8")
                saved_artifact = inputs.save_module_artifact(workspace, "literature", "downloads.json", art_bytes)
            # A failed requested retention leaves only this invocation's
            # private temporary output available for operator recovery.
            cleanup = not save_output or workspace.upload_root is None or (
                retention["status"] == "COMPLETE" and saved_artifact is not None)
        elif save_output and workspace.upload_root is not None:
            art_file = out_dir / "search.json"
            if not out_dir.is_symlink() and art_file.is_file() and not art_file.is_symlink():
                with art_file.open("rb") as fh:
                    art_bytes = fh.read(_MAX_INSPECT_BYTES + 1)
                if len(art_bytes) > _MAX_INSPECT_BYTES:
                    raise DomainModuleError("ARTIFACT_TOO_LARGE", "文献检索清单超出在线留存上限。", 413)
            else:
                art_bytes = (json.dumps(redact(payload), ensure_ascii=False, indent=2) + "\n").encode("utf-8")
            saved_artifact = inputs.save_module_artifact(workspace, "literature", "search.json", art_bytes)
            cleanup = saved_artifact is not None
        else:
            cleanup = True
        if save_output and workspace.upload_root is None:
            save_note = "；".join(x for x in (save_note, "当前工作区未配置可写授权目录，结果未落盘。") if x)
        if not cleanup:
            save_note = "；".join(x for x in (save_note, "本次临时产物保留供管理员核对，未声明已完整保存。") if x)

        recorded = False
        if ledger is not None and ledger_ev_id is not None:
            ledger.finish_module_operation(
                ledger_ev_id,
                state="SUCCEEDED" if final_payload.get("ok") is not False else "FAILED",
                output_data=redact(final_payload),
                saved_artifact=saved_artifact,
            )
            recorded = True

        return redact({
            "operation": operation,
            "cli": Path(settings.literature_cli).name,
            "result": final_payload,
            "saved_artifact": saved_artifact,
            "saved_pdfs": saved_pdfs,
            "save_note": save_note,
            "recorded_in_ledger": recorded,
        })
    except inputs.InputError as exc:
        raise DomainModuleError(exc.code, exc.message, exc.status) from None
    except OSError:
        raise DomainModuleError("ARTIFACT_IO_FAILED", "文献产物读取或保存失败。", 500) from None
    finally:
        if ledger is not None and ledger_ev_id is not None:
            ledger.finish_module_operation(ledger_ev_id, state="UNKNOWN",
                error_data={"code": "MODULE_OUTCOME_UNKNOWN", "message": "模块执行或产物留存未完整记录。"})
        if tmpdir is not None:
            if cleanup or not save_output or workspace.upload_root is None:
                shutil.rmtree(tmpdir, ignore_errors=True)
            else:
                log.warning("Literature output retained for operator reconciliation: operation=%s path=%s", ledger_ev_id, tmpdir)


async def run_statistics_report_binding(
    *,
    settings: Settings,
    runner: CliRunner,
    workspace: Workspace,
    action: str,
    records_path: str,
    template_path: str | None = None,
    report_path: str | None = None,
    save_output: bool = True,
    conversation_id: str | None = None,
    request_id: str | None = None,
    scope_id: str | None = None,
    ledger: Ledger | None = None,
) -> dict[str, Any]:
    """Run bioharness-statistics-report-binding render|verify or read-only bundle inspect,
    preserving real CLI error types and recording true execution lifecycle in the ledger."""
    if action not in {"inspect", "render", "verify"}:
        raise DomainModuleError("INVALID_ACTION", "仅支持 inspect / render / verify 操作。", 422)

    records_abs = resolve_workspace_file(workspace, records_path)
    raw_bytes = _read_inspection_bytes(workspace, records_abs)
    if len(raw_bytes) > _MAX_INSPECT_BYTES:
        raise DomainModuleError("BUNDLE_TOO_LARGE", "统计结果包超过 4 MB 上限。", 413)
    try:
        bundle = json.loads(raw_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise DomainModuleError("INVALID_JSON", f"统计结果 JSON 解析失败：{exc}", 422) from None

    if isinstance(bundle, list):
        records_list = bundle
        tables_list: list[Any] = []
    elif isinstance(bundle, dict):
        records_list = bundle.get("records") if isinstance(bundle.get("records"), list) else []
        tables_list = bundle.get("tables") if isinstance(bundle.get("tables"), list) else []
    else:
        raise DomainModuleError("INVALID_BUNDLE", "统计结果包必须为 JSON 对象或记录数组。", 422)

    redact = path_redactor(workspace)
    base_resp: dict[str, Any] = {
        "action": action,
        "cli": Path(settings.statistics_cli).name,
        "records_file": records_path.strip(),
        "records_sha256": hashlib.sha256(raw_bytes).hexdigest(),
        "records": records_list,
        "tables": tables_list,
        "note": "数值与统计指标均直接取自模块结构化记录与 report_binding CLI，Web 前端未重算任何统计量。",
    }
    if action == "inspect":
        return redact({
            **base_resp,
            "status": "INSPECTED_ONLY",
            "binding": None,
            "rendered_markdown": None,
            "saved_artifact": None,
            "recorded_in_ledger": False,
        })

    if not template_path or not template_path.strip():
        raise DomainModuleError("TEMPLATE_REQUIRED", "执行 render / verify 需要提供模板文件（template_path）。", 422)
    template_abs = resolve_workspace_file(workspace, template_path)
    report_abs: Path | None = None
    if action == "verify":
        if not report_path or not report_path.strip():
            raise DomainModuleError("REPORT_REQUIRED", "执行 verify 需要提供待核验报告文件（report_path）。", 422)
        report_abs = resolve_workspace_file(workspace, report_path)

    input_meta = {
        "action": action,
        "records_path": records_path.strip(),
        "template_path": template_path.strip(),
        "report_path": report_path.strip() if report_path else None,
    }

    ledger_ev_id: str | None = None
    if ledger is not None:
        try:
            started = ledger.start_module_operation(
                workspace.id,
                module_id="statistics",
                operation=action,
                input_data=redact(input_meta),
                conversation_id=conversation_id,
                request_id=request_id,
                scope_id=scope_id,
            )
            ledger_ev_id = started["id"]
        except ValueError as exc:
            raise DomainModuleError("CONVERSATION_UNKNOWN", str(exc), 404) from None

    tmpdir = None
    try:
        tmpdir = Path(tempfile.mkdtemp(prefix="bhweb-stat-"))
        os.chmod(tmpdir, 0o700)
        if action == "render":
            out_report = tmpdir / "rendered_report.md"
            argv = [
                settings.statistics_cli,
                "render",
                "--records", str(records_abs),
                "--template", str(template_abs),
                "--report", str(out_report),
            ]
        else:
            assert report_abs is not None
            argv = [
                settings.statistics_cli,
                "verify",
                "--records", str(records_abs),
                "--template", str(template_abs),
                "--report", str(report_abs),
            ]
            out_report = report_abs

        try:
            stdout, stderr, returncode = await runner.run_raw(argv, timeout=min(60.0, settings.tool_timeout_seconds))
        except ToolError as exc:
            if ledger is not None and ledger_ev_id is not None:
                ledger.finish_module_operation(
                    ledger_ev_id,
                    state="UNKNOWN" if exc.code in {"TOOL_TIMEOUT", "TOOL_BAD_OUTPUT", "TOOL_OUTPUT_TOO_LARGE"} else "FAILED",
                    error_data={"code": exc.code, "message": redact(exc.message)},
                )
            raise DomainModuleError(exc.code, redact(exc.message), _http_status_for_tool_error(exc.code)) from None

        stdout_text = stdout.decode("utf-8", errors="replace").strip()
        stderr_text = redact(stderr.decode("utf-8", errors="replace").strip())

        if returncode == 0:
            try:
                binding_result = json.loads(stdout_text)
            except ValueError:
                binding_result = None
            if not isinstance(binding_result, dict):
                err_msg = f"{Path(settings.statistics_cli).name} did not return a JSON object"
                if ledger is not None and ledger_ev_id is not None:
                    ledger.finish_module_operation(
                        ledger_ev_id,
                        state="FAILED",
                        error_data={"code": "TOOL_BAD_OUTPUT", "message": err_msg},
                    )
                raise DomainModuleError("TOOL_BAD_OUTPUT", err_msg, 502)

            rendered_md = out_report.read_text(encoding="utf-8") if out_report.is_file() else None
            saved_artifact = None
            save_note = None
            if action == "render" and save_output and rendered_md is not None:
                saved_artifact = inputs.save_module_artifact(
                    workspace,
                    "statistics",
                    f"{Path(template_path).stem}-rendered.md",
                    rendered_md.encode("utf-8"),
                )
                if saved_artifact is None:
                    save_note = "当前工作区未配置可写授权目录（upload_root），渲染报告仅本次预览未落盘。"

            recorded = False
            if ledger is not None and ledger_ev_id is not None:
                ledger.finish_module_operation(
                    ledger_ev_id,
                    state="SUCCEEDED",
                    output_data=redact({
                        "status": str(binding_result.get("status") or "PASS"),
                        "action": action,
                        "binding": binding_result,
                        "records": records_list,
                        "rendered_markdown": rendered_md,
                    }),
                    saved_artifact=saved_artifact,
                )
                recorded = True

            return redact({
                **base_resp,
                "status": str(binding_result.get("status") or "PASS"),
                "template_file": template_path.strip(),
                "report_file": report_path.strip() if report_path else None,
                "binding": binding_result,
                "rendered_markdown": rendered_md,
                "saved_artifact": saved_artifact,
                "save_note": save_note,
                "recorded_in_ledger": recorded,
                "error": None,
            })

        # Non-zero exit: distinguish real REPORT_BINDING_FAIL mismatch from generic CLI/runtime crash!
        parsed_err_json = None
        if stdout_text:
            try:
                maybe = json.loads(stdout_text)
                if isinstance(maybe, dict):
                    parsed_err_json = maybe
            except ValueError:
                pass
        is_binding_mismatch = (
            any(line.startswith("REPORT_BINDING_FAIL:") for line in stderr_text.splitlines())
            or (isinstance(parsed_err_json, dict) and parsed_err_json.get("code") == "REPORT_BINDING_FAIL")
        )
        if is_binding_mismatch:
            err_msg = stderr_text or stdout_text or f"{Path(settings.statistics_cli).name} reported binding mismatch"
            recorded = False
            if ledger is not None and ledger_ev_id is not None:
                ledger.finish_module_operation(
                    ledger_ev_id,
                    state="FAILED",
                    error_data={"code": "REPORT_BINDING_FAIL", "cli_exit_code": returncode, "message": err_msg},
                )
                recorded = True
            return redact({
                **base_resp,
                "status": "FAIL",
                "template_file": template_path.strip(),
                "report_file": report_path.strip() if report_path else None,
                "binding": parsed_err_json,
                "rendered_markdown": None,
                "saved_artifact": None,
                "recorded_in_ledger": recorded,
                "error": {"code": "REPORT_BINDING_FAIL", "cli_exit_code": returncode, "message": err_msg},
            })

        cli_err_msg = (
            f"{Path(settings.statistics_cli).name} exited with status {returncode}"
            + (f": {stderr_text[:300]}" if stderr_text else "")
        )
        if ledger is not None and ledger_ev_id is not None:
            ledger.finish_module_operation(
                ledger_ev_id,
                state="FAILED",
                error_data={"code": "TOOL_FAILED", "cli_exit_code": returncode, "message": cli_err_msg},
            )
        raise DomainModuleError("TOOL_FAILED", cli_err_msg, 502, {"cli_exit_code": returncode})
    except inputs.InputError as exc:
        raise DomainModuleError(exc.code, exc.message, exc.status) from None
    except OSError:
        raise DomainModuleError("ARTIFACT_IO_FAILED", "统计产物读取或保存失败。", 500) from None
    finally:
        if ledger is not None and ledger_ev_id is not None:
            ledger.finish_module_operation(ledger_ev_id, state="UNKNOWN",
                error_data={"code": "MODULE_OUTCOME_UNKNOWN", "message": "模块执行或产物留存未完整记录。"})
        if tmpdir is not None:
            shutil.rmtree(tmpdir, ignore_errors=True)


async def run_protein_methods_cli(
    *,
    settings: Settings,
    runner: CliRunner,
    workspace: Workspace,
    operation: str,
    input_path: str,
    reference_path: str | None = None,
    mapping_path: str | None = None,
    mode: str | None = None,
    verify_files: bool = False,
    model_index: int | None = None,
    save_output: bool = True,
    conversation_id: str | None = None,
    request_id: str | None = None,
    scope_id: str | None = None,
    ledger: Ledger | None = None,
) -> dict[str, Any]:
    """Invoke one of the 6 public bioharness-protein-methods CLI subcommands, save artifact, and track lifecycle."""
    if operation not in _PROTEIN_OPS:
        raise DomainModuleError(
            "UNSUPPORTED_PROTEIN_OPERATION",
            f"不支持的 protein-methods 子命令：{operation}",
            422,
        )

    input_abs = resolve_workspace_file(workspace, input_path)
    argv = [settings.protein_cli, operation, str(input_abs)]
    input_meta: dict[str, Any] = {"operation": operation, "input_path": input_path.strip()}

    if operation == "structure-compare":
        if not reference_path or not mapping_path:
            raise DomainModuleError(
                "COMPARE_INPUTS_REQUIRED",
                "structure-compare 需要同时指定 reference_path 与 mapping_path。",
                422,
            )
        ref_abs = resolve_workspace_file(workspace, reference_path)
        map_abs = resolve_workspace_file(workspace, mapping_path)
        argv.extend([str(ref_abs), "--mapping", str(map_abs)])
        input_meta["reference_path"] = reference_path.strip()
        input_meta["mapping_path"] = mapping_path.strip()
    elif operation == "manifest-review":
        argv.extend(["--workspace-root", str(workspace.path.resolve())])
        if verify_files:
            argv.append("--verify-files")
    elif operation == "run-audit":
        argv.extend(["--workspace-root", str(workspace.path.resolve())])
        if mode:
            if mode not in _PROTEIN_MODES:
                raise DomainModuleError("INVALID_MODE", f"非法 run-audit 模式：{mode}", 422)
            argv.extend(["--mode", mode])
            input_meta["mode"] = mode
    elif operation == "structure-inventory" and model_index is not None:
        argv.extend(["--model-index", str(model_index)])
        input_meta["model_index"] = model_index

    redact = path_redactor(workspace)
    ledger_ev_id: str | None = None
    if ledger is not None:
        try:
            started = ledger.start_module_operation(
                workspace.id,
                module_id="protein-methods",
                operation=operation,
                input_data=redact(input_meta),
                conversation_id=conversation_id,
                request_id=request_id,
                scope_id=scope_id,
            )
            ledger_ev_id = started["id"]
        except ValueError as exc:
            raise DomainModuleError("CONVERSATION_UNKNOWN", str(exc), 404) from None

    try:
        try:
            result = await runner.run_json(argv, timeout=min(120.0, settings.module_tool_timeout_seconds))
            if not isinstance(result, dict):
                raise ToolError("TOOL_BAD_OUTPUT", "bioharness-protein-methods did not return a JSON object")
        except ToolError as exc:
            if ledger is not None and ledger_ev_id is not None:
                ledger.finish_module_operation(
                    ledger_ev_id,
                    state="UNKNOWN" if exc.code in {"TOOL_TIMEOUT", "TOOL_BAD_OUTPUT", "TOOL_OUTPUT_TOO_LARGE"} else "FAILED",
                    error_data={"code": exc.code, "message": redact(exc.message)},
                )
            raise DomainModuleError(exc.code, redact(exc.message), _http_status_for_tool_error(exc.code)) from None

        saved_artifact = None
        save_note = None
        if save_output:
            art_bytes = (json.dumps(redact(result), ensure_ascii=False, indent=2) + "\n").encode("utf-8")
            saved_artifact = inputs.save_module_artifact(
                workspace,
                "protein-methods",
                f"{Path(input_path).stem}-{operation}.json",
                art_bytes,
            )
            if saved_artifact is None:
                save_note = "当前工作区未配置可写授权目录（upload_root），审计结果仅本次返回未落盘。"

        recorded = False
        if ledger is not None and ledger_ev_id is not None:
            ledger.finish_module_operation(
                ledger_ev_id,
                state="SUCCEEDED" if result.get("status") != "not_evaluable" else "FAILED",
                output_data=redact(result),
                saved_artifact=saved_artifact,
            )
            recorded = True

        return redact({
            "operation": operation,
            "cli": Path(settings.protein_cli).name,
            "input_file": input_path.strip(),
            "result": result,
            "saved_artifact": saved_artifact,
            "save_note": save_note,
            "recorded_in_ledger": recorded,
        })
    except inputs.InputError as exc:
        raise DomainModuleError(exc.code, exc.message, exc.status) from None
    except OSError:
        raise DomainModuleError("ARTIFACT_IO_FAILED", "蛋白分析产物保存失败。", 500) from None
    finally:
        if ledger is not None and ledger_ev_id is not None:
            ledger.finish_module_operation(ledger_ev_id, state="UNKNOWN",
                error_data={"code": "MODULE_OUTCOME_UNKNOWN", "message": "模块执行或产物留存未完整记录。"})
