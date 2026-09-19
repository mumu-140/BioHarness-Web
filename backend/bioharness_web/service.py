from uuid import UUID

from .projection import (
    project_node_detail,
    project_task_graph,
    project_task_summaries,
)
from .repository import BioHarnessReadRepository


class ObservatoryService:
    def __init__(self, repository: BioHarnessReadRepository):
        self._repository = repository

    def list_tasks(self):
        return project_task_summaries(self._repository.list_task_records())

    def get_task_record(self, task_id: UUID):
        return self._repository.get_task_record(task_id)

    def get_task_graph(self, task_id: UUID):
        record = self.get_task_record(task_id)
        if record is None:
            return None
        return project_task_graph(record)

    def get_node_detail(self, task_id: UUID, node_id: str):
        record = self.get_task_record(task_id)
        if record is None:
            return None
        return project_node_detail(record, node_id)
