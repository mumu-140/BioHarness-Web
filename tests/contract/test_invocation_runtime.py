"""W3 backend projection over a real public Core and a fixture stdio Module."""
import json

from fastapi.testclient import TestClient

from bioharness_web.app import create_app
from bioharness_web.cli import ToolError
from test_runtime import AUTH, DELIVER, ECHO, PLAN, QUESTION, SUBMIT, Harness, Script, tool, pytestmark


def test_actual_module_discovery_and_structured_calls_survive_restart(tmp_path):
    script = Script(tool("structured", {}), tool("structured_error", {}),
                    tool("big_structured", {}), tool("science_plan", {"plan": PLAN}),
                    tool("science_submit", SUBMIT), tool("science_deliver", DELIVER),
                    {"text": "Delivered synthetic fixture."})
    with Harness(tmp_path, script, mcp_servers={"fixture": ECHO, "broken": ("/nonexistent/fixture",)}) as h:
        conversation = h.post(text=QUESTION).json()["conversation"]
        cid = conversation["id"]
        state = h.wait(cid)
        request_id = state["conversation"]["request_id"]
        assert h.now(request_id)["phase"] == "DELIVERED"
        endpoint = f"{h.url}/{cid}"
        response = h.client.get(endpoint + "/invocations", headers=AUTH)
        assert response.status_code == 200
        page = response.json()
        calls = [item for item in page["items"] if item["kind"] == "tool"]
        assert [(item["name"], item["state"]) for item in calls] == [
            ("big_structured", "SUCCEEDED"), ("structured_error", "FAILED"), ("structured", "SUCCEEDED")]
        assert all(item["server"] == "fixture" for item in calls)
        assert calls[0]["output"]["structured_content"]["omitted"] is True
        assert calls[1]["output"]["structured_content"] == {"error": "fixture failure"}
        assert calls[2]["output"]["structured_content"]["use"] == "not recorded"
        assert calls[2]["output"]["structured_content"]["execution_verified"] is False
        servers = {item["server"]: item for item in h.client.get(endpoint + "/modules", headers=AUTH).json()["servers"]}
        assert servers["fixture"]["state"] == "LISTED" and "structured" in servers["fixture"]["offered_tools"]
        assert servers["broken"]["state"] == "UNAVAILABLE"
        assert str(h.workspace) not in response.text
        assert state["conversation"].get("native_session") is None
        # Model receives the same owner-supplied fields, not only a text summary.
        returned = [json.loads(message["content"]) for request in h.provider.requests
                    for message in request["messages"] if message["role"] == "tool"]
        assert any(result.get("structured_content", {}).get("use") == "not recorded" for result in returned)
        settings = h.settings

    # No provider or Core call is needed to inspect a completed operation after restart.
    with TestClient(create_app(settings)) as client:
        after = client.get(endpoint + "/invocations", headers=AUTH).json()
        assert after == page
        assert {item["server"]: item for item in client.get(endpoint + "/modules", headers=AUTH).json()["servers"]} == servers


def test_unanswered_tool_remains_unknown_and_later_calls_are_not_executed(tmp_path, monkeypatch):
    called = []
    async def no_answer(argv, name, arguments, **kwargs):
        called.append(name)
        raise ToolError("TOOL_TIMEOUT", "fixture ambiguous response")
    monkeypatch.setattr("bioharness_web.runtime.mcp_tools.call_tool", no_answer)
    script = Script({"tool_calls": [
        {"name": "structured", "arguments": {}},
        {"name": "structured_error", "arguments": {}}]})
    with Harness(tmp_path, script, mcp_servers={"fixture": ECHO}, max_model_turns_per_run=1) as h:
        cid = h.post(text=QUESTION).json()["conversation"]["id"]
        h.wait(cid)
        page = h.client.get(f"{h.url}/{cid}/invocations", headers=AUTH).json()
        calls = [item for item in page["items"] if item["kind"] == "tool"]
        assert called == ["structured"]
        assert len(calls) == 1 and calls[0]["state"] == "UNKNOWN"
        assert calls[0]["output"] is None
        assert calls[0]["error"]["code"] == "TOOL_TIMEOUT"
