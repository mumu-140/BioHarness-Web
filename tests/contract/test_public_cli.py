"""Contract tests against the installed public Core and Project Governance CLIs.

A synthetic workspace is built only through the public calls an Agent host uses
(science_begin / science_plan / science_submit). The Web application then reads
it through its own adapter. These tests fail if a public response no longer has
the shape the read side relies on. Skipped where the CLIs are not installed.
"""
import hashlib
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from bioharness_web.app import create_app
from bioharness_web.settings import Settings, Workspace

from conftest import TOKEN
from synthetic_workspace import QUESTION, TABLE, build, core

pytestmark = pytest.mark.skipif(
    not (shutil.which("bioharness-host") and shutil.which("bioharness-governance")),
    reason="public BioHarness CLIs are not installed")
AUTH = {"Authorization": f"Bearer {TOKEN}"}


def state_files(workspace: Path) -> dict[str, str]:
    return {str(p.relative_to(workspace)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(workspace.rglob("*")) if p.is_file()}


@pytest.fixture(scope="module")
def project(tmp_path_factory):
    ids = build(tmp_path_factory.mktemp("contract") / "ws")
    workspace = Path(ids["workspace"])
    settings = Settings(
        service_id="contract", access_token=TOKEN,
        workspaces={"pilot": Workspace("pilot", workspace, (workspace,))})
    return {**ids, "workspace": workspace, "client": TestClient(create_app(settings)),
            "table_sha256": hashlib.sha256(TABLE.encode()).hexdigest()}


def view(project, name, **selector):
    response = project["client"].get(f"/api/workspaces/pilot/views/{name}",
                                     params=selector, headers=AUTH)
    assert response.status_code == 200, response.text
    return response.json()


def test_now_exposes_the_plan_and_core_computed_progress(project):
    snapshot = view(project, "now", request_id=project["request_id"])
    assert snapshot["ok"] is True and snapshot["source"]["owner"] == "core"
    data = snapshot["data"]
    assert data["request_id"] == project["request_id"]
    assert data["question"] == QUESTION  # verbatim original question
    assert data["phase"] == "WORK" and data["action"] == "DO_STEP"
    assert isinstance(data["instruction"], str) and data["call"]["tool"] == "science_submit"
    steps = {s["id"]: s for s in data["plan"]["steps"]}
    assert steps["compare"]["depends_on"] == ["inputs"]
    assert steps["compare"]["serves"] == ["R1", "R2"]
    assert set(data["mainline"]["requirements"]) == {"R1", "R2"}
    progress = {s["id"]: s for s in data["progress"]["steps"]}
    assert progress["inputs"]["status"] == "DONE" and progress["compare"]["status"] == "PENDING"
    assert set(progress["inputs"]) == {"id", "kind", "status", "attempts", "review"}
    assert data["step"]["id"] == "compare"  # Core, not Web, chose the next step


def test_open_listing_names_every_open_request_and_picks_none(project):
    snapshot = view(project, "open")
    assert snapshot["ok"] is True
    listed = {r["request_id"]: r for r in snapshot["data"]["open_requests"]}
    assert set(listed) == {project["request_id"], project["branch_id"], project["unscoped_id"]}
    assert "scope_id" not in listed[project["unscoped_id"]]  # stays unscoped
    assert listed[project["branch_id"]]["scope_id"] == "fixture-branch"
    assert listed[project["branch_id"]]["project_id"] == "fixture-project"


def test_unknown_request_is_a_core_refusal_with_a_code(project):
    snapshot = view(project, "now", request_id="sci-00000000-nope")
    assert snapshot["ok"] is False
    assert snapshot["error"]["origin"] == "core" and snapshot["error"]["code"]


def test_tree_has_scopes_parents_requests_and_explicit_relations(project):
    snapshot = view(project, "tree")
    data = snapshot["data"]
    assert snapshot["source_version"] == {"view_sha256": data["view_sha256"]}
    nodes = {n["scope_id"]: n for n in data["nodes"]}
    assert set(nodes) == {"fixture-project", "fixture-branch"}
    assert nodes["fixture-branch"]["parent_scope_id"] == "fixture-project"
    assert nodes["fixture-branch"]["path"] == ["fixture-project", "fixture-branch"]
    assert nodes["fixture-project"]["requests"][0]["request_id"] == project["request_id"]
    assert {"revision", "request_status", "scope_id"} <= set(nodes["fixture-project"]["requests"][0])
    assert data["related_requests"] == [{
        "source_request_id": project["branch_id"], "target_request_id": project["request_id"],
        "type": "RELATED", "target_available": True}]
    members = {r["request_id"] for n in data["nodes"] for r in n["requests"]}
    assert project["unscoped_id"] not in members  # never silently assigned to a project
    assert isinstance(data["goal_version_changes"], list)
    assert isinstance(data["shared_evidence"], list)


def test_tree_reports_the_binding_of_an_exact_unscoped_request(project):
    data = view(project, "tree", request_id=project["unscoped_id"])["data"]
    assert data["request_binding"]["request_id"] == project["unscoped_id"]
    assert data["request_binding"]["scope_id"] is None


def test_context_verifies_membership_and_refuses_the_wrong_scope(project):
    ok = view(project, "context", scope_id="fixture-project", request_id=project["request_id"])
    assert ok["ok"] is True
    assert ok["data"]["selected_request"]["request_id"] == project["request_id"]
    assert ok["source_version"] == {"shared_sha256": ok["data"]["shared_sha256"]}
    wrong = view(project, "context", scope_id="fixture-branch", request_id=project["request_id"])
    assert wrong["ok"] is False and wrong["error"]["origin"] == "project-governance"


def test_routes_and_evidence_preview_follow_the_exact_recorded_anchor(project):
    routes = view(project, "routes", scope_id="fixture-project", include_descendants=True)
    attempt = routes["data"]["attempts"][0]
    assert attempt["step_id"] == "inputs" and attempt["submission_status"] == "DONE"
    assert attempt["execution_verified"] is False
    reference = attempt["evidence"][0]
    assert reference["source"] == "$WORKSPACE/inputs.tsv"  # no server path reaches the browser
    assert reference["sha256"] == project["table_sha256"]
    anchor = {k: reference[k] for k in ("request_id", "submission_index", "evidence_id", "sha256")}

    recorded = view(project, "evidence", **anchor)
    assert recorded["data"]["recorded_reference"] == "MATCH"
    assert recorded["data"]["snapshot_integrity"] == "MATCH"

    client = project["client"]
    preview = client.get("/api/workspaces/pilot/evidence-preview", params=anchor, headers=AUTH)
    body = preview.json()
    assert body["ok"] is True
    assert body["preview"]["content"] == TABLE
    assert body["preview"]["current_file_identity"] == "MATCHES_RECORD"
    assert str(project["workspace"]) not in preview.text

    wrong = client.get("/api/workspaces/pilot/evidence-preview",
                       params={**anchor, "sha256": "0" * 64}, headers=AUTH).json()
    assert wrong["ok"] is False and "preview" not in wrong


def test_reads_do_not_change_the_workspace(project):
    before = state_files(project["workspace"])
    for _ in range(2):
        view(project, "open")
        view(project, "now", request_id=project["request_id"])
        view(project, "tree")
        view(project, "tree", project_id="fixture-project", request_id=project["unscoped_id"])
        view(project, "context", scope_id="fixture-project")
        view(project, "routes", scope_id="fixture-project", include_related=True)
    assert state_files(project["workspace"]) == before


def test_a_workspace_without_core_state_is_left_untouched(tmp_path):
    empty = (tmp_path / "empty").resolve()
    empty.mkdir()
    settings = Settings(service_id="contract", access_token=TOKEN,
                        workspaces={"pilot": Workspace("pilot", empty, (empty,))})
    client = TestClient(create_app(settings))
    listing = client.get("/api/workspaces/pilot/views/open", headers=AUTH).json()
    assert listing["data"]["core_state_present"] is False
    tree = client.get("/api/workspaces/pilot/views/tree", headers=AUTH).json()
    assert tree["source"]["owner"] == "project-governance"  # whatever it answers, it wrote nothing
    assert list(empty.iterdir()) == []


def client_for(workspace: Path) -> TestClient:
    settings = Settings(service_id="contract", access_token=TOKEN,
                        workspaces={"pilot": Workspace("pilot", workspace, (workspace,))})
    return TestClient(create_app(settings))


def test_a_single_scoped_open_request_is_listed_with_the_scope_core_reports(tmp_path):
    workspace = (tmp_path / "single").resolve()
    workspace.mkdir()
    begun = core(workspace, "science_begin", {
        "question": "Fixture question: is a single open request listed with its scope?",
        "scope": {"id": "solo-project", "create": True}})
    listing = client_for(workspace).get("/api/workspaces/pilot/views/open", headers=AUTH).json()
    assert listing["data"]["open_requests"] == [{
        "request_id": begun["request_id"],
        "question": "Fixture question: is a single open request listed with its scope?",
        "scope_id": "solo-project", "project_id": "solo-project"}]


def test_two_projects_are_offered_for_an_explicit_choice(tmp_path):
    workspace = (tmp_path / "two").resolve()
    workspace.mkdir()
    for name in ("alpha", "beta"):
        core(workspace, "science_begin", {"question": f"Fixture question for project {name}?",
                                          "scope": {"id": f"project-{name}", "create": True}})
    client = client_for(workspace)
    overview = client.get("/api/workspaces/pilot/views/tree", headers=AUTH).json()["data"]
    assert overview["nodes"] == [] and "project_id" not in overview  # Governance picks none
    assert [p["scope_id"] for p in overview["projects"]] == ["project-alpha", "project-beta"]
    chosen = client.get("/api/workspaces/pilot/views/tree", params={"project_id": "project-beta"},
                        headers=AUTH).json()["data"]
    assert chosen["project_id"] == "project-beta"
    assert [n["scope_id"] for n in chosen["nodes"]] == ["project-beta"]


def test_a_partial_core_state_directory_is_not_completed_by_a_read(tmp_path):
    workspace = (tmp_path / "partial").resolve()
    (workspace / ".bioharness" / "requests").mkdir(parents=True)
    client = client_for(workspace)
    listing = client.get("/api/workspaces/pilot/views/open", headers=AUTH).json()
    assert listing["data"]["core_state_present"] is False
    assert sorted(p.name for p in (workspace / ".bioharness").iterdir()) == ["requests"]
