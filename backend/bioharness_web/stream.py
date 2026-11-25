"""Tell a connected browser that a watched view may have changed.

The server polls the owners' public queries; a `version` event carries the
opaque content identity of the snapshot it just observed. The browser compares
that with the snapshot it holds and refetches when they differ, so a duplicate,
late or repeated event is harmless and a reconnect resynchronises by itself.
An event is a notification only: scientific state always comes from a snapshot.

Project Governance reads are cheap and polled every interval. science_now
re-checks recent evidence files on every call, so Core views are polled less often.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, AsyncIterator, Sequence

from .cli import ToolError
from .sources import CORE, VIEWS, Sources

log = logging.getLogger(__name__)

CORE_POLL_EVERY = 3  # Core views are read on every third governance poll


def format_sse(event: str, data: dict) -> str:
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return f"event: {event}\ndata: {payload}\n\n"


async def version_stream(
    sources: Sources,
    workspace_id: str,
    watches: Sequence[tuple[str, dict[str, Any]]],
    interval: float,
) -> AsyncIterator[str]:
    seen: dict[int, str] = {}
    unreachable: set[int] = set()
    tick = 0
    while True:
        for index, (view, selector) in enumerate(watches):
            every = CORE_POLL_EVERY if VIEWS[view][0] == CORE else 1
            if tick % every:
                continue
            where = {"workspace": workspace_id, "view": view, "selector": selector}
            try:
                snapshot = await sources.get(workspace_id, view, selector, max_age=interval / 2)
            except Exception as error:  # one failing read must not end the stream
                code = error.code if isinstance(error, ToolError) else "INTERNAL_ERROR"
                if not isinstance(error, ToolError):
                    log.exception("unexpected failure while polling %s", view)
                if index not in unreachable:
                    unreachable.add(index)
                    yield format_sse("source.stale", {**where, "code": code})
                continue
            version = snapshot["content_sha256"]
            if seen.get(index) != version or index in unreachable:
                seen[index] = version
                unreachable.discard(index)
                yield format_sse("version", {**where, "content_sha256": version,
                                             "observed_at": snapshot["observed_at"]})
        yield ": keep-alive\n\n"  # lets the server notice a closed connection
        tick += 1
        await asyncio.sleep(interval)
