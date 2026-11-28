"""Bounded preview of one recorded evidence file.

The browser never supplies a path. It names an exact recorded evidence version
(request, submission, evidence id, sha256); Project Governance resolves that to
the recorded item, and only then is the recorded source path opened, and only
inside the configured roots of that workspace.

A preview shows the file as it is now. Whether it still is the recorded version
is reported separately; neither says anything about scientific validity.
"""
from __future__ import annotations

import csv
import hashlib
import io
import re
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


def path_permitted(workspace: Workspace, raw: str) -> bool:
    """Whether a path a model proposed may be handed to Core or a module tool: inside a
    configured root, outside every Core state directory, after resolving links and '..'."""
    try:
        path = Path(raw).expanduser()  # as Core does for an evidence path
        resolved = (path if path.is_absolute() else workspace.path / path).resolve()
    except (OSError, RuntimeError, ValueError):
        return False
    return _permitted(workspace, resolved)


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
        captured = None
        if size <= HASH_LIMIT_BYTES:
            # Hash and display the same bounded immutable bytes. An opened fd alone
            # does not protect against in-place writes by another process.
            data = handle.read(HASH_LIMIT_BYTES + 1)
            if len(data) <= HASH_LIMIT_BYTES:
                captured = data
                size = len(data)
                digest = hashlib.sha256(data).hexdigest()
                result["current_file_identity"] = (
                    "MATCHES_RECORD" if digest == item.get("sha256") else "DIFFERS_FROM_RECORD")
        if captured is not None:
            truncated = size > max_bytes
            raw = (captured[:max_bytes // 2] + _OMITTED +
                   captured[-(max_bytes - max_bytes // 2):]) if truncated else captured
        else:
            # Large or growing live files are only unverified bounded excerpts.
            size = os.fstat(handle.fileno()).st_size
            handle.seek(0)
            truncated = size > max_bytes
            if truncated:
                head = handle.read(max_bytes // 2)
                handle.seek(max(0, size - (max_bytes - max_bytes // 2)))
                raw = head + _OMITTED + handle.read(max_bytes - max_bytes // 2)
            else:
                raw = handle.read(max_bytes)
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


# Bounded transfer & table parsing limits for Step 4 viewers.
MAX_CONTENT_RANGE_BYTES = 8 * 1024 * 1024
TABLE_PARSE_LIMIT_BYTES = 16 * 1024 * 1024
TABLE_MAX_COLUMNS = 200
TABLE_MAX_CELL_CHARS = 4096

_CONTENT_MIME_BY_SUFFIX: dict[str, tuple[str, bool]] = {
    ".pdf": ("application/pdf", True),
    ".png": ("image/png", True),
    ".jpg": ("image/jpeg", True),
    ".jpeg": ("image/jpeg", True),
    ".gif": ("image/gif", True),
    ".webp": ("image/webp", True),
    # Static HTML is served strictly as text/plain on the API origin; browser renders inside sandboxed iframe.
    ".html": ("text/plain; charset=utf-8", True),
    ".htm": ("text/plain; charset=utf-8", True),
    ".txt": ("text/plain; charset=utf-8", True),
    ".tsv": ("text/plain; charset=utf-8", True),
    ".tab": ("text/plain; charset=utf-8", True),
    ".csv": ("text/plain; charset=utf-8", True),
    ".json": ("text/plain; charset=utf-8", True),
    ".md": ("text/plain; charset=utf-8", True),
    ".log": ("text/plain; charset=utf-8", True),
    ".fa": ("text/plain; charset=utf-8", True),
    ".fasta": ("text/plain; charset=utf-8", True),
    ".faa": ("text/plain; charset=utf-8", True),
    ".fna": ("text/plain; charset=utf-8", True),
    ".tree": ("text/plain; charset=utf-8", True),
    ".treefile": ("text/plain; charset=utf-8", True),
    ".nwk": ("text/plain; charset=utf-8", True),
    ".newick": ("text/plain; charset=utf-8", True),
    ".py": ("text/plain; charset=utf-8", True),
    ".r": ("text/plain; charset=utf-8", True),
    ".sh": ("text/plain; charset=utf-8", True),
    ".yaml": ("text/plain; charset=utf-8", True),
    ".yml": ("text/plain; charset=utf-8", True),
    ".xml": ("text/plain; charset=utf-8", True),
}

_TABLE_DELIMITERS: dict[str, str] = {
    ".csv": ",",
    ".tsv": "\t",
    ".tab": "\t",
}

_RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")
_SAFE_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


class EvidenceContentError(Exception):
    """Structured refusal when verified evidence bytes cannot be streamed."""

    def __init__(self, status: int, code: str, message: str, **extra: Any):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.extra = extra


def safe_disposition_name(filename: str) -> str:
    cleaned = _SAFE_FILENAME_RE.sub("_", Path(filename).name).strip("._")
    return cleaned[:120] or "evidence"


def parse_byte_range(
    header_value: str | None,
    size: int,
    *,
    max_chunk: int = MAX_CONTENT_RANGE_BYTES,
) -> tuple[int, int, bool]:
    """Parse a single HTTP byte Range header.

    Returns `(start, end_inclusive, is_partial)`. Raises `EvidenceContentError(416, ...)`
    when the range is malformed, multi-range, or unsatisfiable.
    """
    if not header_value:
        return (0, max(size - 1, 0), False)
    raw = header_value.strip()
    if "," in raw:
        raise EvidenceContentError(416, "INVALID_RANGE", "multiple byte ranges are not supported", size_bytes=size)
    match = _RANGE_RE.fullmatch(raw)
    if not match or (not match.group(1) and not match.group(2)):
        raise EvidenceContentError(416, "INVALID_RANGE", "malformed Range header", size_bytes=size)
    if size <= 0:
        raise EvidenceContentError(416, "RANGE_NOT_SATISFIABLE", "empty evidence file", size_bytes=0)
    start_s, end_s = match.group(1), match.group(2)
    if start_s and end_s:
        start, end = int(start_s), int(end_s)
        if start > end or start >= size:
            raise EvidenceContentError(416, "RANGE_NOT_SATISFIABLE", "requested byte range out of bounds", size_bytes=size)
        end = min(end, size - 1, start + max_chunk - 1)
    elif start_s:
        start = int(start_s)
        if start >= size:
            raise EvidenceContentError(416, "RANGE_NOT_SATISFIABLE", "requested byte range out of bounds", size_bytes=size)
        end = min(size - 1, start + max_chunk - 1)
    else:
        suffix = int(end_s)
        if suffix <= 0:
            raise EvidenceContentError(416, "RANGE_NOT_SATISFIABLE", "requested byte range out of bounds", size_bytes=size)
        length = min(suffix, size, max_chunk)
        start = size - length
        end = size - 1
    return (start, end, True)


def _capture_verified_bytes(handle, expected_sha: str) -> tuple[bytes, str]:
    """Verify exactly the bounded immutable bytes that will be parsed or returned.

    The caller owns the open, containment-checked file. Never hash an fd then
    reread mutable source bytes under the old digest. No persistent copy/cache.
    """
    size = os.fstat(handle.fileno()).st_size
    data = None if size > HASH_LIMIT_BYTES else handle.read(HASH_LIMIT_BYTES + 1)
    if data is None or len(data) > HASH_LIMIT_BYTES:
        raise EvidenceContentError(
            409, "EVIDENCE_EXCEEDS_HASH_BUDGET",
            "file exceeds the verification budget and cannot be verified as the recorded snapshot",
            current_file_identity="NOT_CHECKED", size_bytes=max(size, len(data or b"")),
            hash_limit_bytes=HASH_LIMIT_BYTES,
        )
    digest = hashlib.sha256(data).hexdigest()
    if digest != expected_sha:
        raise EvidenceContentError(
            409, "EVIDENCE_CONTENT_DRIFT",
            "current file bytes differ from the recorded SHA-256 snapshot; refusing to serve drifted bytes as recorded",
            current_file_identity="DIFFERS_FROM_RECORD", recorded_sha256=expected_sha,
            size_bytes=len(data),
        )
    return data, digest


def read_verified_content(workspace: Workspace, item: dict[str, Any]) -> tuple[bytes, dict[str, Any]]:
    """Capture a verified file version for bounded byte/range delivery."""
    kind = str(item.get("kind"))
    source = str(item.get("source") or "")
    expected_sha = str(item.get("sha256") or "")
    if kind != "file":
        raise EvidenceContentError(
            404, "CONTENT_NOT_EXPOSED_BY_PUBLIC_INTERFACE",
            "only recorded file evidence can be streamed; text snapshots are not exposed by public CLI",
        )
    path = _allowed_file(workspace, source)
    descriptor = _open_checked(workspace, path) if path is not None else None
    if descriptor is None or path is None:
        raise EvidenceContentError(
            404, "NOT_AVAILABLE_IN_CONFIGURED_ROOTS",
            "recorded file is not available inside configured workspace roots",
            current_file_identity="NOT_CHECKED",
        )
    with os.fdopen(descriptor, "rb") as handle:
        suffix = path.suffix.lower()
        mime_entry = _CONTENT_MIME_BY_SUFFIX.get(suffix)
        if mime_entry is None:
            raise EvidenceContentError(
                415, "UNSUPPORTED_MEDIA_FORMAT",
                f"format '{suffix or 'unknown'}' is not supported for direct browser viewing",
                current_file_identity="NOT_CHECKED",
            )
        data, digest = _capture_verified_bytes(handle, expected_sha)
    media_type, is_inline = mime_entry
    return data, {
        "name": path.name, "safe_name": safe_disposition_name(path.name),
        "media_type": media_type, "inline": is_inline, "size_bytes": len(data),
        "sha256": digest, "current_file_identity": "MATCHES_RECORD",
    }


def table_page(
    workspace: Workspace,
    item: dict[str, Any],
    *,
    offset: int = 0,
    limit: int = 100,
    parse_limit_bytes: int = TABLE_PARSE_LIMIT_BYTES,
) -> dict[str, Any]:
    """Return a bounded page of structured rows from a verified CSV/TSV evidence file.

    Never infers total row count from a truncated prefix and never serves drifted bytes as
    the recorded table.
    """
    kind = str(item.get("kind"))
    source = str(item.get("source") or "")
    expected_sha = str(item.get("sha256") or "")
    result: dict[str, Any] = {
        "evidence_id": item.get("id"),
        "kind": kind,
        "name": Path(source).name if kind == "file" else source,
        "recorded_sha256": expected_sha,
        "recorded_bytes": item.get("bytes"),
        "content_available": False,
        "unavailable_reason": None,
        "current_file_identity": "NOT_CHECKED",
        "columns": [],
        "rows": [],
        "offset": offset,
        "limit": limit,
        "returned_rows": 0,
        "has_more": False,
        "total_rows": None,
        "total_rows_known": False,
        "truncated": False,
        "row_semantics": "bounded_page",
        "sort_scope": "loaded_rows_only",
        "filter_scope": "loaded_rows_only",
    }
    if kind != "file":
        result["unavailable_reason"] = "CONTENT_NOT_EXPOSED_BY_PUBLIC_INTERFACE"
        return result
    path = _allowed_file(workspace, source)
    descriptor = _open_checked(workspace, path) if path is not None else None
    if descriptor is None or path is None:
        result["unavailable_reason"] = "NOT_AVAILABLE_IN_CONFIGURED_ROOTS"
        return result

    suffix = path.suffix.lower()
    delimiter = _TABLE_DELIMITERS.get(suffix)
    if delimiter is None:
        os.close(descriptor)
        result["unavailable_reason"] = "UNSUPPORTED_TABLE_FORMAT"
        return result

    with os.fdopen(descriptor, "rb") as handle:
        try:
            data, _ = _capture_verified_bytes(handle, expected_sha)
        except EvidenceContentError as err:
            result.update(err.extra)
            result["unavailable_reason"] = (
                "CONTENT_DIFFERS_FROM_RECORD" if err.code == "EVIDENCE_CONTENT_DRIFT" else err.code)
            return result
    result["size_bytes"] = len(data)
    result["current_file_identity"] = "MATCHES_RECORD"
    truncated = len(data) > parse_limit_bytes
    raw = data[:parse_limit_bytes]
    if truncated:
        # csv.reader handles quoted multiline records. A physical newline is
        # only a safe *input* bound, not a guarantee of a complete CSV record.
        last_nl = max(raw.rfind(b"\n"), raw.rfind(b"\r"))
        raw = raw[:last_nl + 1] if last_nl >= 0 else b""
    if b"\x00" in raw:
        result["unavailable_reason"] = "BINARY_PREVIEW_NOT_SUPPORTED"
        return result
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        result["unavailable_reason"] = "UNSUPPORTED_TABLE_ENCODING"
        return result
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=delimiter, strict=True)
    try:
        header = next(reader)
    except StopIteration:
        result.update(
            content_available=not truncated,
            unavailable_reason="TABLE_HEADER_OUTSIDE_PREVIEW_BUDGET" if truncated else None,
            delimiter="tab" if delimiter == "\t" else "comma",
            total_rows=0 if not truncated else None, total_rows_known=not truncated,
            truncated=truncated, preview_rows=0,
        )
        return result
    except csv.Error:
        result["unavailable_reason"] = "TABLE_PARSE_ERROR"
        return result

    if len(header) > TABLE_MAX_COLUMNS:
        header = header[:TABLE_MAX_COLUMNS]
        columns_truncated = True
    else:
        columns_truncated = False

    columns = [
        {"id": f"c{idx}", "name": (col.strip() or f"col_{idx + 1}")[:200], "index": idx}
        for idx, col in enumerate(header)
    ]

    page_rows: list[dict[str, Any]] = []
    seen_data_rows = 0
    cells_truncated = False
    try:
        for raw_row in reader:
            if not raw_row and seen_data_rows == 0:
                continue
            if seen_data_rows >= offset and len(page_rows) < limit:
                record: dict[str, Any] = {"__row_index": seen_data_rows + 1}
                for idx, col in enumerate(columns):
                    val = raw_row[idx] if idx < len(raw_row) else ""
                    if len(val) > TABLE_MAX_CELL_CHARS:
                        val = val[:TABLE_MAX_CELL_CHARS] + "…"
                        cells_truncated = True
                    record[col["id"]] = val
                page_rows.append(record)
            seen_data_rows += 1
    except csv.Error as err:
        # Only ignore a torn final quoted record at the deliberately cut boundary.
        # Other malformed or over-budget records are not silently treated as data.
        if not (truncated and str(err) == "unexpected end of data"):
            result["unavailable_reason"] = "TABLE_PARSE_ERROR"
            return result
    result.update(
        content_available=True,
        delimiter="tab" if delimiter == "\t" else "comma",
        columns=columns, columns_truncated=columns_truncated,
        cells_truncated=cells_truncated, rows=page_rows, returned_rows=len(page_rows),
        has_more=seen_data_rows > offset + len(page_rows),
        preview_rows=seen_data_rows,
        total_rows=None if truncated else seen_data_rows,
        total_rows_known=not truncated, truncated=truncated,
    )
    return result
