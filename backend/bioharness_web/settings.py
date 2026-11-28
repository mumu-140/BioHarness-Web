"""Trusted deployment configuration. Nothing here comes from the browser."""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
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
    # Optional explicitly authorized writable directory inside evidence_roots for small research inputs.
    upload_root: Path | None = None


@dataclass(frozen=True)
class ModelSettings:
    """The directly called model provider (an OpenAI-compatible endpoint). Server-side only."""

    base_url: str
    api_key: str
    name: str
    request_timeout_seconds: float = 300.0
    temperature: float | None = None
    max_tokens: int | None = None


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
    max_upload_bytes: int = 20 * 1024 * 1024
    # ---- native runtime (W2); disabled unless a model and a ledger are configured ----
    model: ModelSettings | None = None
    ledger_path: Path | None = None
    # name -> argv of a stdio MCP server; "{workspace}" stands for the workspace directory
    mcp_servers: Mapping[str, tuple[str, ...]] = field(default_factory=dict)
    # A mutating Core call waits for the workspace's advisor, which Core allows up to 3600 s.
    # The bound must exceed that; when it passes, the outcome of the call is unknown.
    core_call_timeout_seconds: float = 3900.0
    # science_now and the hooks re-hash recent evidence files, so the runtime gives them
    # more time than the 60 s of an interactive view.
    core_read_timeout_seconds: float = 600.0
    module_tool_timeout_seconds: float = 600.0
    max_model_turns_per_run: int = 40
    # Upper bound, in characters, of the tool traffic of one run kept in the model's context.
    model_context_chars: int = 240_000
    # Environment variables Core and module tools may need (e.g. a proxy for an advisor).
    tool_env_passthrough: tuple[str, ...] = ()

    @property
    def runtime_enabled(self) -> bool:
        return self.model is not None and self.ledger_path is not None

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
        max_upload_bytes = int(get("MAX_UPLOAD_BYTES", str(20 * 1024 * 1024)))
        if max_upload_bytes < 4096 or max_upload_bytes > 100 * 1024 * 1024:
            raise ValueError("BIOHARNESS_WEB_MAX_UPLOAD_BYTES must be between 4096 and 104857600")

        model_values = {name: get("MODEL_" + name) for name in ("BASE_URL", "API_KEY", "NAME")}
        ledger = get("LEDGER")
        if any(model_values.values()) and not (all(model_values.values()) and ledger):
            raise ValueError(
                "the native runtime needs BIOHARNESS_WEB_MODEL_BASE_URL, _MODEL_API_KEY, "
                "_MODEL_NAME and BIOHARNESS_WEB_LEDGER together")
        model = None
        if all(model_values.values()):
            model = ModelSettings(base_url=model_values["BASE_URL"], api_key=model_values["API_KEY"],
                                  name=model_values["NAME"])
            if not os.path.isabs(ledger) or not Path(ledger).parent.is_dir():
                raise ValueError("BIOHARNESS_WEB_LEDGER must be an absolute file path in an existing directory")

        call_timeout = float(get("CORE_CALL_TIMEOUT_SECONDS", "3900"))
        if call_timeout < 60:
            raise ValueError("BIOHARNESS_WEB_CORE_CALL_TIMEOUT_SECONDS must be at least 60 "
                             "and above the advisor timeout of the workspace")

        return cls(
            core_call_timeout_seconds=call_timeout,
            model=model,
            ledger_path=Path(ledger) if model else None,
            mcp_servers=parse_mcp_servers(get("MCP_SERVERS")),
            tool_env_passthrough=tuple(name.strip() for name in get("TOOL_ENV").split(",") if name.strip()),
            service_id=service_id,
            workspaces=parse_workspaces(get("WORKSPACES")),
            access_token=get("ACCESS_TOKEN"),
            core_cli=get("CORE_CLI", "bioharness-host"),
            governance_cli=get("GOVERNANCE_CLI", "bioharness-governance"),
            host=get("HOST", "127.0.0.1"),
            port=int(get("PORT", "8080")),
            poll_interval_seconds=poll,
            evidence_preview_max_bytes=preview_max_bytes,
            max_upload_bytes=max_upload_bytes,
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
        if not isinstance(spec, dict) or set(spec) - {"path", "evidence_roots", "upload_root"}:
            raise ValueError(f"workspace '{workspace_id}' must be a path or an object")
        path = _directory(spec.get("path"), f"workspace '{workspace_id}' path")
        extra = spec.get("evidence_roots", [])
        if not isinstance(extra, list):
            raise ValueError(f"workspace '{workspace_id}' evidence_roots must be a list")
        roots = tuple(dict.fromkeys([path] + [
            _directory(item, f"workspace '{workspace_id}' evidence root") for item in extra
        ]))
        upload_root = None
        if spec.get("upload_root") is not None:
            raw_upload = spec.get("upload_root")
            if not isinstance(raw_upload, str) or not os.path.isabs(raw_upload):
                raise ValueError(f"workspace '{workspace_id}' upload_root must be an absolute directory path")
            raw_path = Path(raw_upload)
            if raw_path.is_symlink():
                raise ValueError(f"workspace '{workspace_id}' upload_root cannot be a symlink")
            candidate = _directory(raw_upload, f"workspace '{workspace_id}' upload_root")
            state_dir = (path / ".bioharness").resolve()
            if candidate == state_dir or candidate.is_relative_to(state_dir):
                raise ValueError(f"workspace '{workspace_id}' upload_root cannot be under .bioharness")
            if not any(candidate == r or candidate.is_relative_to(r) for r in roots):
                raise ValueError(
                    f"workspace '{workspace_id}' upload_root must reside within configured evidence_roots"
                )
            upload_root = candidate
        workspaces[workspace_id] = Workspace(
            id=workspace_id, path=path, evidence_roots=roots, upload_root=upload_root
        )
    return workspaces


def parse_mcp_servers(raw: str) -> dict[str, tuple[str, ...]]:
    """BIOHARNESS_WEB_MCP_SERVERS: {"<name>": ["<command>", "<arg>", ...]}."""
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except ValueError:
        raise ValueError("BIOHARNESS_WEB_MCP_SERVERS is not valid JSON") from None
    if not isinstance(data, dict):
        raise ValueError("BIOHARNESS_WEB_MCP_SERVERS must be a JSON object")
    servers: dict[str, tuple[str, ...]] = {}
    for name, argv in data.items():
        if not _ID.fullmatch(name):
            raise ValueError(f"MCP server name '{name}' is not a short identifier")
        if (not isinstance(argv, list) or not argv
                or not all(isinstance(item, str) and item for item in argv)):
            raise ValueError(f"MCP server '{name}' must be a non-empty list of strings")
        servers[name] = tuple(argv)
    return servers
