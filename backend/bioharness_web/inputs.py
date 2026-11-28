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

import secrets
import stat
from . import evidence
from .settings import Workspace
from .sources import path_expander, path_redactor

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
        scan_dir(workspace.upload_root, "uploaded_input", max_depth=3)
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


MAX_ATTACHMENTS_PER_MESSAGE = 12


_READABLE_TEXT_EXTENSIONS: frozenset[str] = frozenset({
    ".csv", ".tsv", ".txt", ".md",
    ".fasta", ".fa", ".fna", ".faa", ".fastq", ".fq",
    ".json", ".jsonl",
})
MAX_ATTACHMENT_EXCERPT_CHARS = 8_000
MAX_ATTACHMENT_TOTAL_CHARS = 16_000


def _resolve_attachment_path(workspace: Workspace, raw_path: str) -> Path:
    if not raw_path or any(ord(ch) < 32 for ch in raw_path):
        raise InputError("ATTACHMENT_PATH_INVALID", "附件路径无效。", 422)
    expand = path_expander(workspace)
    expanded = expand(raw_path)
    if not isinstance(expanded, str):
        raise InputError("ATTACHMENT_PATH_INVALID", "附件路径无效。", 422)
    ws_root = workspace.path.resolve()
    roots = [r.resolve() for r in workspace.evidence_roots]
    if os.path.isabs(expanded):
        cand = Path(expanded)
    else:
        if "\\" in expanded or ".." in Path(expanded).parts:
            raise InputError("ATTACHMENT_PATH_INVALID", "附件相对路径不允许包含上级目录。", 422)
        cand = ws_root / expanded
    try:
        resolved = cand.resolve(strict=True)
    except OSError:
        raise InputError("ATTACHMENT_NOT_FOUND", f"找不到所选附件：{raw_path}", 404) from None
    matching_root = next((r for r in roots if resolved.is_relative_to(r)), None)
    if matching_root is None or _is_under_state_dir(resolved, workspace) or not resolved.is_file():
        raise InputError("ATTACHMENT_OUTSIDE_WORKSPACE", f"附件不在当前工作区授权范围内：{raw_path}", 403)
    rel_parts = cand.relative_to(matching_root).parts if cand.is_relative_to(matching_root) else ()
    cur = matching_root
    for seg in rel_parts:
        cur = cur / seg
        if cur.is_symlink():
            raise InputError("ATTACHMENT_SYMLINK_REFUSED", "拒绝绑定符号链接附件。", 403)
    return resolved


def _capture_fd_bounded(fd: int, prefix_limit: int = 0) -> tuple[str | None, bytes, int]:
    """Hash and capture the same bounded stream; never reread mutable source bytes.

    A growing, shrinking or otherwise changed file has no verified digest. The
    prefix is at most the caller's small text budget, not a full dataset copy.
    """
    before = os.fstat(fd)
    if before.st_size > evidence.HASH_LIMIT_BYTES:
        return None, b"", before.st_size
    os.lseek(fd, 0, os.SEEK_SET)
    hasher = hashlib.sha256()
    prefix = bytearray()
    total = 0
    while total <= evidence.HASH_LIMIT_BYTES:
        chunk = os.read(fd, min(65536, evidence.HASH_LIMIT_BYTES + 1 - total))
        if not chunk:
            break
        total += len(chunk)
        if total > evidence.HASH_LIMIT_BYTES:
            return None, b"", os.fstat(fd).st_size
        hasher.update(chunk)
        if len(prefix) < prefix_limit:
            prefix.extend(chunk[:prefix_limit - len(prefix)])
    after = os.fstat(fd)
    identity = lambda st: (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns)
    if total != before.st_size or identity(before) != identity(after):
        return None, b"", after.st_size
    return hasher.hexdigest(), bytes(prefix), total


def validate_attachments(
    workspace: Workspace,
    raw_items: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Validate structured user-attached workspace input files without altering the user's question.

    Reuses `evidence._open_checked` (O_RDONLY | O_NOFOLLOW | O_NONBLOCK + descriptor verification)
    and streams SHA-256 within `evidence.HASH_LIMIT_BYTES` so large files never exhaust memory.
    """
    if not raw_items:
        return []
    if len(raw_items) > MAX_ATTACHMENTS_PER_MESSAGE:
        raise InputError(
            "TOO_MANY_ATTACHMENTS",
            f"单条消息最多绑定 {MAX_ATTACHMENTS_PER_MESSAGE} 个研究资料附件。",
            422,
        )
    redact = path_redactor(workspace)
    ws_root = workspace.path.resolve()
    validated: list[dict[str, Any]] = []
    seen: set[Path] = set()
    for raw in raw_items:
        raw_path = str(raw.get("path") or raw.get("server_path") or "").strip()
        resolved = _resolve_attachment_path(workspace, raw_path)
        if resolved in seen:
            continue
        seen.add(resolved)
        fd = evidence._open_checked(workspace, resolved)
        if fd is None:
            raise InputError("ATTACHMENT_SYMLINK_REFUSED", f"附件无法以安全常规文件打开：{raw_path}", 403)
        try:
            st = os.fstat(fd)
            if not stat.S_ISREG(st.st_mode):
                raise InputError("ATTACHMENT_OUTSIDE_WORKSPACE", f"附件不是常规文件：{raw_path}", 403)
            digest, _, observed_size = _capture_fd_bounded(fd)
        except OSError:
            raise InputError("ATTACHMENT_READ_FAILED", "附件读取失败。", 409) from None
        finally:
            os.close(fd)
        expected_sha = raw.get("sha256")
        if isinstance(expected_sha, str) and expected_sha.strip():
            if digest is not None and expected_sha.strip().lower() != digest:
                raise InputError(
                    "ATTACHMENT_SHA_MISMATCH",
                    f"附件内容校验摘要已变化（{resolved.name}），请重新确认后再提交。",
                    409,
                )
        rel_to_ws = str(resolved.relative_to(ws_root)) if resolved.is_relative_to(ws_root) else resolved.name
        validated.append({
            "name": resolved.name,
            "server_path": redact(str(resolved)),
            "relative_path": rel_to_ws,
            "bytes": observed_size,
            "extension": resolved.suffix.lower(),
            # Retain an explicitly recorded identity even when this host cannot
            # verify a large file. It remains a reference, not verified content.
            "sha256": digest or (expected_sha.strip().lower() if isinstance(expected_sha, str) and expected_sha.strip() else None),
            "hash_skipped": digest is None,
            "file_identity": "MATCHES_RECORD" if digest is not None else "NOT_CHECKED",
            "evidence_verified": False,
        })
    return validated


def read_attachment_for_model(
    workspace: Workspace,
    attachment: dict[str, Any],
    *,
    max_chars: int = MAX_ATTACHMENT_EXCERPT_CHARS,
) -> dict[str, Any]:
    """Re-verify an attachment's file identity via `evidence._open_checked` and read a bounded safe
    content excerpt for analysis. Never feeds drifted/tampered bytes or raw binary garbage to the model.
    """
    redact = path_redactor(workspace)
    raw_path = str(attachment.get("server_path") or attachment.get("relative_path") or "").strip()
    name = str(attachment.get("name") or Path(raw_path).name or "attachment")
    recorded_sha = attachment.get("sha256")
    recorded_sha_str = recorded_sha.strip().lower() if isinstance(recorded_sha, str) and recorded_sha.strip() else None
    base_info: dict[str, Any] = {
        "name": name,
        "server_path": redact(raw_path),
        "recorded_sha256": recorded_sha_str,
        "evidence_verified": False,
    }
    try:
        resolved = _resolve_attachment_path(workspace, raw_path)
    except InputError as exc:
        return {
            **base_info,
            "file_identity": "UNAVAILABLE",
            "readable": False,
            "error_code": exc.code,
            "note": exc.message,
        }

    fd = evidence._open_checked(workspace, resolved)
    if fd is None:
        return {
            **base_info,
            "file_identity": "UNAVAILABLE",
            "readable": False,
            "error_code": "ATTACHMENT_SYMLINK_REFUSED",
            "note": "附件无法以安全常规文件打开（符号链接或路径不再受权）。",
        }

    max_chars = max(0, min(max_chars, MAX_ATTACHMENT_EXCERPT_CHARS))
    ext = resolved.suffix.lower()
    fmt = evidence._format_for(resolved.name)
    prefix_limit = min(max_chars * 4, 32_000) if ext in _READABLE_TEXT_EXTENSIONS else 16
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode):
            return {**base_info, "file_identity": "UNAVAILABLE", "readable": False,
                    "error_code": "ATTACHMENT_NOT_REGULAR", "note": "附件不是常规文件。"}
        if recorded_sha_str is None:
            return {**base_info, "bytes": st.st_size, "file_identity": "NOT_CHECKED",
                    "readable": False, "note": "附件没有已记录摘要，仅提供文件引用。"}
        current_sha, captured, size = _capture_fd_bounded(fd, prefix_limit)
    except OSError:
        return {**base_info, "file_identity": "UNAVAILABLE", "readable": False,
                "error_code": "ATTACHMENT_READ_FAILED", "note": "附件读取失败。"}
    finally:
        os.close(fd)

    if current_sha is None:
        return {**base_info, "bytes": size, "file_identity": "NOT_CHECKED", "readable": False,
                "note": "文件超出在线核验范围或读取时发生变化，仅提供文件引用。"}
    if current_sha != recorded_sha_str:
        return {**base_info, "bytes": size, "current_sha256": current_sha,
                "file_identity": "DIFFERS_FROM_RECORD", "readable": False,
                "note": "附件内容与提交时的 SHA-256 不一致，未提供漂移内容。"}
    verified = {**base_info, "bytes": size, "sha256": current_sha,
                "extension": ext, "file_identity": "MATCHES_RECORD"}
    if ext not in _READABLE_TEXT_EXTENSIONS:
        return {**verified, "format": "binary", "readable": False,
                "content_mode": "binary_metadata_only",
                **({"pdf_header_valid": captured.startswith(b"%PDF-")} if ext == ".pdf" else {}),
                "note": "二进制附件已核验摘要，仅提供文件引用。"}
    if max_chars == 0:
        return {**verified, "format": fmt, "readable": False,
                "note": "本次附件摘录预算已用完，仅提供已核验的文件引用。"}

    # The prefix came from the very stream whose full SHA-256 matched. It is
    # only an excerpt, never a parsed full table, sequence collection or report.
    decoded = captured.decode("utf-8", errors="replace").replace("\x00", "")
    redacted_text = redact(decoded)
    truncated = len(captured) < size or len(redacted_text) > max_chars
    redacted_text = redacted_text[:max_chars]
    return {**verified, "format": fmt, "readable": True, "truncated": truncated,
            "chars_read": len(redacted_text), "lines_included": len(redacted_text.splitlines()),
            "excerpt": redacted_text}


def save_module_artifact(
    workspace: Workspace,
    module_id: str,
    filename_hint: str,
    data: bytes,
) -> dict[str, Any] | None:
    """Persist a deterministic module output under the workspace's authorized `upload_root`.

    Returns None when the workspace is read-only (no `upload_root` configured).
    Uses O_CREAT | O_EXCL | O_NOFOLLOW to prevent overwrites and symlink attacks.
    """
    if workspace.upload_root is None:
        return None
    safe_mod = sanitize_scope_segment(module_id)
    if not safe_mod:
        raise InputError("MODULE_ID_INVALID", "模块标识无效。", 422)
    raw_name = Path(filename_hint).name.strip()
    ext = Path(raw_name).suffix.lower()
    if ext not in ALLOWED_UPLOAD_EXTENSIONS:
        ext = ".json"
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", Path(raw_name).stem).strip("-._")[:48] or "artifact"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    unique_name = f"{stamp}-{secrets.token_hex(4)}-{stem}{ext}"

    root = workspace.upload_root.resolve()
    if workspace.upload_root.is_symlink() or not root.is_dir() or _is_under_state_dir(root, workspace):
        raise InputError("UPLOAD_ROOT_INVALID", "授权目录不可用。", 500)

    art_base = root / "module-artifacts"
    target_dir = art_base / safe_mod
    for d in (art_base, target_dir):
        if d.exists() and d.is_symlink():
            raise InputError("UPLOAD_SYMLINK_REJECTED", "产物目录包含符号链接，已拒绝写入。", 400)
        d.mkdir(parents=True, exist_ok=True)
    target_dir_resolved = target_dir.resolve()
    if not target_dir_resolved.is_relative_to(root) or _is_under_state_dir(target_dir_resolved, workspace):
        raise InputError("UPLOAD_PATH_OUTSIDE_ROOT", "产物目录超出授权根目录。", 400)

    target = target_dir_resolved / unique_name
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(str(target), flags, 0o600)
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
    except BaseException:
        try:
            target.unlink(missing_ok=True)
        except OSError:
            pass
        raise

    resolved = target.resolve()
    ws_root = workspace.path.resolve()
    redact = path_redactor(workspace)
    rel_to_ws = str(resolved.relative_to(ws_root)) if resolved.is_relative_to(ws_root) else unique_name
    return {
        "name": unique_name,
        "module_id": safe_mod,
        "server_path": redact(str(resolved)),
        "relative_path": rel_to_ws,
        "bytes": len(data),
        "extension": ext,
        "sha256": hashlib.sha256(data).hexdigest(),
        "saved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source_kind": "module_artifact",
        "evidence_verified": False,
    }
