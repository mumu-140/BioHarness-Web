import json
from uuid import UUID, uuid4

from fastapi.testclient import TestClient

from bioharness_web.app import create_app
from bioharness_web.models import TaskStage, TaskStatus, TaskSummary


TASK_ID = UUID("00000000-0000-0000-0000-000000000101")


class FakeService:
    def list_tasks(self):
        return (
            TaskSummary(
                id=TASK_ID,
                title="Genome-web TF reference",
                analysis_class="tf_family_phylogeny_reference",
                status=TaskStatus.RUNNING,
                stage=TaskStage.EXECUTION,
                updated_at="2026-09-19T02:00:00Z",
                needs_attention=False,
            ),
        )

    def get_task_graph(self, task_id):
        if task_id != TASK_ID:
            return None
        return {
            "task": self.list_tasks()[0].model_dump(mode="json"),
            "nodes": [],
            "edges": [],
            "revision": "abc",
        }

    def get_node_detail(self, task_id, node_id):
        return None

    def get_events(self, task_id):
        return () if task_id == TASK_ID else None

    def get_artifacts(self, task_id):
        return () if task_id == TASK_ID else None

    def get_validation(self, task_id):
        return {"reports": [], "evaluations": []} if task_id == TASK_ID else None

    def get_memory(self, task_id):
        return {"used_refs": [], "available_candidates": []} if task_id == TASK_ID else None


def client():
    return TestClient(create_app(service=FakeService(), poll_interval_seconds=1.0))


def test_tasks_endpoint_returns_projection():
    response = client().get("/api/tasks")
    assert response.status_code == 200
    assert response.json()[0]["stage"] == "EXECUTION"


def test_unknown_task_is_404():
    response = client().get(f"/api/tasks/{uuid4()}/graph")
    assert response.status_code == 404


def test_health_never_leaks_database_url():
    body = client().get("/api/health").json()
    assert "database_url" not in body
    assert "password" not in json.dumps(body).lower()
    assert body["status"] == "ok"
