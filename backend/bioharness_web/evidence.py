from __future__ import annotations

import hashlib
import json
import posixpath
from pathlib import Path, PurePosixPath
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

from .repository import TaskRecord


_SUPPORTED_ROLES = frozenset(
    {
        "process_record",
        "wrapper_stdout",
        "wrapper_stderr",
        "provider_invocation",
        "resolved_manifest",
        "execution_log",
        "execution_trace",
        "candidate_manifest",
        "audit_table",
        "alignment",
        "tree",
    }
)


def _evidence_id(role: str, source_path: str) -> str:
    value = f"{role}\0{source_path}".encode("utf-8")
    return hashlib.sha256(value).hexdigest()[:32]


def _file_uri_path(value: str) -> str | None:
    parsed = urlparse(value)
    if parsed.scheme != "file" or parsed.netloc not in {"", "localhost"}:
        return None
    return parsed.path


def _iter_persisted_evidence(record: TaskRecord):
    seen: set[tuple[str, str]] = set()

    for event in record.events:
        payload = event.get("payload")
        if not isinstance(payload, dict):
            continue
        executor_evidence = payload.get("executor_evidence")
        if not isinstance(executor_evidence, dict):
            continue
        evidence = executor_evidence.get("evidence")
        if not isinstance(evidence, (list, tuple)):
            continue
        for item in evidence:
            if not isinstance(item, dict):
                continue
            role = str(item.get("role") or "").strip()
            source_path = str(item.get("path") or "").strip()
            key = (role, source_path)
            if (
                role not in _SUPPORTED_ROLES
                or not source_path
                or key in seen
            ):
                continue
            seen.add(key)
            yield role, source_path

    for artifact in record.artifacts:
        role = str(artifact.get("role") or "").strip()
        uri = str(artifact.get("uri") or "").strip()
        source_path = _file_uri_path(uri) if uri else None
        if role not in _SUPPORTED_ROLES or not source_path:
            continue
        key = (role, source_path)
        if key in seen:
            continue
        seen.add(key)
        yield role, source_path


class EvidencePreviewer:
    def __init__(
        self,
        *,
        host_root: Path,
        mount_root: Path,
        max_bytes: int = 131072,
    ):
        self.host_root = host_root
        self.mount_root = mount_root
        self.max_bytes = max_bytes

    def _mapped_path(self, source_path: str) -> Path | None:
        pure = PurePosixPath(source_path)
        if not pure.is_absolute() or ".." in pure.parts:
            return None

        host_root = PurePosixPath(posixpath.normpath(self.host_root.as_posix()))
        normalized = PurePosixPath(posixpath.normpath(source_path))
        try:
            relative = normalized.relative_to(host_root)
        except ValueError:
            return None

        try:
            resolved_root = self.mount_root.resolve(strict=True)
            candidate = (resolved_root / Path(*relative.parts)).resolve(strict=True)
            candidate.relative_to(resolved_root)
        except (FileNotFoundError, RuntimeError, ValueError):
            return None

        return candidate if candidate.is_file() else None

    def references(
        self,
        record: TaskRecord,
        task_id: UUID,
    ) -> tuple[dict[str, Any], ...]:
        values: list[dict[str, Any]] = []
        for role, source_path in _iter_persisted_evidence(record):
            if self._mapped_path(source_path) is None:
                continue
            value_id = _evidence_id(role, source_path)
            values.append(
                {
                    "id": value_id,
                    "role": role,
                    "name": PurePosixPath(source_path).name,
                    "source_path": source_path,
                    "preview_ref": (
                        f"/api/tasks/{task_id}/evidence/{value_id}"
                    ),
                }
            )
        return tuple(values)

    @staticmethod
    def _format_for(path: Path) -> str:
        suffix = path.suffix.lower()
        if suffix == ".json":
            return "json"
        if suffix in {".tsv", ".csv"}:
            return "table"
        if suffix in {".fa", ".fasta", ".faa", ".fna"}:
            return "fasta"
        if suffix in {".tree", ".treefile", ".nwk", ".newick"}:
            return "newick"
        return "text"

    def _read_text(self, path: Path) -> tuple[str, int, bool]:
        size = path.stat().st_size
        truncated = size > self.max_bytes

        with path.open("rb") as handle:
            if not truncated:
                raw = handle.read()
            else:
                head_size = self.max_bytes // 2
                tail_size = self.max_bytes - head_size
                head = handle.read(head_size)
                handle.seek(max(size - tail_size, 0))
                tail = handle.read(tail_size)
                raw = (
                    head
                    + "\n\n…… 中间内容已省略 ……\n\n".encode("utf-8")
                    + tail
                )

        if b"\x00" in raw:
            raise ValueError("binary evidence preview is not supported")

        text = raw.decode("utf-8", errors="replace")
        if not truncated and path.suffix.lower() == ".json":
            try:
                text = json.dumps(
                    json.loads(text),
                    ensure_ascii=False,
                    indent=2,
                )
            except json.JSONDecodeError:
                pass
        return text, size, truncated

    def preview(
        self,
        record: TaskRecord,
        evidence_id: str,
    ) -> dict[str, Any]:
        match: tuple[str, str] | None = None
        for role, source_path in _iter_persisted_evidence(record):
            if _evidence_id(role, source_path) == evidence_id:
                match = (role, source_path)
                break

        if match is None:
            raise KeyError(evidence_id)

        role, source_path = match
        path = self._mapped_path(source_path)
        if path is None:
            raise FileNotFoundError(source_path)

        content, size, truncated = self._read_text(path)
        return {
            "id": evidence_id,
            "role": role,
            "name": PurePosixPath(source_path).name,
            "format": self._format_for(path),
            "size_bytes": size,
            "truncated": truncated,
            "content": content,
        }
