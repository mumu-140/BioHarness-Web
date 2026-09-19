import asyncio
import hashlib
import json
from datetime import datetime, timezone
from uuid import UUID

from pydantic import BaseModel

from .models import TaskSummary


class TaskVersion(BaseModel):
    id: UUID
    revision: str


class SseEvent(BaseModel):
    event: str
    data: dict


class StreamState(BaseModel):
    connected: bool
    stale: bool
    last_error: str | None = None


def build_invalidation(
    previous: TaskVersion | None,
    current: TaskVersion,
) -> SseEvent:
    return SseEvent(
        event="task.updated",
        data={
            "task_id": str(current.id),
            "revision": current.revision,
        },
    )


def stream_state_after_poll_error(error: Exception) -> StreamState:
    return StreamState(
        connected=True,
        stale=True,
        last_error=str(error),
    )


def format_sse(event: SseEvent) -> str:
    payload = json.dumps(
        event.data,
        separators=(",", ":"),
        sort_keys=True,
    )
    return f"event: {event.event}\ndata: {payload}\n\n"


def _summary_revision(summary: TaskSummary) -> str:
    payload = json.dumps(
        summary.model_dump(mode="json"),
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def task_versions(summaries) -> dict[UUID, TaskVersion]:
    return {
        summary.id: TaskVersion(
            id=summary.id,
            revision=_summary_revision(summary),
        )
        for summary in summaries
    }


async def event_stream(service, poll_interval_seconds: float):
    previous: dict[UUID, TaskVersion] = {}
    stale = False

    while True:
        try:
            summaries = await asyncio.to_thread(service.list_tasks)
            current = task_versions(summaries)

            for task_id, version in current.items():
                prior = previous.get(task_id)
                if prior is None or prior.revision != version.revision:
                    yield format_sse(build_invalidation(prior, version))

            for task_id in previous.keys() - current.keys():
                yield format_sse(
                    SseEvent(
                        event="task.removed",
                        data={"task_id": str(task_id)},
                    )
                )

            if stale:
                yield format_sse(
                    SseEvent(
                        event="observatory.connected",
                        data={
                            "stale": False,
                            "at": datetime.now(timezone.utc).isoformat(),
                        },
                    )
                )
            previous = current
            stale = False
        except asyncio.CancelledError:
            raise
        except Exception as error:
            if not stale:
                yield format_sse(
                    SseEvent(
                        event="observatory.stale",
                        data={
                            "stale": True,
                            "at": datetime.now(timezone.utc).isoformat(),
                            "reason": str(error),
                        },
                    )
                )
            stale = True

        await asyncio.sleep(poll_interval_seconds)
