"""Bounded, authenticated research-input upload and authorized workspace file listing.

Uploads require an explicitly configured writable `upload_root` inside the workspace's
existing `evidence_roots` (never under `.bioharness`). Uploaded files are raw research
inputs (`evidence_verified: false`), never Core-verified scientific evidence.
"""
from __future__ import annotations

import hashlib
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .settings import Workspace
from .sources import path_redactor

ALLOWED_UPLOAD_EXTENSIONS: frozenset[str] = frozenset({
    ".csv", ".tsv", ".txt", ".md",
    ".fasta", ".fa", ".fna", ".faa", ".fastq", ".fq",
    ".pdf", ".json", ".jsonl",
    ".png", ".jpg", ".jpeg", ".svg",
})
DEFAULT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024  # 20 MiB
MAX_LISTED_FILES = 100
_SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")
_SAFE_SCOPE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


class InputError(Exception):
    """Refused upload or listing request."""

    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def _is_under_state_dir(path: Path, workspace: Workspace) -> bool:
    state_dir = (workspace.path / ".bioharness").resolve()
    try:
        path.resolve().relative_to(state_dir)
        return True
    except ValueError:
        return False


def sanitize_filename(raw: str | None) -> str:
    if not raw or not isinstance(raw, str):
        raise InputError("INPUT_FILENAME_REQUIRED", "请提供有效的文件名。", 422)
    name = raw.strip()
    if "/" in name or "\\" in name or ".." in name or name.startswith("."):
        raise InputError("INPUT_FILENAME_INVALID", "文件名不能包含路径分隔符、上级目录或隐藏文件前缀。", 422)
    if not _SAFE_NAME.fullmatch(name):
        raise InputError(
            "INPUT_FILENAME_INVALID",
            "文件名仅允许字母、数字、点、下划线和连字符，且不超过 120 个字符。",
            422,
        )
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED_UPLOAD_EXTENSIONS:
        raise InputError(
            "INPUT_EXTENSION_UNSUPPORTED",
            f"不支持的文件类型 {ext or '(无扩展名)'}；当前仅允许常见文本、表格、序列、PDF 与图片资料。",
            415,
        )
    return name


def sanitize_scope_segment(scope_id: str | None) -> str | None:
    if scope_id is None or not str(scope_id).strip():
        return None
    seg = str(scope_id).strip()
    if seg in {".", "..", ".bioharness"} or not _SAFE_SCOPE.fullmatch(seg):
        raise InputError("INPUT_SCOPE_INVALID", "项目/子项目目录标识无效，无法用于输入文件归档。", 422)
    return seg


def _iso_mtime(st: os.stat_result) -> str:
    return datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat(timespec="seconds")


def list_workspace_inputs(workspace: Workspace, *, max_upload_bytes: int = DEFAULT_MAX_UPLOAD_BYTES) -> dict[str, Any]:
    redact = path_redactor(workspace)
    files: list[dict[str, Any]] = []
    seen_real: set[Path] = set()
    truncated = False

    def scan_dir(base: Path, source_kind: str, max_depth: int) -> None:
        nonlocal truncated
        if not base.is_dir() or base.is_symlink():
            return
        base_resolved = base.resolve()
        stack: list[tuple[Path, int]] = [(base_resolved, 0)]
        while stack:
            current, depth = stack.pop()
            try:
                entries = sorted(current.iterdir(), key=lambda p: p.name.lower())
            except OSError:
                continue
            for entry in entries:
                if entry.name.startswith("."):
                    continue
                if entry.is_symlink():
                    continue
                try:
                    resolved = entry.resolve()
                except OSError:
                    continue
                if not resolved.is_relative_to(base_resolved) or _is_under_state_dir(resolved, workspace):
                    continue
                if entry.is_dir():
                    if depth < max_depth:
                        stack.append((resolved, depth + 1))
                    continue
                if not entry.is_file():
                    continue
                if resolved in seen_real:
                    continue
                ext = entry.suffix.lower()
                if ext not in ALLOWED_UPLOAD_EXTENSIONS:
                    continue
                if len(files) >= MAX_LISTED_FILES:
                    truncated = True
                    return
                try:
                    st = entry.stat()
                except OSError:
                    continue
                seen_real.add(resolved)
                files.append({
                    "name": entry.name,
                    "server_path": redact(str(resolved)),
                    "bytes": st.st_size,
                    "extension": ext,
                    "modified_at": _iso_mtime(st),
                    "source_kind": source_kind,
                    "evidence_verified": False,
                })

    if workspace.upload_root is not None:
        scan_dir(workspace.upload_root, "uploaded_input", max_depth=2)
    if not truncated:
        scan_dir(workspace.path, "workspace_file", max_depth=1)

    files.sort(key=lambda item: (item["source_kind"] != "uploaded_input", item["server_path"]))
    return {
        "workspace": workspace.id,
        "upload_enabled": workspace.upload_root is not None,
        "upload_disabled_reason": (
            None
            if workspace.upload_root is not None
            else "当前运行环境未配置授权可写研究输入目录（upload_root），仅支持引用已有只读资料。"
        ),
        "max_upload_bytes": max_upload_bytes,
        "allowed_extensions": sorted(ALLOWED_UPLOAD_EXTENSIONS),
        "files": files,
        "truncated": truncated,
    }


def save_workspace_input(
    workspace: Workspace,
    filename: str | None,
    data: bytes,
    *,
    scope_id: str | None = None,
    max_upload_bytes: int = DEFAULT_MAX_UPLOAD_BYTES,
) -> dict[str, Any]:
    if workspace.upload_root is None:
        raise InputError(
            "UPLOAD_NOT_CONFIGURED",
            "当前运行环境未配置授权可写研究输入目录（upload_root），不可上传文件；您可以继续引用已有只读资料。",
            403,
        )
    safe_name = sanitize_filename(filename)
    safe_scope = sanitize_scope_segment(scope_id)
    if not data:
        raise InputError("INPUT_EMPTY", "文件内容为空，无法上传。", 422)
    if len(data) > max_upload_bytes:
        raise InputError(
            "INPUT_TOO_LARGE",
            f"文件超过单文件上传上限（{max_upload_bytes // (1024 * 1024)} MiB）；大型数据集请保留在服务器存储并使用路径引用。",
            413,
        )

    root = workspace.upload_root.resolve()
    if workspace.upload_root.is_symlink() or not root.is_dir() or _is_under_state_dir(root, workspace):
        raise InputError("UPLOAD_ROOT_INVALID", "授权上传目录不可用或路径不合法。", 500)

    target_dir = root / safe_scope if safe_scope else root
    if target_dir.exists() and target_dir.is_symlink():
        raise InputError("UPLOAD_SYMLINK_REJECTED", "目标目录为符号链接，已拒绝写入。", 400)
    target_dir.mkdir(parents=True, exist_ok=True)
    target_dir_resolved = target_dir.resolve()
    if not target_dir_resolved.is_relative_to(root) or _is_under_state_dir(target_dir_resolved, workspace):
        raise InputError("UPLOAD_PATH_OUTSIDE_ROOT", "目标目录超出授权上传根目录。", 400)

    target = target_dir_resolved / safe_name
    if target.is_symlink():
        raise InputError("UPLOAD_SYMLINK_REJECTED", "目标路径为符号链接，已拒绝写入。", 400)
    if not target.resolve(strict=False).is_relative_to(root):
        raise InputError("UPLOAD_PATH_OUTSIDE_ROOT", "目标文件超出授权上传根目录。", 400)

    digest = hashlib.sha256(data).hexdigest()
    flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        fd = os.open(str(target), flags, 0o640)
    except FileExistsError:
        raise InputError(
            "INPUT_ALREADY_EXISTS",
            f"同名文件 {safe_name} 已存在；为防止覆盖历史研究资料，请重命名后重试或直接引用已有文件。",
            409,
        ) from None
    except OSError as exc:
        raise InputError("UPLOAD_WRITE_FAILED", f"写入授权目录失败：{type(exc).__name__}", 500) from None

    written = 0
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
            written = len(data)
    except Exception:
        try:
            target.unlink(missing_ok=True)
        except OSError:
            pass
        raise InputError("UPLOAD_WRITE_FAILED", "上传写入中断，已清理不完整文件，请重试。", 500) from None

    st = target.stat()
    if st.st_size != written:
        target.unlink(missing_ok=True)
        raise InputError("UPLOAD_INTEGRITY_FAILED", "文件写入大小校验失败，请重试。", 500)

    redact = path_redactor(workspace)
    return {
        "name": safe_name,
        "server_path": redact(str(target.resolve())),
        "sha256": digest,
        "bytes": st.st_size,
        "extension": target.suffix.lower(),
        "scope_id": safe_scope,
        "uploaded_at": _iso_mtime(st),
        "source_kind": "uploaded_input",
        "evidence_verified": False,
        "note": "文件已保存到授权输入目录并计算 SHA-256；该文件尚未成为 Core 已核验科研证据，需在研究步骤提交后由 Core 核验。",
    }
