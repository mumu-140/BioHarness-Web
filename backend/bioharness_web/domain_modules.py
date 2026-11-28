"""R3.4 thin BFF for BioHarness professional scientific modules.

Strict architectural boundaries:
- Never re-implements literature search/fetch, statistical calculation, scientific review,
  or protein structure algorithms in Web.
- Invokes only authorized, installed public CLIs (no shell, bounded timeouts, symlink-safe
  workspace containment, redacted paths).
- Surfaces non-runnable / reference / production-disabled modules honestly without fake buttons.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tempfile
import tomllib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .cli import CliRunner, ToolError
from .ledger import Ledger
from .settings import Settings, Workspace
from .sources import path_redactor

_MAX_INSPECT_BYTES = 4 * 1024 * 1024
_MAX_SCAN_FILES = 60
_MODULES_ROOT = Path("/home/yangs/.local/share/bioharness-modules")
_SAFE_REL_PART = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
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


def _cli_available(cmd: str) -> bool:
    if not cmd or not cmd.strip():
        return False
    p = Path(cmd)
    if p.is_absolute() or "/" in cmd:
        return p.is_file() and os.access(p, os.X_OK)
    return shutil.which(cmd) is not None


def _read_installed_release_meta(slug: str) -> dict[str, Any]:
    """Read-only inspection of installed release metadata (never leaks host absolute paths)."""
    base = _MODULES_ROOT / slug
    cur = base / "current"
    out: dict[str, Any] = {"installed_dir_present": cur.is_dir(), "version": None, "source_sha": None, "releases": []}
    if cur.is_dir():
        vfile = cur / "VERSION"
        sfile = cur / "SOURCE_SHA"
        if vfile.is_file():
            try:
                out["version"] = vfile.read_text(encoding="utf-8").strip()
            except OSError:
                pass
        if sfile.is_file():
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


def list_workspace_module_files(workspace: Workspace) -> dict[str, list[str]]:
    """List bounded workspace-relative candidate files for Literature/Statistics/Protein inspection."""
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
    """Build honest discovery & availability snapshot for all R3.4 professional scientific modules."""
    observed = ledger.observed_module_usage(workspace.id) if ledger is not None else {
        "servers": {}, "tools": {}, "total_tool_calls": 0,
    }

    lit_meta = _read_installed_release_meta("literature")
    lit_cli_ok = _cli_available(settings.literature_cli)
    paperseek_ok = _cli_available(settings.paperseek_cli)
    scansci_ok = _cli_available(settings.scansci_cli)
    lit_used = int(observed["tools"].get("literature", 0) + observed["servers"].get("literature", 0))

    stat_meta = _read_installed_release_meta("statistics")
    stat_cli_ok = _cli_available(settings.statistics_cli)
    stat_used = int(observed["tools"].get("statistics", 0) + observed["servers"].get("statistics", 0))

    rev_meta = _read_installed_release_meta("scientific-review")
    advisor_cfg = _inspect_workspace_advisor_config(workspace)
    rev_used = int(observed["tools"].get("scientific-review", 0) + observed["servers"].get("scientific-review", 0))

    pm_meta = _read_installed_release_meta("protein-methods")
    pm_cli_ok = _cli_available(settings.protein_cli)
    pm_used = int(observed["tools"].get("protein-methods", 0) + observed["servers"].get("protein-methods", 0))

    modules = [
        {
            "id": "literature",
            "title": "文献检索与获取 (Literature)",
            "owner": "BioHarness-Modules",
            "command": Path(settings.literature_cli).name,
            "version": lit_meta["version"],
            "source_sha": lit_meta["source_sha"],
            "declared": True,
            "installed": lit_cli_ok,
            "callable": lit_cli_ok and (paperseek_ok or scansci_ok),
            "inspectable": True,
            "actually_used": lit_used > 0,
            "use_count": lit_used,
            "status": (
                "CALLABLE"
                if (lit_cli_ok and paperseek_ok and scansci_ok)
                else ("PARTIAL_PROVIDERS" if (lit_cli_ok and (paperseek_ok or scansci_ok)) else
                      ("ADAPTER_ONLY_PROVIDERS_MISSING" if lit_cli_ok else "NOT_INSTALLED"))
            ),
            "providers": {
                "paperseek": {
                    "command": Path(settings.paperseek_cli).name,
                    "available": paperseek_ok,
                    "role": "KnowledgeSeek 文献检索上游 CLI",
                },
                "scansci_pdf": {
                    "command": Path(settings.scansci_cli).name,
                    "available": scansci_ok,
                    "role": "ScanSci PDF 文献全文获取上游 CLI",
                },
                "paperqa2": {
                    "command": "paperqa2",
                    "available": False,
                    "status": "NOT_PRODUCTION_ENABLED",
                    "role": "只读观察适配器（未作为生产检索/下载 Provider 启用）",
                },
            },
            "note": (
                "已支持查看并分页审阅工作区内 bioharness-literature 生成的 search.json / downloads.json（保留覆盖边界与截断声明）；"
                "在线 search/fetch 仅在对应上游 CLI（paperseek / scansci-pdf）可用时放开，不伪造引文或全文。"
            ),
        },
        {
            "id": "statistics",
            "title": "统计语义与确定性报告绑定 (Statistics)",
            "owner": "BioHarness-Modules",
            "command": Path(settings.statistics_cli).name,
            "version": stat_meta["version"] or "report_binding",
            "source_sha": stat_meta["source_sha"],
            "declared": True,
            "installed": stat_cli_ok,
            "callable": stat_cli_ok,
            "inspectable": True,
            "actually_used": stat_used > 0,
            "use_count": stat_used,
            "status": "CALLABLE" if stat_cli_ok else "NOT_INSTALLED",
            "actions": ["inspect", "render", "verify"],
            "subcomponents": {
                "report_binding_cli": "ISOLATED_CI_VERIFIED / CALLABLE" if stat_cli_ok else "NOT_INSTALLED",
                "clinical_subgroup_reviewers": "PRODUCTION_NOT_ENABLED",
                "legacy_cohens_d_archive": "SOURCE_ARCHIVED / NOT_RUNNABLE",
            },
            "note": (
                "直接调用模块拥有的 bioharness-statistics-report-binding render / verify 执行确定性数值绑定与校验，"
                "前端原样展示实验单位、分组、分子分母、效应量、置信区间与 p 值/FDR，绝不在浏览器端重算统计量。"
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
            "callable": bool(advisor_cfg["configured"]),
            "inspectable": True,
            "actually_used": rev_used > 0,
            "use_count": rev_used,
            "advisor_config": advisor_cfg,
            "status": (
                "ADVISOR_CONFIGURED"
                if advisor_cfg["configured"]
                else ("INSTALLED_ADVISOR_NOT_CONFIGURED" if rev_meta["installed_dir_present"] else "NOT_INSTALLED")
            ),
            "direct_model_api_gap_note": (
                "已安装的 bioharness-module-scientific-review（current=0.6.7 ed82a7b6，另装 0.7.1 356a5c6 Rev 11）"
                "仍经由 CodeArtsIntakeReviewer 外部 CLI 驱动，尚无直接 OpenAI/模型 API 适配层；"
                "任何适配器扩展归属 BioHarness-Modules，Web 仅非阻断展示 Core 记录的审查结论、依据、分歧与一次修订记录。"
            ),
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
            "version": pm_meta["version"] or "0.2.0",
            "source_sha": pm_meta["source_sha"],
            "declared": True,
            "installed": pm_cli_ok,
            "callable": pm_cli_ok,
            "inspectable": True,
            "actually_used": pm_used > 0,
            "use_count": pm_used,
            "operations": sorted(_PROTEIN_OPS),
            "status": "CALLABLE" if pm_cli_ok else "NOT_INSTALLED",
            "note": (
                "提供 6 个公开结构化审计子命令（structure-inventory / structure-compare / task-review / "
                "manifest-review / run-audit / outcome-audit），直接返回模块校验结果与版本。"
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
            "installed": False,
            "callable": False,
            "inspectable": False,
            "actually_used": False,
            "use_count": 0,
            "status": "SOURCE_HANDOFF_ONLY / NOT_PUBLISHED",
            "note": "仅保留历史参考适配器与源码归档，尚未泛化为可运行任意 TF 的在线模块；Web 不复现 DAP-seq 算法。",
        },
        {
            "id": "genome-web-tf",
            "title": "Genome-web TF 适配器（仅工程参考）",
            "owner": "BioHarness-Modules",
            "command": None,
            "version": None,
            "source_sha": None,
            "declared": True,
            "installed": False,
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
            "installed": False,
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
        "modules": modules,
        "workspace_files": list_workspace_module_files(workspace),
        "observed_usage": observed,
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
    raw = resolved.read_bytes()
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


async def run_literature_cli(
    *,
    settings: Settings,
    runner: CliRunner,
    workspace: Workspace,
    operation: str,
    question: str | None = None,
    source: str = "openalex",
    maximum: int = 10,
    iterations: int = 3,
    search_json_path: str | None = None,
    lanes: bool = True,
) -> dict[str, Any]:
    """Invoke the real bioharness-literature CLI in an isolated temp output dir."""
    if not _cli_available(settings.literature_cli):
        raise DomainModuleError("LITERATURE_CLI_MISSING", "未检测到 bioharness-literature CLI。", 503)
    if operation not in {"search", "fetch"}:
        raise DomainModuleError("INVALID_OPERATION", "仅支持 search 或 fetch 操作。", 422)

    redact = path_redactor(workspace)
    if operation == "search":
        if not question or not question.strip():
            raise DomainModuleError("QUESTION_REQUIRED", "请填写文献检索问题。", 422)
        if not _cli_available(settings.paperseek_cli):
            raise DomainModuleError(
                "LITERATURE_PROVIDER_UNAVAILABLE",
                f"上游检索工具 {Path(settings.paperseek_cli).name} 未在当前服务环境 PATH 中可用；"
                "不伪造文献结果。可使用上方“审阅已有 search.json”或在环境配置 paperseek 后重试。",
                503,
                {"missing_provider": "paperseek"},
            )
    else:
        if not search_json_path or not search_json_path.strip():
            raise DomainModuleError("SEARCH_JSON_REQUIRED", "请指定工作区内的 search.json 文件。", 422)
        if not _cli_available(settings.scansci_cli):
            raise DomainModuleError(
                "LITERATURE_PROVIDER_UNAVAILABLE",
                f"上游全文获取工具 {Path(settings.scansci_cli).name} 未在当前服务环境 PATH 中可用；"
                "不伪造 PDF 或下载记录。",
                503,
                {"missing_provider": "scansci-pdf"},
            )

    tmpdir = Path(tempfile.mkdtemp(prefix="bhweb-lit-"))
    os.chmod(tmpdir, 0o700)
    try:
        out_dir = tmpdir / "out"
        if operation == "search":
            argv = [
                settings.literature_cli,
                "search",
                question.strip(),
                "--source", source.strip() or "openalex",
                "--output", str(out_dir),
                "--max", str(max(1, min(maximum, 50))),
                "--iterations", str(max(1, min(iterations, 10))),
                "--paperseek", settings.paperseek_cli,
            ]
        else:
            search_file = resolve_workspace_file(workspace, search_json_path or "")
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
        except ToolError as exc:
            raise DomainModuleError(exc.code, exc.message, 502) from None
        return redact({
            "operation": operation,
            "cli": Path(settings.literature_cli).name,
            "result": payload,
        })
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


async def run_statistics_report_binding(
    *,
    settings: Settings,
    runner: CliRunner,
    workspace: Workspace,
    action: str,
    records_path: str,
    template_path: str | None = None,
    report_path: str | None = None,
) -> dict[str, Any]:
    """Run bioharness-statistics-report-binding render|verify or read-only bundle inspect."""
    if action not in {"inspect", "render", "verify"}:
        raise DomainModuleError("INVALID_ACTION", "仅支持 inspect / render / verify 操作。", 422)

    records_abs = resolve_workspace_file(workspace, records_path)
    raw_bytes = records_abs.read_bytes()
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
        })

    if not _cli_available(settings.statistics_cli):
        raise DomainModuleError("STATISTICS_CLI_MISSING", "未检测到 bioharness-statistics-report-binding CLI。", 503)
    if not template_path or not template_path.strip():
        raise DomainModuleError("TEMPLATE_REQUIRED", "执行 render / verify 需要提供模板文件（template_path）。", 422)
    template_abs = resolve_workspace_file(workspace, template_path)

    tmpdir = Path(tempfile.mkdtemp(prefix="bhweb-stat-"))
    os.chmod(tmpdir, 0o700)
    try:
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
            if not report_path or not report_path.strip():
                raise DomainModuleError("REPORT_REQUIRED", "执行 verify 需要提供待核验报告文件（report_path）。", 422)
            report_abs = resolve_workspace_file(workspace, report_path)
            argv = [
                settings.statistics_cli,
                "verify",
                "--records", str(records_abs),
                "--template", str(template_abs),
                "--report", str(report_abs),
            ]
            out_report = report_abs

        try:
            binding_result = await runner.run_json(argv, timeout=min(60.0, settings.tool_timeout_seconds))
            rendered_md = out_report.read_text(encoding="utf-8") if out_report.is_file() else None
            return redact({
                **base_resp,
                "status": str(binding_result.get("status") or "PASS"),
                "template_file": template_path.strip(),
                "report_file": report_path.strip() if report_path else None,
                "binding": binding_result,
                "rendered_markdown": rendered_md,
                "error": None,
            })
        except ToolError as exc:
            # report_binding prints "REPORT_BINDING_FAIL: ..." to stderr and exits 1 on mismatch.
            return redact({
                **base_resp,
                "status": "FAIL",
                "template_file": template_path.strip(),
                "report_file": report_path.strip() if report_path else None,
                "binding": None,
                "rendered_markdown": None,
                "error": {"code": "REPORT_BINDING_FAIL", "message": exc.message},
            })
    finally:
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
) -> dict[str, Any]:
    """Invoke one of the 6 public bioharness-protein-methods CLI subcommands safely."""
    if operation not in _PROTEIN_OPS:
        raise DomainModuleError(
            "UNSUPPORTED_PROTEIN_OPERATION",
            f"不支持的 protein-methods 子命令：{operation}",
            422,
        )
    if not _cli_available(settings.protein_cli):
        raise DomainModuleError("PROTEIN_CLI_MISSING", "未检测到 bioharness-protein-methods CLI。", 503)

    input_abs = resolve_workspace_file(workspace, input_path)
    argv = [settings.protein_cli, operation, str(input_abs)]

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
    elif operation == "structure-inventory" and model_index is not None:
        argv.extend(["--model-index", str(model_index)])

    try:
        result = await runner.run_json(argv, timeout=min(120.0, settings.module_tool_timeout_seconds))
    except ToolError as exc:
        raise DomainModuleError(exc.code, exc.message, 502) from None

    redact = path_redactor(workspace)
    return redact({
        "operation": operation,
        "cli": Path(settings.protein_cli).name,
        "input_file": input_path.strip(),
        "result": result,
    })
