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

    def get_evidence_preview(self, task_id, evidence_id):
        if task_id != TASK_ID:
            return None
        if evidence_id != "evidence-1":
            raise KeyError(evidence_id)
        return {
            "id": evidence_id,
            "role": "execution_log",
            "name": "nextflow.log",
            "format": "text",
            "size_bytes": 12,
            "truncated": False,
            "content": "hello world\n",
        }

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


def test_static_index_is_served_when_directory_is_configured(tmp_path):
    index = tmp_path / "index.html"
    index.write_text(
        "<html><body>BioHarness Observatory UI</body></html>",
        encoding="utf-8",
    )
    app = create_app(
        service=FakeService(),
        poll_interval_seconds=1.0,
        static_dir=tmp_path,
    )
    response = TestClient(app).get("/")
    assert response.status_code == 200
    assert "BioHarness Observatory UI" in response.text


def test_evidence_preview_endpoint_is_read_only_and_id_scoped():
    response = client().get(f"/api/tasks/{TASK_ID}/evidence/evidence-1")
    assert response.status_code == 200
    assert response.json()["role"] == "execution_log"
    assert response.json()["content"] == "hello world\n"


def test_unknown_evidence_id_is_404():
    response = client().get(f"/api/tasks/{TASK_ID}/evidence/not-registered")
    assert response.status_code == 404
