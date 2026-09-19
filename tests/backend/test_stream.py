import pytest
from uuid import UUID

from bioharness_web.stream import (
    event_stream,
    TaskVersion,
    build_invalidation,
    format_sse,
    stream_state_after_poll_error,
)


TASK_ID = UUID("00000000-0000-0000-0000-000000000101")


def test_stream_emits_task_updated_invalidation():
    previous = TaskVersion(id=TASK_ID, revision="old")
    current = TaskVersion(id=TASK_ID, revision="new")
    event = build_invalidation(previous, current)
    assert event.event == "task.updated"
    assert event.data == {
        "task_id": str(TASK_ID),
        "revision": "new",
    }


def test_database_poll_failure_emits_stale_state_without_crashing_stream():
    state = stream_state_after_poll_error(RuntimeError("db unavailable"))
    assert state.connected is True
    assert state.stale is True
    assert "db unavailable" in state.last_error


def test_sse_format_is_minimal_and_json_encoded():
    current = TaskVersion(id=TASK_ID, revision="new")
    event = build_invalidation(None, current)
    payload = format_sse(event)
    assert payload.startswith("event: task.updated\n")
    assert '"task_id":"' in payload
    assert payload.endswith("\n\n")


@pytest.mark.asyncio
async def test_event_stream_emits_update_when_task_record_revision_changes():
    class FakeVersionService:
        def __init__(self):
            self.calls = 0

        def list_task_versions(self):
            self.calls += 1
            revision = "old" if self.calls == 1 else "new"
            return {TASK_ID: revision}

    stream = event_stream(FakeVersionService(), poll_interval_seconds=0)
    try:
        first = await anext(stream)
        assert '"revision":"old"' in first
        second = await anext(stream)
        assert '"revision":"new"' in second
    finally:
        await stream.aclose()
