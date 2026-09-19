from uuid import UUID

from .projection import (
    project_node_detail,
    project_task_graph,
    project_task_summaries,
    project_task_summary,
)
from .repository import BioHarnessReadRepository


class ObservatoryService:
    def __init__(self, repository: BioHarnessReadRepository, evidence_previewer=None):
        self._repository = repository
        self._evidence_previewer = evidence_previewer

    def list_tasks(self):
        return project_task_summaries(self._repository.list_task_records())

    def list_task_versions(self):
        records = self._repository.list_task_records()
        return {
            UUID(str(record.task["id"])): project_task_graph(record).revision
            for record in records
        }

    def get_task_record(self, task_id: UUID):
        return self._repository.get_task_record(task_id)

    def get_task_summary(self, task_id: UUID):
        record = self.get_task_record(task_id)
        return None if record is None else project_task_summary(record)

    def get_task_graph(self, task_id: UUID):
        record = self.get_task_record(task_id)
        if record is None:
            return None
        return project_task_graph(record)

    def get_node_detail(self, task_id: UUID, node_id: str):
        record = self.get_task_record(task_id)
        if record is None:
            return None
        detail = project_node_detail(record, node_id)
        if self._evidence_previewer is None:
            return detail
        return detail.model_copy(
            update={
                "evidence_previews": self._evidence_previewer.references(
                    record, task_id
                )
            }
        )

    def get_evidence_preview(self, task_id: UUID, evidence_id: str):
        record = self.get_task_record(task_id)
        if record is None:
            return None
        if self._evidence_previewer is None:
            raise KeyError(evidence_id)
        return self._evidence_previewer.preview(record, evidence_id)

    def get_events(self, task_id: UUID):
        record = self.get_task_record(task_id)
        return None if record is None else record.events

    def get_artifacts(self, task_id: UUID):
        record = self.get_task_record(task_id)
        return None if record is None else record.artifacts

    def get_validation(self, task_id: UUID):
        record = self.get_task_record(task_id)
        if record is None:
            return None
        return {
            "reports": record.validation_reports,
            "evaluations": record.validation_evaluations,
        }

    def get_memory(self, task_id: UUID):
        record = self.get_task_record(task_id)
        if record is None:
            return None

        used_refs = []
        seen = set()
        for context in record.contexts:
            for value in context.get("memory_refs", ()):
                ref = str(value)
                if ref not in seen:
                    seen.add(ref)
                    used_refs.append(ref)

        candidates = []
        for item in record.memory_candidates:
            candidate_id = str(item.get("id", ""))
            candidates.append(
                {
                    "id": candidate_id,
                    "kind": item.get("kind"),
                    "statement": item.get("statement"),
                    "status": item.get("status"),
                    "used": (
                        candidate_id in seen
                        or f"memory:{candidate_id}" in seen
                    ),
                }
            )

        return {
            "used_refs": used_refs,
            "available_candidates": candidates,
        }
