"""Bounded preview of one recorded evidence file.

The browser never supplies a path. It names an exact recorded evidence version
(request, submission, evidence id, sha256); Project Governance resolves that to
the recorded item, and only then is the recorded source path opened, and only
inside the configured roots of that workspace.

A preview shows the file as it is now. Whether it still is the recorded version
is reported separately; neither says anything about scientific validity.
"""
from __future__ import annotations

import hashlib
import json
import os
import stat
from pathlib import Path
from typing import Any

from .settings import Workspace

# Above this size the current file is not re-hashed for a preview.
HASH_LIMIT_BYTES = 64 * 1024 * 1024
_OMITTED = "\n\n…… 中间内容已省略 ……\n\n".encode("utf-8")


def _format_for(name: str) -> str:
    suffix = Path(name).suffix.lower()
    if suffix == ".json":
        return "json"
    if suffix in {".tsv", ".csv"}:
        return "table"
    if suffix in {".fa", ".fasta", ".faa", ".fna"}:
        return "fasta"
    if suffix in {".tree", ".treefile", ".nwk", ".newick"}:
        return "newick"
    return "text"


def _permitted(workspace: Workspace, resolved: Path) -> bool:
    """Whether an already resolved path may be previewed."""
    # Core state, of this or any other workspace, is read through Core and never
    # previewed; that includes a state directory reached through a symlink.
    if ".bioharness" in resolved.parts:
        return False
    try:
        core_state = (workspace.path / ".bioharness").resolve()
    except (OSError, RuntimeError):
        return False
    if resolved == core_state or core_state in resolved.parents:
        return False
    return any(root == resolved or root in resolved.parents for root in workspace.evidence_roots)


def _allowed_file(workspace: Workspace, source: str) -> Path | None:
    """The real path of `source` if it lies inside a configured root."""
    if not os.path.isabs(source):
        return None
    try:
        resolved = Path(source).resolve(strict=True)
    except (OSError, RuntimeError, ValueError):
        return None
    return resolved if _permitted(workspace, resolved) else None


def _open_checked(workspace: Workspace, path: Path) -> int | None:
    """Open `path` for reading and return the descriptor only if what was
    actually opened is a regular file that is still permitted.

    The path was checked before opening, but a directory on it can be replaced
    by a symlink in between; the check is therefore repeated on the descriptor.
    O_NONBLOCK keeps a FIFO from blocking the open.
    """
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError:
        return None
    try:
        opened = Path(os.readlink(f"/proc/self/fd/{descriptor}"))
        if stat.S_ISREG(os.fstat(descriptor).st_mode) and _permitted(workspace, opened):
            return descriptor
    except OSError:
        pass
    os.close(descriptor)
    return None


def preview(workspace: Workspace, item: dict[str, Any], max_bytes: int) -> dict[str, Any]:
    """`item` is the evidence object returned by Governance `evidence`."""
    kind = str(item.get("kind"))
    source = str(item.get("source") or "")
    result: dict[str, Any] = {
        "evidence_id": item.get("id"),
        "kind": kind,
        "name": Path(source).name if kind == "file" else source,
        "recorded_sha256": item.get("sha256"),
        "recorded_bytes": item.get("bytes"),
        "content_available": False,
        "unavailable_reason": None,
        "current_file_identity": "NOT_CHECKED",
    }
    if kind != "file":
        # Text evidence lives only in Core's snapshot store; no public call returns it.
        result["unavailable_reason"] = "CONTENT_NOT_EXPOSED_BY_PUBLIC_INTERFACE"
        return result
    path = _allowed_file(workspace, source)
    descriptor = _open_checked(workspace, path) if path is not None else None
    if descriptor is None:
        result["unavailable_reason"] = "NOT_AVAILABLE_IN_CONFIGURED_ROOTS"
        return result
    with os.fdopen(descriptor, "rb") as handle:
        size = os.fstat(handle.fileno()).st_size
        if size <= HASH_LIMIT_BYTES:
            digest = hashlib.file_digest(handle, "sha256").hexdigest()
            result["current_file_identity"] = (
                "MATCHES_RECORD" if digest == item.get("sha256") else "DIFFERS_FROM_RECORD")
            handle.seek(0)
        truncated = size > max_bytes
        if truncated:
            head = handle.read(max_bytes // 2)
            handle.seek(size - (max_bytes - max_bytes // 2))
            raw = head + _OMITTED + handle.read(max_bytes - max_bytes // 2)
        else:
            raw = handle.read()
    result.update(size_bytes=size, truncated=truncated, format=_format_for(path.name))
    if b"\x00" in raw:
        result["unavailable_reason"] = "BINARY_PREVIEW_NOT_SUPPORTED"
        return result
    text = raw.decode("utf-8", errors="replace")
    if result["format"] == "json" and not truncated:
        try:
            pretty = json.dumps(json.loads(text), ensure_ascii=False, indent=2)
        except ValueError:
            pretty = text
        if len(pretty.encode("utf-8")) <= max_bytes:  # indentation must not exceed the bound
            text = pretty
    result.update(content_available=True, content=text)
    return result
