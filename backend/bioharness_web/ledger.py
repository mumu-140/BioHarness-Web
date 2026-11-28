"""The technical ledger: which conversation belongs to which Core request, which
runs and operations were started and how they ended, and the conversation log.

It records what this host observed. The event log includes the text of Core's
answers as the output of operations, for the execution trace, but nothing here
is ever read back as scientific state: no plan, step status, requirement or
verdict is kept as such, and what is shown or given to a model always comes
from a fresh Core answer. The ledger exists so that a restart or an ambiguous
answer never leads to a duplicate start or a blind replay.
"""
from __future__ import annotations

import json
import secrets
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_SCHEMA = """
CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    workspace TEXT NOT NULL,
    native_session TEXT NOT NULL UNIQUE,   -- server-generated; the identity Core's hooks see
    request_id TEXT,                       -- set once Core has answered science_begin, or on explicit attach
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    state TEXT NOT NULL,                   -- RUNNING | FINISHED | FAILED | INTERRUPTED | CANCELLED
    cancel_requested INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    reason TEXT
);
-- At most one run per conversation is in flight, enforced by the database itself.
CREATE UNIQUE INDEX IF NOT EXISTS one_running_run ON runs(conversation_id) WHERE state = 'RUNNING';
CREATE TABLE IF NOT EXISTS operations (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id),
    kind TEXT NOT NULL,                    -- core | hook | model | tool
    name TEXT NOT NULL,
    state TEXT NOT NULL,                   -- STARTED | SUCCEEDED | REFUSED | FAILED | UNKNOWN | CANCELLED
    started_at TEXT NOT NULL,
    ended_at TEXT
);
CREATE TABLE IF NOT EXISTS events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    run_id TEXT,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_by_conversation ON events(conversation_id, seq);
CREATE TABLE IF NOT EXISTS workspace_module_events (
    id TEXT PRIMARY KEY,
    workspace TEXT NOT NULL,
    conversation_id TEXT,
    module_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    state TEXT NOT NULL,
    input_json TEXT,
    output_json TEXT,
    error_json TEXT,
    saved_artifact_json TEXT,
    at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS module_events_by_workspace ON workspace_module_events(workspace, at DESC);
"""

RUN_ENDED = ("FINISHED", "FAILED", "INTERRUPTED", "CANCELLED")
OPERATION_ENDED = ("SUCCEEDED", "REFUSED", "FAILED", "UNKNOWN", "CANCELLED")
# One stored event value is cut to this many characters (a Core answer is at most 45 000).
MAX_EVENT_CHARS = 60_000


class RunActive(Exception):
    """The conversation already has a run in flight."""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def new_id(prefix: str) -> str:
    return f"{prefix}-{secrets.token_hex(8)}"


def bounded(value: Any) -> Any:
    """`value`, or a marked stand-in when its JSON form is too long to keep."""
    text = json.dumps(value, ensure_ascii=False, default=str)
    if len(text) <= MAX_EVENT_CHARS:
        return value
    return {"omitted": True, "characters": len(text), "head": text[:2000]}


class Ledger:
    def __init__(self, path: Path | str):
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(path), check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        self._db.executescript("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;" + _SCHEMA)

    def close(self) -> None:
        self._db.close()

    def _all(self, sql: str, *args: Any) -> list[dict]:
        with self._lock:
            return [dict(row) for row in self._db.execute(sql, args).fetchall()]

    def _one(self, sql: str, *args: Any) -> dict | None:
        rows = self._all(sql, *args)
        return rows[0] if rows else None

    # ---- conversations ---------------------------------------------------
    def create_conversation(self, workspace: str, request_id: str | None = None) -> dict:
        row = {"id": new_id("conv"), "workspace": workspace, "native_session": new_id("web"),
               "request_id": request_id, "created_at": _now()}
        with self._lock:
            self._db.execute(
                "INSERT INTO conversations VALUES (:id, :workspace, :native_session, :request_id, :created_at)", row)
        return row

    def conversation(self, conversation_id: str) -> dict | None:
        return self._one("SELECT * FROM conversations WHERE id = ?", conversation_id)

    def conversations(self, workspace: str) -> list[dict]:
        rows = self._all(
            "SELECT c.*, "
            "(SELECT r.state FROM runs r WHERE r.conversation_id = c.id "
            " ORDER BY r.started_at DESC, r.rowid DESC LIMIT 1) AS last_run_state, "
            "(SELECT e.data FROM events e WHERE e.conversation_id = c.id AND e.type = 'user.message' "
            " ORDER BY e.seq ASC LIMIT 1) AS _first_user_event, "
            "(SELECT e.at FROM events e WHERE e.conversation_id = c.id "
            " ORDER BY e.seq DESC LIMIT 1) AS updated_at, "
            "(SELECT e.data FROM events e WHERE e.conversation_id = c.id AND e.type = 'run.started' "
            " ORDER BY e.seq DESC LIMIT 1) AS _last_run_event "
            "FROM conversations c WHERE c.workspace = ? ORDER BY COALESCE(updated_at, c.created_at) DESC, c.rowid DESC",
            workspace)
        out: list[dict] = []
        for row in rows:
            first_msg = None
            raw_first = row.pop("_first_user_event", None)
            if isinstance(raw_first, str):
                try:
                    parsed = json.loads(raw_first)
                    text = str(parsed.get("text") or "").strip() if isinstance(parsed, dict) else ""
                    if text:
                        first_line = text.splitlines()[0].strip()
                        first_msg = first_line[:120] + ("…" if len(first_line) > 120 else "")
                except ValueError:
                    pass
            last_model = None
            last_strategy = None
            raw_run = row.pop("_last_run_event", None)
            if isinstance(raw_run, str):
                try:
                    parsed_run = json.loads(raw_run)
                    if isinstance(parsed_run, dict):
                        if isinstance(parsed_run.get("model"), str):
                            last_model = parsed_run["model"]
                        if isinstance(parsed_run.get("strategy"), str):
                            last_strategy = parsed_run["strategy"]
                except ValueError:
                    pass
            row["first_message"] = first_msg
            row["updated_at"] = row.get("updated_at") or row.get("created_at")
            row["last_model"] = last_model
            row["last_strategy"] = last_strategy
            out.append(row)
        return out

    def discard_unused(self, conversation_id: str) -> None:
        """Remove a conversation that was created for a request which was then refused,
        before anything was recorded for it."""
        with self._lock:
            self._db.execute(
                "DELETE FROM conversations WHERE id = ? AND request_id IS NULL "
                "AND NOT EXISTS (SELECT 1 FROM runs WHERE conversation_id = ?) "
                "AND NOT EXISTS (SELECT 1 FROM events WHERE conversation_id = ?)",
                (conversation_id, conversation_id, conversation_id))

    def begin_state(self, conversation_id: str) -> str | None:
        """How the conversation's most recent science_begin ended, or None if none was sent."""
        row = self._one(
            "SELECT o.state FROM operations o JOIN runs r ON r.id = o.run_id "
            "WHERE r.conversation_id = ? AND o.kind = 'core' AND o.name = 'science_begin' "
            "ORDER BY o.started_at DESC, o.rowid DESC LIMIT 1", conversation_id)
        return row["state"] if row else None

    def set_request(self, conversation_id: str, request_id: str) -> bool:
        """Record the Core request of a conversation; only once, never re-pointed."""
        with self._lock:
            done = self._db.execute(
                "UPDATE conversations SET request_id = ? WHERE id = ? AND request_id IS NULL",
                (request_id, conversation_id))
            return done.rowcount == 1

    # ---- runs ------------------------------------------------------------
    def start_run(self, conversation_id: str) -> str:
        run_id = new_id("run")
        try:
            with self._lock:
                self._db.execute(
                    "INSERT INTO runs (id, conversation_id, state, started_at) VALUES (?, ?, 'RUNNING', ?)",
                    (run_id, conversation_id, _now()))
        except sqlite3.IntegrityError:
            raise RunActive(conversation_id) from None
        return run_id

    def end_run(self, run_id: str, state: str, reason: str = "") -> None:
        assert state in RUN_ENDED
        with self._lock:
            self._db.execute(
                "UPDATE runs SET state = ?, ended_at = ?, reason = ? WHERE id = ? AND state = 'RUNNING'",
                (state, _now(), reason, run_id))

    def run(self, run_id: str) -> dict | None:
        return self._one("SELECT * FROM runs WHERE id = ?", run_id)

    def running_elsewhere(self, workspace: str, request_id: str, conversation_id: str) -> bool:
        """Whether another conversation of this service is working on the same request now."""
        return self._one(
            "SELECT 1 FROM runs r JOIN conversations c ON c.id = r.conversation_id "
            "WHERE r.state = 'RUNNING' AND c.workspace = ? AND c.request_id = ? AND c.id != ?",
            workspace, request_id, conversation_id) is not None

    def last_seq(self, conversation_id: str) -> int:
        row = self._one("SELECT COALESCE(MAX(seq), 0) AS seq FROM events WHERE conversation_id = ?",
                        conversation_id)
        return int(row["seq"]) if row else 0

    def active_run(self, conversation_id: str) -> dict | None:
        return self._one(
            "SELECT * FROM runs WHERE conversation_id = ? AND state = 'RUNNING'", conversation_id)

    def request_cancel(self, run_id: str) -> bool:
        with self._lock:
            done = self._db.execute(
                "UPDATE runs SET cancel_requested = 1 WHERE id = ? AND state = 'RUNNING'", (run_id,))
            return done.rowcount == 1

    # ---- operations ------------------------------------------------------
    def start_operation(self, run_id: str, kind: str, name: str) -> str:
        operation_id = new_id("op")
        with self._lock:
            self._db.execute(
                "INSERT INTO operations (id, run_id, kind, name, state, started_at) "
                "VALUES (?, ?, ?, ?, 'STARTED', ?)", (operation_id, run_id, kind, name, _now()))
        return operation_id

    def end_operation(self, operation_id: str, state: str) -> None:
        assert state in OPERATION_ENDED
        with self._lock:
            self._db.execute(
                "UPDATE operations SET state = ?, ended_at = ? WHERE id = ? AND state = 'STARTED'",
                (state, _now(), operation_id))

    def operations(self, run_id: str) -> list[dict]:
        return self._all("SELECT * FROM operations WHERE run_id = ? ORDER BY started_at, id", run_id)

    def record_module_operation(
        self,
        workspace: str,
        *,
        module_id: str,
        operation: str,
        state: str,
        input_data: Any = None,
        output_data: Any = None,
        error_data: Any = None,
        saved_artifact: dict[str, Any] | None = None,
        conversation_id: str | None = None,
    ) -> dict[str, Any]:
        """Record a real professional-module CLI invocation in the existing technical ledger.

        If `conversation_id` is supplied and belongs to `workspace`, also records a standard
        `operations` + `operation.started`/`operation.finished` entry so `/w/executions` displays
        the invocation with its domain output renderer without altering active chat run state.
        """
        assert state in OPERATION_ENDED
        ev_id = new_id("mod")
        at = _now()
        bounded_in = bounded(input_data) if input_data is not None else None
        bounded_out = bounded(output_data) if output_data is not None else None
        bounded_err = bounded(error_data) if error_data is not None else None
        valid_convo_id: str | None = None

        with self._lock:
            if conversation_id:
                row = self._db.execute(
                    "SELECT id FROM conversations WHERE id = ? AND workspace = ?",
                    (conversation_id, workspace),
                ).fetchone()
                if row is not None:
                    valid_convo_id = str(row["id"])

            self._db.execute(
                "INSERT INTO workspace_module_events "
                "(id, workspace, conversation_id, module_id, operation, state, input_json, output_json, "
                " error_json, saved_artifact_json, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    ev_id,
                    workspace,
                    valid_convo_id,
                    module_id,
                    operation,
                    state,
                    json.dumps(bounded_in, ensure_ascii=False, default=str) if bounded_in is not None else None,
                    json.dumps(bounded_out, ensure_ascii=False, default=str) if bounded_out is not None else None,
                    json.dumps(bounded_err, ensure_ascii=False, default=str) if bounded_err is not None else None,
                    json.dumps(saved_artifact, ensure_ascii=False, default=str) if saved_artifact is not None else None,
                    at,
                ),
            )

            if valid_convo_id is not None:
                # Attach a completed non-running technical record under this conversation so
                # /w/executions observes the real module call without emitting chat run.started/finished.
                rec_run_id = new_id("run")
                op_id = new_id("op")
                self._db.execute(
                    "INSERT INTO runs (id, conversation_id, state, started_at, ended_at, reason) "
                    "VALUES (?, ?, 'FINISHED', ?, ?, ?)",
                    (rec_run_id, valid_convo_id, at, at, f"module:{module_id}:{operation}"),
                )
                self._db.execute(
                    "INSERT INTO operations (id, run_id, kind, name, state, started_at, ended_at) "
                    "VALUES (?, ?, 'tool', ?, ?, ?, ?)",
                    (op_id, rec_run_id, f"{module_id}:{operation}", state, at, at),
                )
                started_payload = {
                    "operation_id": op_id,
                    "kind": "tool",
                    "name": f"{module_id}:{operation}",
                    "server": module_id,
                    "initiator": "user",
                    "input": bounded_in,
                }
                finished_payload: dict[str, Any] = {
                    "operation_id": op_id,
                    "kind": "tool",
                    "name": f"{module_id}:{operation}",
                    "server": module_id,
                    "state": state,
                    "output": bounded_out,
                    "error": bounded_err,
                }
                if saved_artifact is not None:
                    finished_payload["saved_artifact"] = saved_artifact
                self._db.execute(
                    "INSERT INTO events (conversation_id, run_id, type, data, at) VALUES (?, ?, ?, ?, ?)",
                    (valid_convo_id, rec_run_id, "operation.started", json.dumps(started_payload, ensure_ascii=False, default=str), at),
                )
                self._db.execute(
                    "INSERT INTO events (conversation_id, run_id, type, data, at) VALUES (?, ?, ?, ?, ?)",
                    (valid_convo_id, rec_run_id, "operation.finished", json.dumps(finished_payload, ensure_ascii=False, default=str), at),
                )

        return {
            "id": ev_id,
            "workspace": workspace,
            "conversation_id": valid_convo_id,
            "module_id": module_id,
            "operation": operation,
            "state": state,
            "saved_artifact": saved_artifact,
            "at": at,
        }

    def module_invocations(self, workspace: str, limit: int = 20) -> list[dict[str, Any]]:
        rows = self._all(
            "SELECT id, conversation_id, module_id, operation, state, input_json, error_json, "
            "saved_artifact_json, at FROM workspace_module_events "
            "WHERE workspace = ? ORDER BY rowid DESC LIMIT ?",
            workspace,
            max(1, min(limit, 100)),
        )
        out: list[dict[str, Any]] = []
        for r in rows:
            out.append({
                "id": r["id"],
                "conversation_id": r["conversation_id"],
                "module_id": r["module_id"],
                "operation": r["operation"],
                "state": r["state"],
                "input": json.loads(r["input_json"]) if r["input_json"] else None,
                "error": json.loads(r["error_json"]) if r["error_json"] else None,
                "saved_artifact": json.loads(r["saved_artifact_json"]) if r["saved_artifact_json"] else None,
                "at": r["at"],
            })
        return out

    def observed_module_usage(self, workspace: str) -> dict[str, Any]:
        """Count observed tool/module invocations in this workspace from the Web ledger."""
        tool_rows = self._all(
            "SELECT o.name AS name, COUNT(*) AS cnt "
            "FROM operations o JOIN runs r ON r.id = o.run_id JOIN conversations c ON c.id = r.conversation_id "
            "WHERE c.workspace = ? AND o.kind = 'tool' GROUP BY o.name",
            workspace,
        )
        tools = {str(row["name"]): int(row["cnt"]) for row in tool_rows}
        event_rows = self._all(
            "SELECT e.data AS data FROM events e JOIN conversations c ON c.id = e.conversation_id "
            "WHERE c.workspace = ? AND e.type IN ('tool.started', 'operation.started', 'module.tools') "
            "ORDER BY e.seq DESC LIMIT 500",
            workspace,
        )
        servers: dict[str, int] = {}
        for row in event_rows:
            try:
                data = json.loads(row["data"])
            except ValueError:
                continue
            if not isinstance(data, dict):
                continue
            if data.get("kind") and data.get("kind") != "tool":
                continue
            srv = data.get("server")
            if isinstance(srv, str) and srv and "name" in data:
                servers[srv] = servers.get(srv, 0) + 1

        # Include workspace-level module invocations that were not already counted via a conversation op
        mod_rows = self._all(
            "SELECT module_id, operation, COUNT(*) AS cnt FROM workspace_module_events "
            "WHERE workspace = ? AND conversation_id IS NULL GROUP BY module_id, operation",
            workspace,
        )
        extra_calls = 0
        for row in mod_rows:
            mid = str(row["module_id"])
            op = str(row["operation"])
            cnt = int(row["cnt"])
            extra_calls += cnt
            servers[mid] = servers.get(mid, 0) + cnt
            key = f"{mid}:{op}"
            tools[key] = tools.get(key, 0) + cnt

        return {
            "servers": servers,
            "tools": tools,
            "total_tool_calls": sum(tools.values()),
            "workspace_direct_module_calls": extra_calls,
        }

    # ---- events ----------------------------------------------------------
    def invocation_page(self, conversation_id: str, before: int | None, limit: int) -> dict:
        """Newest operations first, with only their own observed start/end payloads.

        Read rows and events in one SQLite snapshot. Rowid is a stable pagination
        cursor, not a scientific revision. Refetch the first page for live changes.
        """
        rows = self._all(
            "SELECT o.rowid AS cursor, o.*, "
            "(SELECT e.data FROM events e WHERE e.conversation_id = r.conversation_id "
            " AND e.run_id = o.run_id AND e.type = 'operation.started' "
            " AND json_extract(e.data, '$.operation_id') = o.id ORDER BY e.seq LIMIT 1) AS started, "
            "(SELECT e.data FROM events e WHERE e.conversation_id = r.conversation_id "
            " AND e.run_id = o.run_id AND e.type = 'operation.finished' "
            " AND json_extract(e.data, '$.operation_id') = o.id ORDER BY e.seq DESC LIMIT 1) AS finished "
            "FROM operations o JOIN runs r ON r.id = o.run_id "
            "WHERE r.conversation_id = ? AND (? IS NULL OR o.rowid < ?) "
            "ORDER BY o.rowid DESC LIMIT ?",
            conversation_id, before, before, limit + 1)
        more = len(rows) > limit
        items = []
        for row in rows[:limit]:
            started = json.loads(row.pop("started") or "{}")
            finished = json.loads(row.pop("finished") or "{}")
            items.append({
                **row, "server": started.get("server") or finished.get("server"),
                "input": started.get("input"), "output": finished.get("output"),
                "error": finished.get("error"), "note": finished.get("note"),
                "initiator": started.get("initiator"),
                "details": {key: value for key, value in finished.items() if key not in {
                    "operation_id", "kind", "name", "server", "state", "output", "error", "note"}},
            })
        return {"items": items, "next_before": items[-1]["cursor"] if more else None}

    def module_observation(self, conversation_id: str, server: str) -> dict | None:
        """Last recorded discovery, not a current reachability or installation check."""
        row = self._one(
            "SELECT run_id, data, at FROM events WHERE conversation_id = ? "
            "AND type = 'module.discovery' AND json_extract(data, '$.server') = ? "
            "ORDER BY seq DESC LIMIT 1", conversation_id, server)
        if row:
            row["data"] = json.loads(row["data"])
        return row

    def append(self, conversation_id: str, run_id: str | None, type_: str, data: dict) -> dict:
        at = _now()
        stored = {key: bounded(value) for key, value in data.items()}
        with self._lock:
            cursor = self._db.execute(
                "INSERT INTO events (conversation_id, run_id, type, data, at) VALUES (?, ?, ?, ?, ?)",
                (conversation_id, run_id, type_, json.dumps(stored, ensure_ascii=False, default=str), at))
            seq = cursor.lastrowid
        return {"seq": seq, "conversation_id": conversation_id, "run_id": run_id,
                "type": type_, "data": stored, "at": at}

    def events(self, conversation_id: str, after: int = 0) -> list[dict]:
        rows = self._all(
            "SELECT seq, conversation_id, run_id, type, data, at FROM events "
            "WHERE conversation_id = ? AND seq > ? ORDER BY seq", conversation_id, after)
        for row in rows:
            row["data"] = json.loads(row["data"])
        return rows

    # ---- restart ---------------------------------------------------------
    def recover(self) -> list[dict]:
        """After a restart nothing is in flight in this process any more. A run that was
        RUNNING was interrupted, and an operation that was STARTED has an unknown outcome:
        neither is assumed finished, cancelled or failed."""
        with self._lock:
            runs = [dict(row) for row in self._db.execute(
                "SELECT id, conversation_id FROM runs WHERE state = 'RUNNING'").fetchall()]
            operations = [dict(row) for row in self._db.execute(
                "SELECT o.id, o.kind, o.name, o.run_id, r.conversation_id FROM operations o "
                "JOIN runs r ON r.id = o.run_id WHERE o.state = 'STARTED'").fetchall()]
        for operation in operations:
            self.end_operation(operation["id"], "UNKNOWN")
            self.append(operation["conversation_id"], operation["run_id"], "operation.finished", {
                "operation_id": operation["id"], "kind": operation["kind"], "name": operation["name"],
                "state": "UNKNOWN", "note": "the service restarted before the outcome was recorded"})
        for run in runs:
            self.end_run(run["id"], "INTERRUPTED", "service restarted")
            self.append(run["conversation_id"], run["id"], "run.finished",
                        {"state": "INTERRUPTED", "reason": "service restarted"})
        return runs
