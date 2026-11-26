"""Read-only operational projections; no Core state is reconstructed here."""
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient

from bioharness_web.app import create_app
from bioharness_web.cli import ToolError
from bioharness_web.provider import ToolSpec
from bioharness_web.settings import ModelSettings
from conftest import TOKEN

AUTH = {"Authorization": f"Bearer {TOKEN}"}
KEY = "fixture-provider-key-not-real"


@pytest.fixture
def host(settings, tmp_path):
    settings = replace(settings, model=ModelSettings("http://127.0.0.1:1/v1", KEY, "fixture"),
                       ledger_path=tmp_path / "ledger.sqlite3",
                       mcp_servers={"memory": ("fixture-memory",), "broken": ("fixture-broken",)})
    with TestClient(create_app(settings)) as client:
        runtime = client.app.state.runtime
        conversation = runtime.ledger.create_conversation("pilot", "sci-fixture")
        yield client, runtime, conversation


def url(conversation):
    return f"/api/workspaces/pilot/conversations/{conversation['id']}"


def record(runtime, conversation, *, state="SUCCEEDED", output=None, name="recall"):
    ledger = runtime.ledger
    run = ledger.start_run(conversation["id"])
    operation = ledger.start_operation(run, "tool", name)
    runtime._emit(conversation["id"], run, "operation.started", {
        "operation_id": operation, "kind": "tool", "name": name, "server": "memory",
        "input": {"query": "fixture", "path": str(runtime.settings.workspaces["pilot"].path / "input.txt")}})
    if state != "STARTED":
        ledger.end_operation(operation, state)
        runtime._emit(conversation["id"], run, "operation.finished", {
            "operation_id": operation, "kind": "tool", "name": name,
            "state": state, "output": output if output is not None else {
                "structured_content": {"candidate": "m1", "use": "not recorded", "execution_verified": False}}})
        ledger.end_run(run, "FINISHED")
    return operation


def test_timeline_has_real_identity_bounded_payload_and_no_scientific_inference(host):
    client, runtime, conversation = host
    operation = record(runtime, conversation)
    result = client.get(url(conversation) + "/invocations", headers=AUTH)
    assert result.status_code == 200
    assert result.headers["cache-control"] == "no-store"
    page = result.json()
    assert page["service"] == runtime.settings.service_id
    assert page["workspace"] == "pilot" and page["request_id"] == "sci-fixture"
    assert page["authority"] == "web-observation"
    item = page["items"][0]
    assert item["id"] == operation and item["server"] == "memory"
    assert item["kind"] == "tool" and item["name"] == "recall" and item["state"] == "SUCCEEDED"
    assert item["started_at"] and item["ended_at"]
    assert item["input"]["path"] == "$WORKSPACE/input.txt"
    assert item["output"]["structured_content"] == {
        "candidate": "m1", "use": "not recorded", "execution_verified": False}
    assert "native_session" not in result.text and "scientific_verdict" not in result.text
    assert page["next_before"] is None


def test_pagination_does_not_join_other_operations_or_conversations(host):
    client, runtime, conversation = host
    first = record(runtime, conversation, state="FAILED", output={"error": "first"})
    other = runtime.ledger.create_conversation("pilot", "sci-other")
    record(runtime, other, output={"private": "other conversation"})
    second = record(runtime, conversation, state="UNKNOWN")
    third = record(runtime, conversation, state="STARTED")
    endpoint = url(conversation) + "/invocations"
    page = client.get(endpoint, params={"limit": 2}, headers=AUTH).json()
    assert [i["id"] for i in page["items"]] == [third, second]
    assert page["items"][0]["state"] == "STARTED" and page["items"][0]["ended_at"] is None
    assert page["items"][1]["state"] == "UNKNOWN"
    last = client.get(endpoint, params={"limit": 2, "before": page["next_before"]}, headers=AUTH).json()
    assert [i["id"] for i in last["items"]] == [first]
    assert last["items"][0]["output"] == {"error": "first"}
    assert last["next_before"] is None
    assert "other conversation" not in str(page) + str(last)


def test_projection_survives_restart_and_missing_start_event(host):
    client, runtime, conversation = host
    run = runtime.ledger.start_run(conversation["id"])
    operation = runtime.ledger.start_operation(run, "tool", "recall")
    runtime.ledger.recover()
    page = client.get(url(conversation) + "/invocations", headers=AUTH).json()
    item = page["items"][0]
    assert item["id"] == operation and item["state"] == "UNKNOWN"
    assert item["server"] is None and item["input"] is None and item["output"] is None


def test_oversized_record_and_credentials_are_not_reconstructed_or_leaked(host):
    client, runtime, conversation = host
    record(runtime, conversation, output={"blob": "x" * 100_000})
    workspace_path = str(runtime.settings.workspaces["pilot"].path)
    record(runtime, conversation, output={"key": KEY, TOKEN: "echoed as a key",
                                          workspace_path + "/key.txt": "path echoed as a key"})
    response = client.get(url(conversation) + "/invocations", headers=AUTH)
    assert KEY not in response.text and TOKEN not in response.text
    assert workspace_path not in response.text
    assert response.json()["items"][1]["output"]["omitted"] is True


def test_projection_routes_keep_existing_access_and_workspace_boundaries(host):
    client, runtime, conversation = host
    for route in ("/invocations", "/modules"):
        endpoint = url(conversation) + route
        assert client.get(endpoint).status_code == 401
        assert client.get(endpoint.replace("/pilot/", "/unknown/"), headers=AUTH).status_code == 404
        other = runtime.ledger.create_conversation("other", "sci-private")
        assert client.get(endpoint.replace(conversation["id"], other["id"]), headers=AUTH).status_code == 404
    for params in ({"limit": 0}, {"limit": 101}, {"before": 0},
                   {"before": "not-an-integer"}, {"before": 2**63}):
        assert client.get(url(conversation) + "/invocations", params=params, headers=AUTH).status_code == 422


async def test_module_discovery_is_observed_not_assumed_or_used(host, monkeypatch):
    client, runtime, conversation = host
    async def list_tools(argv, **kwargs):
        if argv[0] == "fixture-broken":
            raise ToolError("TOOL_UNAVAILABLE", "fixture unavailable")
        return [ToolSpec("recall", "fixture", {"type": "object"}),
                ToolSpec("science_plan", "conflict", {"type": "object"})]
    monkeypatch.setattr("bioharness_web.runtime.mcp_tools.list_tools", list_tools)
    endpoint = url(conversation) + "/modules"
    before = client.get(endpoint, headers=AUTH).json()
    assert {s["state"] for s in before["servers"]} == {"NOT_OBSERVED"}
    run = runtime.ledger.start_run(conversation["id"])
    specs = await runtime._module_specs(conversation["id"], run, runtime.settings.workspaces["pilot"])
    assert [s.name for s in specs] == ["recall"]
    result = client.get(endpoint, headers=AUTH).json()
    servers = {s["server"]: s for s in result["servers"]}
    assert servers["memory"]["state"] == "LISTED"
    assert servers["memory"]["tools"] == ["recall", "science_plan"]
    assert servers["memory"]["offered_tools"] == ["recall"]
    assert servers["memory"]["run_id"] == run and servers["memory"]["observed_at"]
    assert servers["broken"]["state"] == "UNAVAILABLE"
    assert servers["broken"]["error"]["code"] == "TOOL_UNAVAILABLE"
    assert client.get(url(conversation) + "/invocations", headers=AUTH).json()["items"] == []
    assert "fixture-memory" not in str(result)  # configured command is server-private
    # A later configuration must not pretend the old observation tested its new command.
    runtime.settings = replace(runtime.settings, mcp_servers={"new-server": ("new-command",)})
    assert client.get(endpoint, headers=AUTH).json()["servers"][0]["state"] == "NOT_OBSERVED"


def test_model_transport_metadata_is_retained_as_observation(host):
    client, runtime, conversation = host
    run = runtime.ledger.start_run(conversation["id"])
    operation = runtime.ledger.start_operation(run, "model", "fixture-model")
    runtime._emit(conversation["id"], run, "operation.finished", {
        "operation_id": operation, "state": "SUCCEEDED",
        "usage": {"input_tokens": 17}, "seconds": 0.25,
        "reported_model": "actual-provider-model", "finish_reason": "stop"})
    runtime.ledger.end_operation(operation, "SUCCEEDED")
    item = client.get(url(conversation) + "/invocations", headers=AUTH).json()["items"][0]
    assert item["details"] == {"usage": {"input_tokens": 17}, "seconds": 0.25,
                               "reported_model": "actual-provider-model", "finish_reason": "stop"}
