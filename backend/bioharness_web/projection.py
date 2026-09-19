from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from .models import TaskStage, TaskStatus, TaskSummary
from .repository import TaskRecord


_ACTIVE_ATTEMPT_STATES = {"SUBMITTING", "RUNNING", "COLLECTING"}
_ATTENTION_ATTEMPT_STATES = {"UNKNOWN", "NEEDS_OPERATOR_RECONCILIATION"}


class _TaskPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: UUID
    question: str = Field(min_length=1)
    analysis_class: str = "unknown"
    unresolved_fields: tuple[str, ...] = ()
    created_at: datetime


def _as_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    return None


def _latest_attempt(record: TaskRecord) -> dict[str, Any] | None:
    if not record.attempts:
        return None
    return max(
        record.attempts,
        key=lambda item: (
            int(item.get("attempt_number", 0)),
            _as_datetime(item.get("submitted_at"))
            or datetime.min.replace(tzinfo=timezone.utc),
        ),
    )


def _task_stage(record: TaskRecord) -> TaskStage:
    if record.validation_evaluations or record.validation_reports:
        return TaskStage.VALIDATION
    if record.artifacts:
        return TaskStage.COLLECTION
    if record.attempts:
        latest = _latest_attempt(record)
        if latest and latest.get("state") == "COLLECTING":
            return TaskStage.COLLECTION
        return TaskStage.EXECUTION
    if record.run_specs or record.configurations:
        return TaskStage.PLANNING
    if record.assessments:
        return TaskStage.ASSESSMENT
    if record.data_refs:
        return TaskStage.DATA
    return TaskStage.TASK


def _task_status(task: _TaskPayload, record: TaskRecord) -> TaskStatus:
    if task.unresolved_fields:
        return TaskStatus.ATTENTION

    latest = _latest_attempt(record)
    if latest is None:
        return TaskStatus.WAITING

    state = str(latest.get("state", ""))
    if state in _ATTENTION_ATTEMPT_STATES:
        return TaskStatus.ATTENTION
    if state in _ACTIVE_ATTEMPT_STATES:
        return TaskStatus.RUNNING
    if state == "FINISHED":
        return TaskStatus.FINISHED
    if state == "FAILED":
        return TaskStatus.FAILED
    return TaskStatus.ATTENTION


def _updated_at(task: _TaskPayload, record: TaskRecord) -> datetime:
    candidates = [task.created_at]
    for collection, keys in (
        (record.run_specs, ("created_at",)),
        (record.attempts, ("last_reconciled_at", "submitted_at")),
        (record.artifacts, ("registered_at",)),
        (record.validation_reports, ("created_at",)),
        (record.validation_evaluations, ("evaluated_at",)),
    ):
        for item in collection:
            for key in keys:
                value = _as_datetime(item.get(key))
                if value is not None:
                    candidates.append(value)
    return max(candidates)


def project_task_summary(record: TaskRecord) -> TaskSummary:
    task = _TaskPayload.model_validate(record.task)
    status = _task_status(task, record)
    return TaskSummary(
        id=task.id,
        title=task.question,
        analysis_class=task.analysis_class,
        status=status,
        stage=_task_stage(record),
        updated_at=_updated_at(task, record),
        needs_attention=status in {TaskStatus.ATTENTION, TaskStatus.FAILED},
    )


def project_task_summaries(records: tuple[TaskRecord, ...]) -> tuple[TaskSummary, ...]:
    priority = {
        TaskStatus.ATTENTION: 0,
        TaskStatus.FAILED: 0,
        TaskStatus.RUNNING: 1,
        TaskStatus.WAITING: 2,
        TaskStatus.FINISHED: 3,
    }
    summaries = tuple(project_task_summary(record) for record in records)
    return tuple(
        sorted(
            summaries,
            key=lambda item: (
                priority[item.status],
                -item.updated_at.timestamp(),
                str(item.id),
            ),
        )
    )
