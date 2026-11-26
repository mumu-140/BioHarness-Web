"""Fault injection at public transport boundaries, not real concurrent-host acceptance."""
import json
import shutil
import stat
import subprocess
import sys
from types import SimpleNamespace

import pytest

from bioharness_web.cli import ToolError
from bioharness_web.runtime import Runtime
from test_runtime import AUTH, DELIVER, PLAN, QUESTION, SUBMIT, Harness, Script, finished, operations, tool, pytestmark


def test_accepted_submission_with_lost_reply_is_not_repeated(tmp_path):
    wrapper = tmp_path / "lost-reply-host"
    count = tmp_path / "submit-calls.txt"
    wrapper.write_text(
        f"#!{sys.executable}\n"
        "import os, subprocess, sys\n"
        f"real = {shutil.which('bioharness-host')!r}\n"
        "if 'call' in sys.argv and 'science_submit' in sys.argv:\n"
        f"    with open({str(count)!r}, 'a') as log: log.write('submit\\n')\n"
        "    done = subprocess.run([real, *sys.argv[1:]], input=sys.stdin.buffer.read(), capture_output=True)\n"
        "    sys.stdout.buffer.write(done.stdout[:5])  # actual Core ran; only the reply was lost\n"
        "    raise SystemExit(done.returncode)\n"
        "os.execv(real, [real, *sys.argv[1:]])\n", encoding="utf-8")
    wrapper.chmod(wrapper.stat().st_mode | stat.S_IXUSR)
    batch = {"tool_calls": [{"name": "science_submit", "arguments": SUBMIT},
                             {"name": "science_deliver", "arguments": DELIVER}]}
    script = Script(tool("science_plan", {"plan": PLAN}), batch,
                    tool("science_deliver", DELIVER), {"text": "Delivered synthetic fixture."})
    with Harness(tmp_path, script, core_cli=str(wrapper)) as h:
        cid = h.post(text=QUESTION, scope={"id": "fixture-project", "create": True}).json()["conversation"]["id"]
        state = h.wait(cid)
        rid = state["conversation"]["request_id"]
        assert h.now(rid)["phase"] == "DELIVERED"
        events = h.events(cid)
        calls = operations(events, "core")
        assert calls.count(("science_submit", "UNKNOWN")) == 1
        assert calls.count(("science_deliver", "SUCCEEDED")) == 1
        assert count.read_text().splitlines() == ["submit"]
        refresh = calls.index(("science_submit", "UNKNOWN")) + 1
        assert calls[refresh] == ("science_now", "SUCCEEDED")
        replies = [json.loads(m["content"]) for m in h.provider.requests[2]["messages"] if m["role"] == "tool"]
        result = next(reply for reply in replies if "core_now" in reply)
        assert result["core_now"]["progress"]["done"] == 1
        skipped = next(reply for reply in replies if "Not called" in reply.get("host_error", ""))
        assert "Not called" in skipped["host_error"]
        routes = subprocess.run(["bioharness-governance", f"--workspace={h.workspace}",
                                 "routes", "--scope-id", "fixture-project"],
                                capture_output=True, text=True, check=True)
        assert json.loads(routes.stdout)["attempt_count"] == 1


@pytest.mark.parametrize("failure", ["transport", "refusal"])
def test_refused_write_cannot_continue_when_core_refresh_fails(tmp_path, monkeypatch, failure):
    with Harness(tmp_path, Script(tool("science_plan", {"plan": PLAN}), {"text": "Must not run."}),
                 max_model_turns_per_run=2) as h:
        runtime = h.client.app.state.runtime
        real_call = runtime.core.call
        refused = False
        async def conflict(workspace, name, arguments):
            nonlocal refused
            if name == "science_plan":
                refused = True
                return {"ok": False, "error": {"code": "STATE_CHANGED", "message": "injected conflict"}}
            if name == "science_now" and refused:
                if failure == "transport":
                    raise ToolError("TOOL_TIMEOUT", "injected failed refresh")
                return {"ok": False, "error": {"code": "READ_FAILED", "message": "injected refusal"}}
            return await real_call(workspace, name, arguments)
        monkeypatch.setattr(runtime.core, "call", conflict)
        cid = h.post(text=QUESTION).json()["conversation"]["id"]
        h.wait(cid)
        assert len(h.provider.requests) == 1
        end = finished(h.events(cid))[-1]
        assert end["state"] == "INTERRUPTED" and "could not be refreshed" in end["reason"]


def test_state_changed_refreshes_before_a_new_model_decision(tmp_path, monkeypatch):
    first = {"tool_calls": [{"name": "science_plan", "arguments": {"plan": PLAN}},
                            {"name": "science_submit", "arguments": SUBMIT}]}
    with Harness(tmp_path, Script(first, tool("science_plan", {"plan": PLAN})),
                 max_model_turns_per_run=2) as h:
        runtime = h.client.app.state.runtime
        real_call = runtime.core.call
        injected = False
        async def conflict(workspace, name, arguments):
            nonlocal injected
            if name == "science_plan" and not injected:
                injected = True
                return {"ok": False, "error": {"code": "STATE_CHANGED", "message": "injected conflict"}}
            return await real_call(workspace, name, arguments)
        monkeypatch.setattr(runtime.core, "call", conflict)
        cid = h.post(text=QUESTION).json()["conversation"]["id"]
        h.wait(cid)
        calls = operations(h.events(cid), "core")
        assert calls == [("science_begin", "SUCCEEDED"), ("science_plan", "REFUSED"),
                         ("science_now", "SUCCEEDED"), ("science_plan", "SUCCEEDED")]
        refreshed = h.provider.requests[1]
        assert "NEEDS_PLAN" in refreshed["messages"][0]["content"]
        assert any("STATE_CHANGED" in m["content"] for m in refreshed["messages"] if m["role"] == "tool")


@pytest.mark.parametrize("ending", [{"finish_reason": "length"}, {"disconnect_before_finish": True}])
def test_incomplete_model_response_does_not_mutate_core(tmp_path, ending):
    reply = {**tool("science_plan", {"plan": PLAN}), **ending}
    with Harness(tmp_path, Script(reply), max_model_turns_per_run=1) as h:
        cid = h.post(text=QUESTION).json()["conversation"]["id"]
        state = h.wait(cid)
        assert operations(h.events(cid), "core") == [("science_begin", "SUCCEEDED")]
        assert finished(h.events(cid))[-1]["state"] == "FAILED"
        assert h.now(state["conversation"]["request_id"])["phase"] == "NEEDS_PLAN"


def test_context_omission_does_not_recommend_replaying_side_effects():
    host = SimpleNamespace(settings=SimpleNamespace(model_context_chars=1024))
    history = [{"role": "tool", "id": "call-1", "name": "science_submit",
                "result": {"host_error": "outcome unknown", "large": "x" * 5000}}]
    Runtime._fit(host, history, 0)
    omitted = history[0]["result"]
    assert omitted["omitted_by_host"] is True
    assert "call the tool again" not in omitted["note"]
    assert "side effects" in omitted["note"] and "read-only" in omitted["note"]


def test_in_stream_api_error_never_dispatches_its_tool_calls(tmp_path):
    reply = {**tool("science_plan", {"plan": PLAN}),
             "stream_error": {"message": "fixture internal error", "type": "fixture_unknown"}}
    with Harness(tmp_path, Script(reply), max_model_turns_per_run=1) as h:
        cid = h.post(text=QUESTION).json()["conversation"]["id"]
        state = h.wait(cid)
        events = h.events(cid)
        assert operations(events, "core") == [("science_begin", "SUCCEEDED")]
        end = finished(events)[-1]
        assert end["state"] == "FAILED" and "PROVIDER_RESPONSE_ERROR" in end["reason"]
        assert h.now(state["conversation"]["request_id"])["phase"] == "NEEDS_PLAN"
