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


def _used_memory_refs(record: TaskRecord) -> tuple[str, ...]:
    seen: set[str] = set()
    refs: list[str] = []
    for context in record.contexts:
        for value in context.get("memory_refs", ()):
            ref = str(value)
            if ref not in seen:
                seen.add(ref)
                refs.append(ref)
    return tuple(refs)


def _execution_status(record: TaskRecord):
    from .models import NodeStatus

    latest = _latest_attempt(record)
    if latest is None:
        return NodeStatus.WAITING
    state = str(latest.get("state", ""))
    if state in {"SUBMITTING", "RUNNING", "COLLECTING"}:
        return NodeStatus.ACTIVE
    if state == "FINISHED":
        return NodeStatus.COMPLETED
    if state == "FAILED":
        return NodeStatus.FAILED
    if state in {"UNKNOWN", "NEEDS_OPERATOR_RECONCILIATION"}:
        return NodeStatus.ATTENTION
    return NodeStatus.UNKNOWN


def _validation_status(record: TaskRecord):
    from .models import NodeStatus

    if record.validation_evaluations:
        latest = record.validation_evaluations[-1]
        outcome = str(latest.get("outcome", ""))
        if outcome == "PASS":
            return NodeStatus.COMPLETED
        if outcome == "FAIL":
            return NodeStatus.FAILED
        if outcome in {"PASS_WITH_LIMITATIONS", "INCONCLUSIVE"}:
            return NodeStatus.ATTENTION
    if record.validation_reports:
        outcomes = {str(item.get("outcome", "")) for item in record.validation_reports}
        if "FAIL" in outcomes:
            return NodeStatus.FAILED
        if outcomes and outcomes <= {"PASS", "PASS_WITH_LIMITATIONS"}:
            return NodeStatus.COMPLETED
        return NodeStatus.ATTENTION
    return NodeStatus.WAITING


def _graph_revision(record: TaskRecord) -> str:
    import hashlib
    import json

    payload = {
        "task": record.task,
        "run_specs": record.run_specs,
        "attempts": record.attempts,
        "events": record.events,
        "artifacts": record.artifacts,
        "validation_reports": record.validation_reports,
        "validation_evaluations": record.validation_evaluations,
        "contexts": record.contexts,
    }
    encoded = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def project_task_graph(record: TaskRecord):
    from .models import NodeStatus, TaskEdge, TaskGraph, TaskNode

    summary = project_task_summary(record)
    task_id = str(summary.id)
    nodes: list[TaskNode] = []

    def add_node(
        *,
        node_id: str,
        stage: TaskStage,
        label: str,
        status: NodeStatus,
        attempt_number: int | None = None,
        attempt_count: int | None = None,
        attention_reason: str | None = None,
        started_at=None,
        finished_at=None,
    ) -> None:
        nodes.append(
            TaskNode(
                id=node_id,
                type=stage,
                label=label,
                status=status,
                attempt_number=attempt_number,
                attempt_count=attempt_count,
                attention_reason=attention_reason,
                started_at=started_at,
                finished_at=finished_at,
                detail_ref=f"/api/tasks/{task_id}/nodes/{node_id}",
            )
        )

    task_payload = _TaskPayload.model_validate(record.task)
    add_node(
        node_id="task",
        stage=TaskStage.TASK,
        label="Question",
        status=(
            NodeStatus.ATTENTION
            if task_payload.unresolved_fields
            else NodeStatus.COMPLETED
        ),
        started_at=task_payload.created_at,
    )

    if _used_memory_refs(record):
        add_node(
            node_id="memory",
            stage=TaskStage.MEMORY,
            label="Memory",
            status=NodeStatus.COMPLETED,
        )

    if record.data_refs:
        add_node(
            node_id="data",
            stage=TaskStage.DATA,
            label="Resolve data",
            status=NodeStatus.COMPLETED,
        )

    if record.assessments:
        assessment_status = str(record.assessments[-1].get("status", ""))
        add_node(
            node_id="assessment",
            stage=TaskStage.ASSESSMENT,
            label="Scientific assessment",
            status=(
                NodeStatus.COMPLETED
                if assessment_status in {"ANALYSIS_SUPPORTED", "SUPPORTED_WITH_LIMITATIONS"}
                else NodeStatus.ATTENTION
            ),
        )

    if record.run_specs or record.configurations:
        latest_spec = record.run_specs[-1] if record.run_specs else {}
        add_node(
            node_id="planning",
            stage=TaskStage.PLANNING,
            label="Plan",
            status=(
                NodeStatus.COMPLETED
                if latest_spec.get("executable", True)
                else NodeStatus.ATTENTION
            ),
        )

    if record.policy_decisions:
        outcomes = {str(item.get("outcome", "")) for item in record.policy_decisions}
        policy_status = NodeStatus.COMPLETED
        if "DENY" in outcomes:
            policy_status = NodeStatus.FAILED
        elif "REQUIRE_APPROVAL" in outcomes:
            policy_status = NodeStatus.ATTENTION
        add_node(
            node_id="policy",
            stage=TaskStage.POLICY,
            label="Authorization",
            status=policy_status,
        )

    latest = _latest_attempt(record)
    if latest is not None:
        execution_id = f"execution:{latest['id']}"
        submitted_at = _as_datetime(latest.get("submitted_at"))
        finished_at = None
        if latest.get("state") in {"FINISHED", "FAILED"}:
            finished_at = (
                _as_datetime(latest.get("last_reconciled_at"))
                or submitted_at
            )
        attempt_number = int(latest.get("attempt_number", len(record.attempts)))
        latest_state = str(latest.get("state", ""))
        attention_reason = None
        if latest_state == "NEEDS_OPERATOR_RECONCILIATION":
            attention_reason = "reconciliation_required"
        elif latest_state == "UNKNOWN":
            attention_reason = "execution_outcome_unknown"

        add_node(
            node_id=execution_id,
            stage=TaskStage.EXECUTION,
            label=str(latest.get("provider_attempt_name") or "Execution"),
            status=_execution_status(record),
            attempt_number=attempt_number,
            attempt_count=len(record.attempts),
            attention_reason=attention_reason,
            started_at=submitted_at,
            finished_at=finished_at,
        )

        if record.artifacts or latest.get("state") in {"COLLECTING", "FINISHED"}:
            collection_status = NodeStatus.WAITING
            if latest.get("state") == "COLLECTING":
                collection_status = NodeStatus.ACTIVE
            elif record.artifacts:
                collection_status = NodeStatus.COMPLETED
            elif latest.get("state") == "FAILED":
                collection_status = NodeStatus.FAILED
            add_node(
                node_id=f"collection:{latest['id']}",
                stage=TaskStage.COLLECTION,
                label="Artifacts",
                status=collection_status,
            )

    if record.validation_reports or record.validation_evaluations:
        validation_key = (
            str(record.validation_evaluations[-1].get("id"))
            if record.validation_evaluations
            else str(latest["id"] if latest else "task")
        )
        add_node(
            node_id=f"validation:{validation_key}",
            stage=TaskStage.VALIDATION,
            label="Validation",
            status=_validation_status(record),
        )

    edges = tuple(
        TaskEdge(source=left.id, target=right.id)
        for left, right in zip(nodes, nodes[1:])
    )
    return TaskGraph(
        task=summary,
        nodes=tuple(nodes),
        edges=edges,
        revision=_graph_revision(record),
    )


def _attempt_history(record: TaskRecord) -> list[dict]:
    return [
        {
            "id": str(item.get("id")),
            "attempt_number": int(item.get("attempt_number", 0)),
            "provider_attempt_name": item.get("provider_attempt_name"),
            "state": item.get("state"),
            "submitted_at": item.get("submitted_at"),
            "last_reconciled_at": item.get("last_reconciled_at"),
        }
        for item in sorted(
            record.attempts,
            key=lambda value: int(value.get("attempt_number", 0)),
        )
    ]


def project_node_detail(record: TaskRecord, node_id: str):
    from .models import NodeDetail, TaskStage

    graph = project_task_graph(record)
    node = next((item for item in graph.nodes if item.id == node_id), None)
    if node is None:
        raise KeyError(node_id)

    task_id = str(graph.task.id)
    links: list[str] = []
    events: tuple[dict, ...] = ()
    evidence_refs: list[str] = []

    if node.type == TaskStage.TASK:
        summary = {
            "question": record.task.get("question"),
            "requested_inference": record.task.get("requested_inference"),
            "analysis_class": record.task.get("analysis_class"),
            "output_intent": record.task.get("output_intent"),
            "unresolved_fields": list(record.task.get("unresolved_fields", ())),
        }
    elif node.type == TaskStage.MEMORY:
        used_refs = list(_used_memory_refs(record))
        used_lookup = set(used_refs)
        candidates = []
        for candidate in record.memory_candidates:
            candidate_id = str(candidate.get("id", ""))
            used = (
                candidate_id in used_lookup
                or f"memory:{candidate_id}" in used_lookup
            )
            if not used:
                continue
            candidates.append(
                {
                    "id": candidate_id,
                    "kind": candidate.get("kind"),
                    "statement": candidate.get("statement"),
                    "status": candidate.get("status"),
                    "used": True,
                }
            )
            evidence_refs.extend(
                str(value)
                for value in candidate.get("evidence_refs", ())
            )
        summary = {
            "used_refs": used_refs,
            "available_candidates": candidates,
        }
        links.append(f"/api/tasks/{task_id}/memory")
    elif node.type == TaskStage.DATA:
        summary = {
            "resolved_data": [
                {
                    "id": str(item.get("id")),
                    "provider": item.get("provider"),
                    "provider_revision": item.get("provider_revision"),
                    "logical_uri": item.get("logical_uri"),
                    "manifest_sha256": item.get("manifest_sha256"),
                    "member_manifest_sha256": item.get("member_manifest_sha256"),
                }
                for item in record.data_refs
            ]
        }
    elif node.type == TaskStage.ASSESSMENT:
        summary = {"assessments": list(record.assessments)}
    elif node.type == TaskStage.PLANNING:
        summary = {
            "run_specs": list(record.run_specs),
            "configurations": list(record.configurations),
        }
    elif node.type == TaskStage.POLICY:
        summary = {"decisions": list(record.policy_decisions)}
    elif node.type == TaskStage.EXECUTION:
        history = _attempt_history(record)
        summary = {
            "current_attempt": history[-1] if history else None,
            "attempt_history": history,
            "capability_snapshot": (
                _latest_attempt(record) or {}
            ).get("capability_snapshot", {}),
            "observed_runtime_environment": (
                _latest_attempt(record) or {}
            ).get("observed_runtime_environment", {}),
        }
        events = tuple(record.events[-50:])
        links.append(f"/api/tasks/{task_id}/events")
    elif node.type == TaskStage.COLLECTION:
        summary = {
            "artifacts": [
                {
                    "id": str(item.get("id")),
                    "role": item.get("role"),
                    "content_sha256": item.get("content_sha256"),
                    "size_bytes": item.get("size_bytes"),
                    "uri": item.get("uri"),
                }
                for item in record.artifacts
            ]
        }
        evidence_refs.extend(
            str(item.get("uri"))
            for item in record.artifacts
            if item.get("uri")
        )
        links.append(f"/api/tasks/{task_id}/artifacts")
    elif node.type == TaskStage.VALIDATION:
        summary = {
            "reports": list(record.validation_reports),
            "evaluations": list(record.validation_evaluations),
        }
        for report in record.validation_reports:
            evidence_refs.extend(
                str(value) for value in report.get("evidence_refs", ())
            )
        links.append(f"/api/tasks/{task_id}/validation")
    else:
        summary = {}

    return NodeDetail(
        node=node,
        summary=summary,
        events=events,
        evidence_refs=tuple(dict.fromkeys(evidence_refs)),
        links=tuple(links),
    )
