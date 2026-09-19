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
