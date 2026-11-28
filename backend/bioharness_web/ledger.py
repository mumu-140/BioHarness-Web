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
from contextlib import contextmanager
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
    request_id TEXT,
    scope_id TEXT,
    module_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    state TEXT NOT NULL,
    input_json TEXT,
    output_json TEXT,
    error_json TEXT,
    saved_artifact_json TEXT,
    run_id TEXT,
    operation_id TEXT,
    started_at TEXT,
    ended_at TEXT,
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
        self._migrate_module_events_columns()

    def _migrate_module_events_columns(self) -> None:
        existing = {
            row["name"]
            for row in self._db.execute("PRAGMA table_info(workspace_module_events)").fetchall()
        }
        additions = (
            ("request_id", "TEXT"),
            ("scope_id", "TEXT"),
            ("run_id", "TEXT"),
            ("operation_id", "TEXT"),
            ("started_at", "TEXT"),
            ("ended_at", "TEXT"),
        )
        for col, col_type in additions:
            if col not in existing:
                self._db.execute(f"ALTER TABLE workspace_module_events ADD COLUMN {col} {col_type}")

    @contextmanager
    def _tx(self):
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                yield self._db
                self._db.execute("COMMIT")
            except BaseException:
                try:
                    self._db.execute("ROLLBACK")
                except sqlite3.Error:
                    pass
                raise

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
            " AND (r.reason IS NULL OR r.reason NOT LIKE 'module:%') "
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

    def start_module_operation(
        self,
        workspace: str,
        *,
        module_id: str,
        operation: str,
        input_data: Any = None,
        conversation_id: str | None = None,
        request_id: str | None = None,
        scope_id: str | None = None,
    ) -> dict[str, Any]:
        """Atomically record the start of a real professional-module CLI invocation (`state='STARTED'`).

        Validates that any supplied `conversation_id` belongs to `workspace` (never leaking across
        workspaces) and inherits the conversation's bound `request_id` if none was supplied.
        """
        ev_id = new_id("mod")
        started_at = _now()
        bounded_in = bounded(input_data) if input_data is not None else None
        valid_convo_id: str | None = None
        resolved_req_id = request_id.strip() if isinstance(request_id, str) and request_id.strip() else None
        resolved_scope_id = scope_id.strip() if isinstance(scope_id, str) and scope_id.strip() else None

        with self._tx() as db:
            if conversation_id:
                row = db.execute(
                    "SELECT id, request_id FROM conversations WHERE id = ? AND workspace = ?",
                    (conversation_id, workspace),
                ).fetchone()
                if row is None:
                    raise ValueError(f"conversation {conversation_id} does not belong to workspace {workspace}")
                valid_convo_id = str(row["id"])
                if not resolved_req_id and row["request_id"]:
                    resolved_req_id = str(row["request_id"])

            db.execute(
                "INSERT INTO workspace_module_events "
                "(id, workspace, conversation_id, request_id, scope_id, module_id, operation, state, "
                " input_json, output_json, error_json, saved_artifact_json, run_id, operation_id, "
                " started_at, ended_at, at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, 'STARTED', ?, NULL, NULL, NULL, NULL, NULL, ?, NULL, ?)",
                (
                    ev_id,
                    workspace,
                    valid_convo_id,
                    resolved_req_id,
                    resolved_scope_id,
                    module_id,
                    operation,
                    json.dumps(bounded_in, ensure_ascii=False, default=str) if bounded_in is not None else None,
                    started_at,
                    started_at,
                ),
            )

        return {
            "id": ev_id,
            "workspace": workspace,
            "conversation_id": valid_convo_id,
            "request_id": resolved_req_id,
            "scope_id": resolved_scope_id,
            "module_id": module_id,
            "operation": operation,
            "state": "STARTED",
            "started_at": started_at,
            "ended_at": None,
            "at": started_at,
        }

    def finish_module_operation(
        self,
        event_id: str,
        *,
        state: str,
        output_data: Any = None,
        error_data: Any = None,
        saved_artifact: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        """Atomically complete a STARTED professional-module invocation with real ended_at & terminal status.

        When bound to a conversation, writes the completed technical `runs`, `operations`, and
        `operation.started`/`operation.finished` entries in the SAME SQLite transaction with true
        `started_at`/`ended_at` and terminal status (FINISHED/FAILED/INTERRUPTED), without polluting
        active chat runs or `last_run_state`.
        """
        assert state in OPERATION_ENDED
        ended_at = _now()
        bounded_out = bounded(output_data) if output_data is not None else None
        bounded_err = bounded(error_data) if error_data is not None else None

        with self._tx() as db:
            row = db.execute(
                "SELECT * FROM workspace_module_events WHERE id = ? AND state = 'STARTED'",
                (event_id,),
            ).fetchone()
            if row is None:
                return None
            rec = dict(row)
            started_at = rec.get("started_at") or rec["at"]
            valid_convo_id = rec.get("conversation_id")
            rec_run_id: str | None = None
            op_id: str | None = None

            if valid_convo_id is not None:
                rec_run_id = new_id("run")
                op_id = new_id("op")
                run_state = (
                    "FINISHED"
                    if state == "SUCCEEDED"
                    else ("INTERRUPTED" if state == "UNKNOWN" else ("CANCELLED" if state == "CANCELLED" else "FAILED"))
                )
                db.execute(
                    "INSERT INTO runs (id, conversation_id, state, started_at, ended_at, reason) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (rec_run_id, valid_convo_id, run_state, started_at, ended_at, f"module:{rec['module_id']}:{rec['operation']}"),
                )
                db.execute(
                    "INSERT INTO operations (id, run_id, kind, name, state, started_at, ended_at) "
                    "VALUES (?, ?, 'tool', ?, ?, ?, ?)",
                    (op_id, rec_run_id, f"{rec['module_id']}:{rec['operation']}", state, started_at, ended_at),
                )
                started_payload: dict[str, Any] = {
                    "operation_id": op_id,
                    "kind": "tool",
                    "name": f"{rec['module_id']}:{rec['operation']}",
                    "server": rec["module_id"],
                    "initiator": "user",
                    "input": json.loads(rec["input_json"]) if rec["input_json"] else None,
                }
                if rec.get("request_id"):
                    started_payload["request_id"] = rec["request_id"]
                if rec.get("scope_id"):
                    started_payload["scope_id"] = rec["scope_id"]
                finished_payload: dict[str, Any] = {
                    "operation_id": op_id,
                    "kind": "tool",
                    "name": f"{rec['module_id']}:{rec['operation']}",
                    "server": rec["module_id"],
                    "state": state,
                    "output": bounded_out,
                    "error": bounded_err,
                }
                if saved_artifact is not None:
                    finished_payload["saved_artifact"] = saved_artifact
                db.execute(
                    "INSERT INTO events (conversation_id, run_id, type, data, at) VALUES (?, ?, ?, ?, ?)",
                    (valid_convo_id, rec_run_id, "operation.started", json.dumps(started_payload, ensure_ascii=False, default=str), started_at),
                )
                db.execute(
                    "INSERT INTO events (conversation_id, run_id, type, data, at) VALUES (?, ?, ?, ?, ?)",
                    (valid_convo_id, rec_run_id, "operation.finished", json.dumps(finished_payload, ensure_ascii=False, default=str), ended_at),
                )

            db.execute(
                "UPDATE workspace_module_events "
                "SET state = ?, output_json = ?, error_json = ?, saved_artifact_json = ?, "
                "    run_id = ?, operation_id = ?, ended_at = ? "
                "WHERE id = ? AND state = 'STARTED'",
                (
                    state,
                    json.dumps(bounded_out, ensure_ascii=False, default=str) if bounded_out is not None else None,
                    json.dumps(bounded_err, ensure_ascii=False, default=str) if bounded_err is not None else None,
                    json.dumps(saved_artifact, ensure_ascii=False, default=str) if saved_artifact is not None else None,
                    rec_run_id,
                    op_id,
                    ended_at,
                    event_id,
                ),
            )

        return {
            "id": event_id,
            "workspace": rec["workspace"],
            "conversation_id": valid_convo_id,
            "request_id": rec.get("request_id"),
            "scope_id": rec.get("scope_id"),
            "module_id": rec["module_id"],
            "operation": rec["operation"],
            "state": state,
            "saved_artifact": saved_artifact,
            "started_at": started_at,
            "ended_at": ended_at,
            "at": started_at,
        }

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
        request_id: str | None = None,
        scope_id: str | None = None,
    ) -> dict[str, Any]:
        """Convenience wrapper delegating to atomic start_module_operation + finish_module_operation."""
        started = self.start_module_operation(
            workspace,
            module_id=module_id,
            operation=operation,
            input_data=input_data,
            conversation_id=conversation_id,
            request_id=request_id,
            scope_id=scope_id,
        )
        finished = self.finish_module_operation(
            started["id"],
            state=state,
            output_data=output_data,
            error_data=error_data,
            saved_artifact=saved_artifact,
        )
        return finished or started

    def module_invocations(self, workspace: str, limit: int = 20) -> list[dict[str, Any]]:
        rows = self._all(
            "SELECT id, conversation_id, request_id, scope_id, module_id, operation, state, "
            "input_json, error_json, saved_artifact_json, started_at, ended_at, at "
            "FROM workspace_module_events "
            "WHERE workspace = ? ORDER BY rowid DESC LIMIT ?",
            workspace,
            max(1, min(limit, 100)),
        )
        out: list[dict[str, Any]] = []
        for r in rows:
            out.append({
                "id": r["id"],
                "conversation_id": r["conversation_id"],
                "request_id": r["request_id"],
                "scope_id": r["scope_id"],
                "module_id": r["module_id"],
                "operation": r["operation"],
                "state": r["state"],
                "input": json.loads(r["input_json"]) if r["input_json"] else None,
                "error": json.loads(r["error_json"]) if r["error_json"] else None,
                "saved_artifact": json.loads(r["saved_artifact_json"]) if r["saved_artifact_json"] else None,
                "started_at": r["started_at"] or r["at"],
                "ended_at": r["ended_at"],
                "at": r["started_at"] or r["at"],
            })
        return out

    def observed_module_usage(self, workspace: str) -> dict[str, Any]:
        """Count observed tool/module invocations in this workspace from the Web ledger."""
        tool_rows = self._all(
            "SELECT o.name AS name, COUNT(*) AS cnt "
            "FROM operations o JOIN runs r ON r.id = o.run_id JOIN conversations c ON c.id = r.conversation_id "
            "WHERE c.workspace = ? AND o.kind = 'tool' AND o.state != 'STARTED' GROUP BY o.name",
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

        # Include finished workspace-level module invocations not already counted via conversation ops
        mod_rows = self._all(
            "SELECT module_id, operation, COUNT(*) AS cnt FROM workspace_module_events "
            "WHERE workspace = ? AND conversation_id IS NULL AND state != 'STARTED' "
            "GROUP BY module_id, operation",
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
        inflight_mods = self._all(
            "SELECT id FROM workspace_module_events WHERE state = 'STARTED'"
        )
        for mod in inflight_mods:
            self.finish_module_operation(
                mod["id"],
                state="UNKNOWN",
                error_data={
                    "code": "SERVICE_RESTARTED",
                    "message": "the service restarted before the module outcome was recorded",
                },
            )
        return runs
