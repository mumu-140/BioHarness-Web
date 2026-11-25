"""Read-only snapshots of Core and Project Governance through their public CLIs.

Web holds no scientific state: every snapshot is a fresh answer from the owner,
wrapped with the identity of what was asked and when it was observed. Nothing
here computes step eligibility, requirement coverage or any scientific status.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import time
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any

from .cli import CliRunner, ToolError
from .settings import Settings, Workspace

CORE, GOVERNANCE = "core", "project-governance"

# view -> (owner, required selector fields, optional selector fields)
VIEWS: dict[str, tuple[str, tuple[str, ...], tuple[str, ...]]] = {
    "open": (CORE, (), ()),
    "now": (CORE, ("request_id",), ()),
    "tree": (GOVERNANCE, (), ("project_id", "request_id")),
    "context": (GOVERNANCE, ("scope_id",), ("request_id", "limit")),
    "routes": (GOVERNANCE, ("scope_id",),
               ("offset", "limit", "include_descendants", "include_related")),
    "evidence": (GOVERNANCE, ("request_id", "submission_index", "evidence_id", "sha256"), ()),
}
_INTEGERS = {"limit", "offset", "submission_index"}
_FLAGS = {"include_descendants", "include_related"}
_SHA256 = re.compile(r"[0-9a-f]{64}")
# Core lists at most this many open requests in its ambiguity answer.
CORE_OPEN_LISTING = 20
CORE_STATE_DIRECTORIES = ("requests", "evidence", "sessions")
UNCONFIGURED = "$OUTSIDE_CONFIGURED_ROOTS"
_CACHE_ENTRIES = 64


class SelectorError(ValueError):
    """The browser asked for a view with a missing or malformed selector."""


class UnknownWorkspace(KeyError):
    pass


def normalize_selector(view: str, selector: dict[str, Any]) -> dict[str, Any]:
    if view not in VIEWS:
        raise SelectorError(f"unknown view '{view}'")
    _, required, optional = VIEWS[view]
    given = {k: v for k, v in selector.items() if v is not None and v is not False}
    unexpected = sorted(set(given) - set(required) - set(optional))
    if unexpected:
        raise SelectorError(f"{view} does not take: {', '.join(unexpected)}")
    missing = [name for name in required if name not in given]
    if missing:
        raise SelectorError(f"{view} requires: {', '.join(missing)}")
    clean: dict[str, Any] = {}
    for name, value in sorted(given.items()):
        if name in _FLAGS:
            clean[name] = True
        elif name in _INTEGERS:
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise SelectorError(f"{name} must be a non-negative integer")
            clean[name] = value
        elif name == "sha256":
            if not isinstance(value, str) or not _SHA256.fullmatch(value):
                raise SelectorError("sha256 must be 64 lowercase hex characters")
            clean[name] = value
        else:
            if (not isinstance(value, str) or not value or len(value) > 200
                    or any(ord(c) < 32 or ord(c) == 127 for c in value)):
                raise SelectorError(f"{name} must be a single-line identifier")
            clean[name] = value
    return clean


def _digest(value: Any) -> str:
    text = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def path_redactor(workspace: Workspace):
    """Replace configured server directories by labels in everything sent to a browser."""
    labels = [(str(workspace.path), "$WORKSPACE")] + [
        (str(root), f"$EVIDENCE_ROOT_{index}")
        for index, root in enumerate(workspace.evidence_roots[1:], 1)
    ]
    patterns = [
        (re.compile(re.escape(path) + r"(?![A-Za-z0-9_.-])"), label)
        for path, label in sorted(labels, key=lambda item: -len(item[0]))
    ]

    def outside(path: str) -> str:
        """A recorded file path that no configured directory covers: keep its name only."""
        return f"{UNCONFIGURED}/{os.path.basename(path)}" if path.startswith("/") else path

    def redact(value: Any) -> Any:
        if isinstance(value, str):
            for pattern, label in patterns:
                value = pattern.sub(label, value)
            return value
        if isinstance(value, list):
            return [redact(item) for item in value]
        if isinstance(value, dict):
            clean = {key: redact(item) for key, item in value.items()}
            # The two structured fields in which Core and Governance return file paths.
            if clean.get("kind") == "file" and isinstance(clean.get("source"), str):
                clean["source"] = outside(clean["source"])
            changed = clean.get("evidence_changed_since_submission")
            if isinstance(changed, list):
                clean["evidence_changed_since_submission"] = [
                    " (".join([outside(item.rsplit(" (", 1)[0]), *item.rsplit(" (", 1)[1:]])
                    if isinstance(item, str) else item
                    for item in changed
                ]
            return clean
        return value

    return redact


def source_error(owner: str, raw: dict) -> dict:
    """Core nests {code, message, ...}; Governance returns a plain message."""
    error = raw.get("error")
    if isinstance(error, dict):
        detail = {k: v for k, v in error.items() if k not in ("code", "message")}
        return {"origin": owner, "code": error.get("code"),
                "message": str(error.get("message", "")), "detail": detail}
    return {"origin": owner, "code": None,
            "message": str(error if error is not None else "the source refused the request"),
            "detail": {}}


def _open_requests(raw: dict) -> dict | None:
    """Core's public answers to science_now without a request_id, as one list.

    No open request -> IDLE; exactly one -> that request; several ->
    REQUEST_AMBIGUOUS naming them. Any other answer is not a listing.
    """
    if raw.get("ok") is True:
        if raw.get("phase") == "IDLE":
            requests: list[dict] = []
        elif isinstance(raw.get("request_id"), str):
            only = {"request_id": raw["request_id"], "question": raw.get("question")}
            scope = raw.get("scope_context")
            if isinstance(scope, dict):  # absent for an unscoped request
                only.update({key: scope[key] for key in ("scope_id", "project_id")
                             if isinstance(scope.get(key), str)})
            requests = [only]
        else:
            return None
        message = None
    else:
        error = raw.get("error")
        if not isinstance(error, dict) or error.get("code") != "REQUEST_AMBIGUOUS":
            return None
        requests = [r for r in error.get("open_requests", []) if isinstance(r, dict)]
        message = error.get("message")
    # Core lists at most CORE_OPEN_LISTING requests and gives the true number only in
    # its message, so a full list may or may not be complete.
    return {"core_state_present": True, "open_requests": requests,
            "may_be_incomplete": len(requests) >= CORE_OPEN_LISTING, "source_message": message}


class Sources:
    def __init__(self, settings: Settings, runner: CliRunner):
        self.settings = settings
        self.runner = runner
        self._cache: OrderedDict[tuple, tuple[float, dict]] = OrderedDict()
        self._inflight: dict[tuple, asyncio.Future] = {}

    def workspace(self, workspace_id: str) -> Workspace:
        try:
            return self.settings.workspaces[workspace_id]
        except KeyError:
            raise UnknownWorkspace(workspace_id) from None

    async def get(self, workspace_id: str, view: str, selector: dict[str, Any],
                  *, max_age: float = 1.0) -> dict:
        """A snapshot no older than max_age seconds; concurrent identical reads share one call.

        Raises ToolError when the owner's tool could not answer at all. A refusal
        by the owner (unknown scope, ambiguous request, ...) is a snapshot with ok=false.
        """
        workspace = self.workspace(workspace_id)
        selector = normalize_selector(view, selector)
        key = (workspace.id, view, json.dumps(selector, sort_keys=True))
        hit = self._cache.get(key)
        if hit and time.monotonic() - hit[0] <= max_age:
            return hit[1]
        pending = self._inflight.get(key)
        if pending is None:
            pending = asyncio.ensure_future(self._read(workspace, view, selector))
            self._inflight[key] = pending

            def done(task: asyncio.Future) -> None:
                self._inflight.pop(key, None)
                if not task.cancelled():
                    task.exception()  # retrieved here even if every waiter went away

            pending.add_done_callback(done)
        snapshot = await asyncio.shield(pending)
        self._cache[key] = (time.monotonic(), snapshot)
        self._cache.move_to_end(key)
        while len(self._cache) > _CACHE_ENTRIES:
            self._cache.popitem(last=False)
        return snapshot

    async def raw(self, workspace: Workspace, view: str, selector: dict[str, Any]) -> dict | None:
        """The owner's unmodified answer, or None when Core has no state here yet.

        Server-side use only: it may contain server paths.
        """
        owner = VIEWS[view][0]
        if owner == CORE:
            # The Core CLI creates its state directories when they are missing. A
            # read-only view must not initialise or complete a workspace, so Core is
            # called only where all of them already exist. Existence is all that is
            # looked at; no Core file is opened here.
            state = workspace.path / ".bioharness"
            if not all((state / name).is_dir() for name in CORE_STATE_DIRECTORIES):
                return None
            argv = [self.settings.core_cli, "call", f"--workspace={workspace.path}",
                    "science_now", "-"]
            return await self.runner.run_json(argv, dict(selector))
        argv = [self.settings.governance_cli, f"--workspace={workspace.path}", view]
        for name, value in selector.items():
            flag = "--" + name.replace("_", "-")
            argv.append(flag if name in _FLAGS else f"{flag}={value}")
        return await self.runner.run_json(argv)

    async def _read(self, workspace: Workspace, view: str, selector: dict[str, Any]) -> dict:
        owner = VIEWS[view][0]
        raw = await self.raw(workspace, view, selector)
        data: dict | None = None
        error: dict | None = None
        if raw is None:
            if view == "open":
                data = {"core_state_present": False, "open_requests": [],
                        "may_be_incomplete": False, "source_message": None}
            else:
                error = {"origin": "web", "code": "WORKSPACE_NO_CORE_STATE",
                         "message": "this workspace has no Core state yet", "detail": {}}
        elif view == "open":
            data = _open_requests(raw)
            if data is None:
                error = source_error(owner, raw)
        elif raw.get("ok") is True:
            data = raw
        else:
            error = source_error(owner, raw)

        redact = path_redactor(workspace)
        data, error = redact(data), redact(error)
        version = None
        if data is not None and owner == GOVERNANCE:
            exposed = {k: data[k] for k in ("view_sha256", "shared_sha256") if k in data}
            version = exposed or None
        return {
            "service": self.settings.service_id,
            "workspace": workspace.id,
            "view": view,
            "selector": selector,
            "source": {"owner": owner,
                       "interface": "science_now" if owner == CORE else view},
            "observed_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "ok": error is None,
            "data": data,
            "error": error,
            # What the owner itself exposes as a version of this view, if anything.
            "source_version": version,
            # Opaque identity of this returned content: equal or different, never ordered.
            "content_sha256": _digest({"data": data, "error": error}),
            "shortened": (data or {}).get("shortened"),
            "warnings": list((data or {}).get("warnings") or []),
        }
