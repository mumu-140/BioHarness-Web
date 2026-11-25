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
        return self._all(
            "SELECT c.*, (SELECT r.state FROM runs r WHERE r.conversation_id = c.id "
            "             ORDER BY r.started_at DESC LIMIT 1) AS last_run_state "
            "FROM conversations c WHERE c.workspace = ? ORDER BY c.created_at DESC", workspace)

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

    # ---- events ----------------------------------------------------------
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
