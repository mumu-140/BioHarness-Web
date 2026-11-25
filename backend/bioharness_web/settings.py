"""Trusted deployment configuration. Nothing here comes from the browser."""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,63}")
MIN_TOKEN_LENGTH = 16


@dataclass(frozen=True)
class Workspace:
    """One canonical research workspace, addressed by an explicit server-side id."""

    id: str
    path: Path
    # Directories from which evidence file previews may be read. The workspace
    # itself comes first; Core state under .bioharness is never previewed.
    evidence_roots: tuple[Path, ...]


@dataclass(frozen=True)
class Settings:
    service_id: str
    workspaces: Mapping[str, Workspace]
    access_token: str
    core_cli: str = "bioharness-host"
    governance_cli: str = "bioharness-governance"
    host: str = "127.0.0.1"
    port: int = 8080
    poll_interval_seconds: float = 5.0
    tool_timeout_seconds: float = 60.0
    evidence_preview_max_bytes: int = 131072

    def __post_init__(self) -> None:
        # Also for settings built in code: an empty token would authenticate anyone.
        if len(self.access_token) < MIN_TOKEN_LENGTH:
            raise ValueError(
                "BIOHARNESS_WEB_ACCESS_TOKEN is required "
                f"(at least {MIN_TOKEN_LENGTH} characters)"
            )

    @classmethod
    def from_env(cls, env: Mapping[str, str] = os.environ) -> "Settings":
        def get(name: str, default: str = "") -> str:
            return env.get("BIOHARNESS_WEB_" + name, default).strip()

        service_id = get("SERVICE_ID", "bioharness-web")
        if not _ID.fullmatch(service_id):
            raise ValueError("BIOHARNESS_WEB_SERVICE_ID must be a short identifier")

        poll = float(get("POLL_INTERVAL_SECONDS", "5"))
        if poll < 1.0:
            raise ValueError("poll interval must be >= 1 second")
        preview_max_bytes = int(get("EVIDENCE_PREVIEW_MAX_BYTES", "131072"))
        if preview_max_bytes < 4096:
            raise ValueError("evidence preview max bytes must be >= 4096")

        return cls(
            service_id=service_id,
            workspaces=parse_workspaces(get("WORKSPACES")),
            access_token=get("ACCESS_TOKEN"),
            core_cli=get("CORE_CLI", "bioharness-host"),
            governance_cli=get("GOVERNANCE_CLI", "bioharness-governance"),
            host=get("HOST", "127.0.0.1"),
            port=int(get("PORT", "8080")),
            poll_interval_seconds=poll,
            evidence_preview_max_bytes=preview_max_bytes,
        )


def _directory(raw: object, what: str) -> Path:
    if not isinstance(raw, str) or not os.path.isabs(raw):
        raise ValueError(f"{what} must be an absolute directory path")
    path = Path(raw).resolve()
    if not path.is_dir():
        raise ValueError(f"{what} is not an existing directory")
    if path == Path(path.anchor) or path == Path.home().resolve():
        raise ValueError(f"{what} must be a project directory, not / or the home directory")
    return path


def parse_workspaces(raw: str) -> dict[str, Workspace]:
    """BIOHARNESS_WEB_WORKSPACES: {"<id>": "<path>"} or
    {"<id>": {"path": "<path>", "evidence_roots": ["<dir>", ...]}}."""
    if not raw:
        raise ValueError("BIOHARNESS_WEB_WORKSPACES is required (JSON object)")
    try:
        data = json.loads(raw)
    except ValueError:
        raise ValueError("BIOHARNESS_WEB_WORKSPACES is not valid JSON") from None
    if not isinstance(data, dict) or not data:
        raise ValueError("BIOHARNESS_WEB_WORKSPACES must be a non-empty JSON object")

    workspaces: dict[str, Workspace] = {}
    for workspace_id, value in data.items():
        if not _ID.fullmatch(workspace_id):
            raise ValueError(f"workspace id '{workspace_id}' is not a short identifier")
        spec = {"path": value} if isinstance(value, str) else value
        if not isinstance(spec, dict) or set(spec) - {"path", "evidence_roots"}:
            raise ValueError(f"workspace '{workspace_id}' must be a path or an object")
        path = _directory(spec.get("path"), f"workspace '{workspace_id}' path")
        extra = spec.get("evidence_roots", [])
        if not isinstance(extra, list):
            raise ValueError(f"workspace '{workspace_id}' evidence_roots must be a list")
        roots = [path] + [
            _directory(item, f"workspace '{workspace_id}' evidence root") for item in extra
        ]
        workspaces[workspace_id] = Workspace(
            id=workspace_id, path=path, evidence_roots=tuple(dict.fromkeys(roots))
        )
    return workspaces
