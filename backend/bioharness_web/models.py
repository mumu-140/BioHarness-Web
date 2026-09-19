from datetime import datetime
from enum import StrEnum
from uuid import UUID

from pydantic import BaseModel, ConfigDict


class TaskStatus(StrEnum):
    WAITING = "WAITING"
    RUNNING = "RUNNING"
    FINISHED = "FINISHED"
    FAILED = "FAILED"
    ATTENTION = "ATTENTION"


class TaskStage(StrEnum):
    TASK = "TASK"
    MEMORY = "MEMORY"
    DATA = "DATA"
    ASSESSMENT = "ASSESSMENT"
    PLANNING = "PLANNING"
    POLICY = "POLICY"
    EXECUTION = "EXECUTION"
    COLLECTION = "COLLECTION"
    VALIDATION = "VALIDATION"
    RESULT = "RESULT"


class TaskSummary(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: UUID
    title: str
    analysis_class: str
    status: TaskStatus
    stage: TaskStage
    updated_at: datetime
    needs_attention: bool


class NodeStatus(StrEnum):
    WAITING = "WAITING"
    ACTIVE = "ACTIVE"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    ATTENTION = "ATTENTION"
    UNKNOWN = "UNKNOWN"


class TaskNode(BaseModel):
    id: str
    type: TaskStage
    label: str
    status: NodeStatus
    annotation: str | None = None
    warning: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    detail_ref: str


class TaskEdge(BaseModel):
    source: str
    target: str


class TaskGraph(BaseModel):
    task: TaskSummary
    nodes: tuple[TaskNode, ...]
    edges: tuple[TaskEdge, ...]
    revision: str


class NodeDetail(BaseModel):
    node: TaskNode
    summary: dict
    events: tuple[dict, ...] = ()
    evidence_refs: tuple[str, ...] = ()
    links: tuple[str, ...] = ()
