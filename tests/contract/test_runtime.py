"""The native runtime against the installed public Core CLI.

The model is a script behind a local OpenAI-compatible endpoint, so every other
part is real: the provider adapter, the run loop, the Core calls and hooks, the
ledger and the HTTP API. Workspaces are synthetic and temporary.
"""
import json
import shutil
import stat
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from bioharness_web.app import create_app
from bioharness_web.settings import ModelSettings, Settings, Workspace

from conftest import TOKEN
from support.fake_openai import FakeOpenAI
from synthetic_workspace import core

pytestmark = pytest.mark.skipif(
    not (shutil.which("bioharness-host") and shutil.which("bioharness-governance")),
    reason="public BioHarness CLIs are not installed")
AUTH = {"Authorization": f"Bearer {TOKEN}"}
KEY = "sk-test-not-a-real-key"
QUESTION = "Fixture question: explain what a count table is."
PLAN = {"question_type": "EXPLAIN", "objective": "Explain what a count table is.",
        "requirements": ["Explain a count table"],
        "steps": [{"id": "survey", "kind": "KNOWLEDGE", "objective": "Summarise what a count table is.",
                   "serves": ["R1"], "why": "answers R1", "deliverable": "summary"}]}
SUBMIT = {"step_id": "survey", "status": "DONE", "summary": "A count table holds counts per feature and sample (fixture).",
          "evidence": [{"text": "A count table lists read counts per gene and sample (synthetic fixture text).",
                        "source": "fixture"}]}
DELIVER = {"kind": "FINAL", "answer": "A count table lists counts per feature and sample (fixture answer).",
           "limitations": ["synthetic fixture, no real source consulted"]}


def tool(name, arguments):
    return {"tool_calls": [{"name": name, "arguments": arguments}]}


class Script:
    """Answers in order; once they run out, a plain sentence."""

    def __init__(self, *answers):
        self.answers = list(answers)

    def __call__(self, messages, tools):
        return self.answers.pop(0) if self.answers else {"text": "Nothing further (fixture)."}


class Harness:
    def __init__(self, tmp_path: Path, script, **overrides):
        self.workspace = (tmp_path / "ws").resolve()
        self.workspace.mkdir(exist_ok=True)
        self.provider = FakeOpenAI(script)
        self.tmp_path, self.overrides = tmp_path, overrides

    def __enter__(self):
        self.provider.__enter__()
        self.settings = Settings(
            service_id="runtime-test", access_token=TOKEN,
            workspaces={"pilot": Workspace("pilot", self.workspace, (self.workspace,))},
            model=ModelSettings(base_url=self.provider.base_url, api_key=KEY, name="fake-model"),
            ledger_path=self.tmp_path / "ledger.sqlite3", **self.overrides)
        self._client = TestClient(create_app(self.settings))
        self.client = self._client.__enter__()
        return self

    def __exit__(self, *exc):
        self._client.__exit__(*exc)
        self.provider.__exit__(*exc)

    url = "/api/workspaces/pilot/conversations"

    def post(self, path="", **body):
        return self.client.post(self.url + path, json=body, headers=AUTH)

    def conversation(self, conversation_id):
        return self.client.get(f"{self.url}/{conversation_id}", headers=AUTH).json()

    def wait(self, conversation_id, seconds=60):
        deadline = time.time() + seconds
        while time.time() < deadline:
            state = self.conversation(conversation_id)
            if state["active_run"] is None:
                return state
            time.sleep(0.1)
        raise AssertionError("the run did not end in time")

    def events(self, conversation_id):
        return self.client.app.state.runtime.ledger.events(conversation_id)

    def now(self, request_id):
        return core(self.workspace, "science_now", {"request_id": request_id})


def finished(events):
    return [e["data"] for e in events if e["type"] == "run.finished"]


def operations(events, kind=None):
    return [(e["data"]["name"], e["data"]["state"]) for e in events
            if e["type"] == "operation.finished" and (kind is None or e["data"]["kind"] == kind)]


# ---- the whole Core cycle ------------------------------------------------------
def test_a_question_goes_through_core_from_intake_to_delivery(tmp_path):
    script = Script(tool("science_plan", {"plan": PLAN}),
                    tool("science_submit", {**SUBMIT, "request_id": "sci-00000000-other"}),
                    tool("science_deliver", DELIVER),
                    {"text": "Delivered: a count table lists counts per feature and sample."})
    with Harness(tmp_path, script) as h:
        created = h.post(text=QUESTION)
        assert created.status_code == 201
        conversation_id = created.json()["conversation"]["id"]
        state = h.wait(conversation_id)
        request_id = state["conversation"]["request_id"]
        events = h.events(conversation_id)

        # Core holds the user's words verbatim and reports the request delivered
        now = h.now(request_id)
        assert now["question"] == QUESTION and now["phase"] == "DELIVERED"
        assert now["answer"] == DELIVER["answer"]

        assert finished(events) == [{"state": "FINISHED", "reason": "the turn ended"}]
        # the closing science_now is the host asking Core whether the turn may really end
        assert operations(events, "core") == [
            ("science_begin", "SUCCEEDED"), ("science_plan", "SUCCEEDED"),
            ("science_submit", "SUCCEEDED"), ("science_deliver", "SUCCEEDED"), ("science_now", "SUCCEEDED")]
        assert [e["data"]["initiator"] for e in events
                if e["type"] == "operation.started" and e["data"]["kind"] == "core"] == [
            "host", "model", "model", "model", "host"]
        assert [e["data"]["text"] for e in events if e["type"] == "user.message"] == [QUESTION]
        assert [e["data"]["text"] for e in events if e["type"] == "assistant.text"] == [
            "Delivered: a count table lists counts per feature and sample."]
        # Core, asked through its stop hook, let the turn end once the request was delivered
        assert operations(events, "hook") == [("stop", "SUCCEEDED")]

        # the model named another request for the submission; the conversation's own was used
        submitted = [e["data"]["input"] for e in events
                     if e["type"] == "operation.started" and e["data"]["name"] == "science_submit"]
        assert submitted[0]["request_id"] == request_id
        assert any(e["type"] == "notice" and "sci-00000000-other" in e["data"]["text"] for e in events)

        # what the model was given: Core's tools and Core's state, no server path, no credential
        first = h.provider.requests[0]
        assert [t["function"]["name"] for t in first["tools"]] == [
            "science_now", "science_plan", "science_submit", "science_deliver"]
        system = first["messages"][0]["content"]
        assert "NEEDS_PLAN" in system and "Research rules of BioHarness Core" in system
        assert first["messages"][1] == {"role": "user", "content": QUESTION}
        sent = json.dumps(h.provider.requests)
        assert str(h.workspace) not in sent and KEY not in sent and TOKEN not in sent
        stored = json.dumps(events)
        assert KEY not in stored and TOKEN not in stored

        # nothing the browser can read names the session Core's hooks see
        listing = h.client.get(h.url, headers=AUTH)
        assert "native_session" not in listing.text and "native_session" not in json.dumps(state)
        assert listing.json()[0]["last_run_state"] == "FINISHED"


def test_a_core_refusal_is_shown_to_the_model_and_nothing_is_invented(tmp_path):
    script = Script(tool("science_plan", {"plan": {"objective": "no steps"}}),
                    tool("science_plan", {"plan": PLAN}))
    with Harness(tmp_path, script) as h:
        conversation_id = h.post(text=QUESTION).json()["conversation"]["id"]
        state = h.wait(conversation_id)
        events = h.events(conversation_id)
        # after a refusal the host reads Core again, so the next turn never works from a stale state
        assert operations(events, "core")[:4] == [
            ("science_begin", "SUCCEEDED"), ("science_plan", "REFUSED"),
            ("science_now", "SUCCEEDED"), ("science_plan", "SUCCEEDED")]
        refusal = json.loads(h.provider.requests[1]["messages"][-1]["content"])
        assert refusal["ok"] is False and refusal["error"]["code"] == "PLAN_INVALID"
        assert h.now(state["conversation"]["request_id"])["phase"] == "WORK"


def test_later_calls_of_a_turn_are_not_carried_out_after_a_refusal(tmp_path):
    both = {"tool_calls": [{"name": "science_plan", "arguments": {"plan": {"objective": "no steps"}}},
                           {"name": "science_submit", "arguments": SUBMIT}]}
    with Harness(tmp_path, Script(both, tool("science_plan", {"plan": PLAN}))) as h:
        conversation_id = h.post(text=QUESTION).json()["conversation"]["id"]
        h.wait(conversation_id)
        events = h.events(conversation_id)
        assert ("science_submit", "SUCCEEDED") not in operations(events, "core")
        assert ("science_submit", "REFUSED") not in operations(events, "core")  # it was never sent to Core
        results = [json.loads(m["content"]) for m in h.provider.requests[1]["messages"] if m["role"] == "tool"]
        assert results[0]["error"]["code"] == "PLAN_INVALID"
        assert results[1]["host_error"].startswith("Not called: an earlier call of this turn was refused")


# ---- mainline amendment: only the user's own exact message confirms ------------
def test_only_the_users_own_message_confirms_a_mainline_amendment(tmp_path):
    amendment = {"objective": "Explain what a count table is and how it is normalised.", "reason": "fixture"}
    script = Script(tool("science_plan", {"plan": PLAN}),
                    tool("science_plan", {"plan": PLAN, "mainline_amendment": amendment}),
                    {"text": "I propose a change. 确认主线 A1"})  # the model writing the phrase confirms nothing
    with Harness(tmp_path, script) as h:
        conversation_id = h.post(text=QUESTION).json()["conversation"]["id"]
        request_id = h.wait(conversation_id)["conversation"]["request_id"]
        assert h.now(request_id)["mainline_amendment_pending"]["id"] == "A1"
        assert h.now(request_id)["mainline"]["version"] == 1

        # a user message that only contains the phrase is not a confirmation either
        assert h.post(f"/{conversation_id}/runs", text="I think 确认主线 A1 would be fine").status_code == 202
        h.wait(conversation_id)
        assert h.now(request_id)["mainline"]["version"] == 1

        # a different conversation of the same user is not bound to this request
        other = h.post(text="Fixture question: an unrelated one.").json()["conversation"]["id"]
        h.wait(other)
        assert h.post(f"/{other}/runs", text="确认主线 A1").status_code == 202
        h.wait(other)
        assert h.now(request_id)["mainline"]["version"] == 1

        # the user's own exact message in the bound conversation: Core applies it
        before = len(h.provider.requests)
        assert h.post(f"/{conversation_id}/runs", text="确认主线 A1").status_code == 202
        h.wait(conversation_id)
        now = h.now(request_id)
        assert now["mainline"]["version"] == 2 and now["mainline"]["purpose"] == amendment["objective"]
        assert "mainline_amendment_pending" not in now
        # and the model is shown Core's new state, which asks for a plan revision
        assert "REVISE_PLAN" in h.provider.requests[before]["messages"][0]["content"]
        assert operations(h.events(conversation_id), "hook").count(("prompt", "SUCCEEDED")) == 2


# ---- waiting for the user -------------------------------------------------------
def test_a_question_for_the_user_ends_the_turn_and_the_reply_continues_the_same_request(tmp_path):
    ask = {"kind": "QUESTION_FOR_USER", "question_for_user": "Which organism is the table from? (fixture)"}
    script = Script(tool("science_plan", {"plan": PLAN}), tool("science_deliver", ask),
                    {"text": "I need one detail from you: which organism? (fixture)"})
    with Harness(tmp_path, script) as h:
        conversation_id = h.post(text=QUESTION).json()["conversation"]["id"]
        request_id = h.wait(conversation_id)["conversation"]["request_id"]
        events = h.events(conversation_id)
        # Core released the turn: the run ended normally and nothing pressed the model on
        assert finished(events) == [{"state": "FINISHED", "reason": "the turn ended"}]
        assert [e for e in events if e["type"] == "notice"] == []
        waiting = h.now(request_id)
        assert waiting["action"] == "WAIT_FOR_USER" and waiting["phase"] != "DELIVERED"

        h.provider.script = Script(tool("science_submit", SUBMIT))
        before = len(h.provider.requests)
        assert h.post(f"/{conversation_id}/runs", text="Arabidopsis (fixture reply)").status_code == 202
        h.wait(conversation_id)
        # the model saw the user's reply and Core's waiting state, then worked on the same request
        resumed = h.provider.requests[before]
        assert {"role": "user", "content": "Arabidopsis (fixture reply)"} in resumed["messages"]
        # what Core said about the user's message reaches the model marked as a host notice
        assert resumed["messages"][-1]["content"].startswith(
            "[Notice from the BioHarness host, not from the user]\nBioHarness Core, on the user's message:")
        assert "WAIT_FOR_USER" in resumed["messages"][0]["content"]
        now = h.now(request_id)
        assert now["action"] != "WAIT_FOR_USER" and now["progress"]["done"] == 1


# ---- continuing an existing request ---------------------------------------------
def test_an_existing_request_is_continued_only_by_its_explicit_id(tmp_path):
    with Harness(tmp_path, Script(tool("science_plan", {"plan": PLAN}))) as h:
        begun = core(h.workspace, "science_begin", {"question": QUESTION})
        assert h.post(request_id="sci-00000000-nope").status_code == 422
        created = h.post(request_id=begun["request_id"])
        assert created.status_code == 201 and created.json()["run_id"] is None
        conversation_id = created.json()["conversation"]["id"]
        assert h.post(f"/{conversation_id}/runs").status_code == 202  # resume, no user message
        h.wait(conversation_id)
        events = h.events(conversation_id)
        assert [e for e in events if e["type"] == "user.message"] == []
        assert operations(events, "core")[:2] == [("science_now", "SUCCEEDED"), ("science_plan", "SUCCEEDED")]
        assert h.now(begun["request_id"])["phase"] == "WORK"
        # the request of a conversation is never re-pointed
        again = h.client.put(f"{h.url}/{conversation_id}/request", json={"request_id": begun["request_id"]},
                             headers=AUTH)
        assert again.status_code == 409 and again.json()["detail"]["code"] == "REQUEST_ALREADY_SET"


# ---- technical failures leave Core recoverable ------------------------------------
def test_a_provider_failure_ends_the_run_and_the_request_stays_open(tmp_path):
    with Harness(tmp_path, lambda messages, tools: {"status": 503}) as h:
        conversation_id = h.post(text=QUESTION).json()["conversation"]["id"]
        state = h.wait(conversation_id)
        events = h.events(conversation_id)
        assert finished(events)[0]["state"] == "FAILED"
        assert "PROVIDER_HTTP_ERROR" in finished(events)[0]["reason"]
        assert h.now(state["conversation"]["request_id"])["phase"] == "NEEDS_PLAN"
        h.provider.script = Script(tool("science_plan", {"plan": PLAN}))
        assert h.post(f"/{conversation_id}/runs").status_code == 202
        h.wait(conversation_id)
        assert h.now(state["conversation"]["request_id"])["phase"] == "WORK"


def test_a_second_run_cannot_start_while_one_is_in_progress(tmp_path):
    slow = lambda messages, tools: {"text": "slow answer " * 40, "delay": 0.05}
    with Harness(tmp_path, slow) as h:
        conversation_id = h.post(text=QUESTION).json()["conversation"]["id"]
        second = h.post(f"/{conversation_id}/runs", text="again")
        assert second.status_code == 409 and second.json()["detail"]["code"] == "RUN_ACTIVE"
        deadline = time.time() + 30
        while not h.provider.requests and time.time() < deadline:  # until the model is being asked
            time.sleep(0.05)
        run_id = h.conversation(conversation_id)["active_run"]["id"]
        cancel = h.client.post(f"{h.url}/{conversation_id}/runs/{run_id}/cancel", headers=AUTH)
        assert cancel.status_code == 202 and cancel.json() == {"cancel": "REQUESTED"}
        state = h.wait(conversation_id)
        events = h.events(conversation_id)
        types = [e["type"] for e in events]
        assert types.index("run.cancel_requested") < types.index("run.finished")
        assert finished(events) == [{"state": "CANCELLED", "reason": "cancelled at the user's request"}]
        # a request closed at the user's wish is not a provider failure
        assert ("fake-model", "CANCELLED") in operations(events, "model")
        assert h.client.app.state.runtime.ledger.run(run_id)["cancel_requested"] == 1
        again = h.client.post(f"{h.url}/{conversation_id}/runs/{run_id}/cancel", headers=AUTH)
        assert again.status_code == 409 and again.json()["detail"]["code"] == "RUN_NOT_ACTIVE"
        # cancelling the run changed nothing in Core
        assert h.now(state["conversation"]["request_id"])["phase"] == "NEEDS_PLAN"
        assert [e for e in events if e["type"] == "user.message"][0]["data"]["text"] == QUESTION


def test_a_model_that_never_acts_stops_at_the_technical_limit(tmp_path):
    chatter = lambda messages, tools: tool("science_now", {})
    with Harness(tmp_path, chatter, max_model_turns_per_run=3) as h:
        conversation_id = h.post(text=QUESTION).json()["conversation"]["id"]
        state = h.wait(conversation_id)
        events = h.events(conversation_id)
        assert finished(events) == [{"state": "INTERRUPTED", "reason": "technical turn limit reached"}]
        assert len(h.provider.requests) == 3
        assert h.now(state["conversation"]["request_id"])["phase"] == "NEEDS_PLAN"


# ---- an answer that never arrives ------------------------------------------------
def slow_begin_cli(tmp_path: Path) -> str:
    """A stand-in command that lets Core open the request and then never answers."""
    script = tmp_path / "slow-host"
    script.write_text(
        f"#!{sys.executable}\n"
        "import subprocess, sys, time\n"
        f"real = {shutil.which('bioharness-host')!r}\n"
        "if 'science_begin' in sys.argv:\n"
        "    subprocess.run([real, *sys.argv[1:]], stdin=sys.stdin, capture_output=True)\n"
        "    time.sleep(120)\n"
        "raise SystemExit(subprocess.run([real, *sys.argv[1:]], stdin=sys.stdin).returncode)\n")
    script.chmod(script.stat().st_mode | stat.S_IXUSR)
    return str(script)


def test_an_unanswered_science_begin_is_never_repeated_and_is_reconciled_by_the_user(tmp_path):
    script = Script(tool("science_plan", {"plan": PLAN}))
    with Harness(tmp_path, script, core_cli=slow_begin_cli(tmp_path), core_call_timeout_seconds=3) as h:
        conversation_id = h.post(text=QUESTION).json()["conversation"]["id"]
        state = h.wait(conversation_id)
        events = h.events(conversation_id)
        assert operations(events, "core") == [("science_begin", "UNKNOWN")]
        assert finished(events)[0]["state"] == "INTERRUPTED"
        assert h.provider.requests == []  # the model was never asked
        assert state["conversation"]["request_id"] is None and state["begin_reconcile"] == "OUTCOME_UNKNOWN"

        # Core did open a request; the host does not adopt it, it offers it
        candidates = state["begin_candidates"]
        assert len(candidates) == 1 and candidates[0]["question_match"] == "EXACT"
        blocked = h.post(f"/{conversation_id}/runs", text=QUESTION)
        assert blocked.status_code == 409 and blocked.json()["detail"]["code"] == "BEGIN_OUTCOME_UNKNOWN"
        listed = core(h.workspace, "science_now", {})  # exactly one open request: no duplicate was begun
        assert listed["request_id"] == candidates[0]["request_id"]

        attached = h.client.put(f"{h.url}/{conversation_id}/request",
                                json={"request_id": candidates[0]["request_id"]}, headers=AUTH)
        assert attached.status_code == 200
        assert h.post(f"/{conversation_id}/runs").status_code == 202
        h.wait(conversation_id)
        assert h.now(candidates[0]["request_id"])["phase"] == "WORK"


# ---- restart ---------------------------------------------------------------------
def test_after_a_restart_unfinished_work_is_unknown_and_the_request_resumes_from_core(tmp_path):
    slow = lambda messages, tools: {"text": "slow " * 200, "delay": 0.05}
    with Harness(tmp_path, slow) as h:
        conversation_id = h.post(text=QUESTION).json()["conversation"]["id"]
        deadline = time.time() + 20
        while not h.provider.requests and time.time() < deadline:
            time.sleep(0.05)
        request_id = h.conversation(conversation_id)["conversation"]["request_id"]
        assert request_id
    # What a killed process leaves behind (an orderly stop above already closed its run):
    # a run and an operation still marked as in flight.
    from bioharness_web.ledger import Ledger
    ledger = Ledger(tmp_path / "ledger.sqlite3")
    ledger._db.execute("UPDATE runs SET state = 'RUNNING', ended_at = NULL")
    run_id = ledger.active_run(conversation_id)["id"]
    operation_id = ledger.start_operation(run_id, "core", "science_submit")
    ledger.close()
    with Harness(tmp_path, Script(tool("science_plan", {"plan": PLAN}))) as h:
        state = h.conversation(conversation_id)
        assert state["active_run"] is None and state["conversation"]["request_id"] == request_id
        events = h.events(conversation_id)
        unknown = [e["data"] for e in events if e["type"] == "operation.finished"
                   and e["data"]["operation_id"] == operation_id]
        assert unknown[0]["state"] == "UNKNOWN" and unknown[0]["name"] == "science_submit"
        assert finished(events)[-1] == {"state": "INTERRUPTED", "reason": "service restarted"}
        before = len(events)
        assert h.post(f"/{conversation_id}/runs").status_code == 202
        h.wait(conversation_id)
        resumed = h.events(conversation_id)[before:]
        # the resumed run starts by reading Core; it does not repeat the unknown submission
        assert operations(resumed, "core")[:2] == [("science_now", "SUCCEEDED"), ("science_plan", "SUCCEEDED")]
        assert ("science_submit", "SUCCEEDED") not in operations(resumed, "core")
        assert h.now(request_id)["phase"] == "WORK"


# ---- a configured module tool ----------------------------------------------------
def test_a_configured_mcp_tool_is_offered_and_called_and_nothing_else_is(tmp_path):
    script = Script(tool("governance_tree", {}),
                    tool("run_shell", {"command": "ls /"}),
                    tool("science_plan", {"plan": PLAN}))
    servers = {"governance": ("bioharness-governance", "--workspace={workspace}", "mcp")}
    with Harness(tmp_path, script, mcp_servers=servers) as h:
        conversation_id = h.post(text=QUESTION, scope={"id": "fixture-project", "create": True}).json()[
            "conversation"]["id"]
        h.wait(conversation_id)
        events = h.events(conversation_id)
        offered = [t["function"]["name"] for t in h.provider.requests[0]["tools"]]
        assert offered == ["science_now", "science_plan", "science_submit", "science_deliver",
                           "governance_tree", "governance_context", "governance_routes", "governance_evidence"]
        assert operations(events, "tool") == [("governance_tree", "SUCCEEDED")]
        shown = json.loads(h.provider.requests[1]["messages"][-1]["content"])
        assert shown["is_error"] is False and '"fixture-project"' in shown["text"]
        assert json.loads(h.provider.requests[2]["messages"][-1]["content"]) == {
            "host_error": "'run_shell' is not an available tool."}
        assert any(e["type"] == "notice" and "run_shell" in e["data"]["text"] for e in events)
        # the scope the user chose reached Core's intake
        tree = core(h.workspace, "science_now", {})["scope_context"]
        assert tree["scope_id"] == "fixture-project"


ECHO = (sys.executable, str(Path(__file__).resolve().parent.parent / "support" / "echo_mcp.py"))


def test_module_tool_paths_stay_inside_the_workspace_and_results_are_bounded(tmp_path):
    def echo(path):
        return tool("echo_path", {"path": path, "note": "free text with / a slash and .. dots is not a path"})
    script = Script(echo("/etc/passwd"), echo("link/secret.txt"), echo("~/secret.txt"),
                    echo(".bioharness/requests/x.json"), echo("../outside.txt"),
                    echo("$WORKSPACE/notes.txt"), echo("notes.txt"), tool("big", {}),
                    tool("science_plan", {"plan": PLAN}))
    with Harness(tmp_path, script, mcp_servers={"echo": ECHO}, max_model_turns_per_run=12) as h:
        (h.workspace / "notes.txt").write_text("fixture", encoding="utf-8")
        outside = tmp_path / "elsewhere"
        outside.mkdir()
        (outside / "secret.txt").write_text("secret", encoding="utf-8")
        (h.workspace / "link").symlink_to(outside)
        conversation_id = h.post(text=QUESTION).json()["conversation"]["id"]
        h.wait(conversation_id)
        events = h.events(conversation_id)
        refused = [e for e in events if e["type"] == "notice" and e["data"].get("code") == "PATH_NOT_PERMITTED"]
        assert len(refused) == 5
        called = [e["data"] for e in events if e["type"] == "operation.finished" and e["data"]["kind"] == "tool"]
        assert [c["name"] for c in called] == ["echo_path", "echo_path", "big"]
        # the label was made a real path for the tool, and the tool ran in the workspace
        results = [json.loads(m["content"]) for m in h.provider.requests[-1]["messages"] if m["role"] == "tool"]
        first = json.loads(results[5]["text"])
        assert first["given"]["path"] == "$WORKSPACE/notes.txt" and first["cwd"] == "$WORKSPACE"
        assert json.loads(results[6]["text"])["given"]["path"] == "notes.txt"
        big = results[7]
        assert len(big["text"]) == 60_000 and big["truncated_characters"] == 140_000


def test_reading_another_request_does_not_move_the_conversation_to_it(tmp_path):
    with Harness(tmp_path, Script()) as h:
        other = core(h.workspace, "science_begin", {"question": "Fixture question: another open request."})
        h.provider.script = Script(tool("science_now", {"request_id": other["request_id"]}),
                                   {"text": "I looked at the other request (fixture)."},
                                   tool("science_plan", {"plan": PLAN}))
        conversation_id = h.post(text=QUESTION).json()["conversation"]["id"]
        request_id = h.wait(conversation_id)["conversation"]["request_id"]
        assert request_id != other["request_id"]
        # the model was shown the other request ...
        shown = json.loads(h.provider.requests[1]["messages"][-1]["content"])
        assert shown["request_id"] == other["request_id"]
        # ... but when it then stopped, Core spoke about this conversation's own request:
        # the session was not moved to the request that was only read
        pressed = [e["data"]["text"] for e in h.events(conversation_id)
                   if e["type"] == "notice" and e["data"]["source"] == "core"][0]
        assert request_id in pressed and other["request_id"] not in pressed
        assert h.now(request_id)["phase"] == "WORK" and h.now(other["request_id"])["phase"] == "NEEDS_PLAN"


def test_snapshots_of_the_read_side_are_refreshed_after_the_runtime_changed_core(tmp_path):
    with Harness(tmp_path, Script(tool("science_plan", {"plan": PLAN}))) as h:
        sources = h.client.app.state.runtime.sources
        sources._cache[("pilot", "tree", "{}")] = (time.monotonic() + 3600, {"stale": True})
        sources._cache[("elsewhere", "tree", "{}")] = (time.monotonic() + 3600, {"stale": True})
        conversation_id = h.post(text=QUESTION).json()["conversation"]["id"]
        h.wait(conversation_id)
        assert ("pilot", "tree", "{}") not in sources._cache
        assert ("elsewhere", "tree", "{}") in sources._cache  # only the workspace that changed


# ---- science_begin that opens nothing new ----------------------------------------
def test_a_refused_begin_is_shown_as_refused_and_the_question_can_be_sent_again(tmp_path):
    with Harness(tmp_path, Script(tool("science_plan", {"plan": PLAN}))) as h:
        created = h.post(text=QUESTION, scope={"id": "branch", "create": True, "parent_id": "no-such-parent"})
        conversation_id = created.json()["conversation"]["id"]
        state = h.wait(conversation_id)
        events = h.events(conversation_id)
        assert operations(events, "core") == [("science_begin", "REFUSED")]
        notice = [e["data"] for e in events if e["type"] == "notice"][0]
        assert notice["code"] == "BEGIN_REFUSED" and "no unique origin" in notice["text"]
        assert state["begin_reconcile"] is None and state["conversation"]["request_id"] is None
        assert h.provider.requests == []
        # nothing was created, so the same conversation takes the question again
        assert h.post(f"/{conversation_id}/runs", text=QUESTION).status_code == 202
        state = h.wait(conversation_id)
        assert h.now(state["conversation"]["request_id"])["phase"] == "WORK"


def test_an_existing_request_returned_by_core_is_not_adopted_without_the_users_choice(tmp_path):
    with Harness(tmp_path, Script(tool("science_plan", {"plan": PLAN}))) as h:
        existing = core(h.workspace, "science_begin", {"question": QUESTION})  # begun by another host
        conversation_id = h.post(text=QUESTION).json()["conversation"]["id"]
        state = h.wait(conversation_id)
        events = h.events(conversation_id)
        assert finished(events)[0]["state"] == "INTERRUPTED"
        assert [e["data"]["code"] for e in events if e["type"] == "notice"] == ["BEGIN_RETURNED_EXISTING_REQUEST"]
        assert h.provider.requests == [] and state["conversation"]["request_id"] is None
        assert state["begin_reconcile"] == "EXISTING_REQUEST"
        assert [c["request_id"] for c in state["begin_candidates"]] == [existing["request_id"]]
        refused = h.post(f"/{conversation_id}/runs", text=QUESTION)
        assert refused.status_code == 409 and refused.json()["detail"]["code"] == "BEGIN_RETURNED_EXISTING_REQUEST"
        attached = h.client.put(f"{h.url}/{conversation_id}/request",
                                json={"request_id": existing["request_id"]}, headers=AUTH)
        assert attached.status_code == 200
        assert h.post(f"/{conversation_id}/runs").status_code == 202
        h.wait(conversation_id)
        assert h.now(existing["request_id"])["phase"] == "WORK"


def test_an_unavailable_tool_server_is_named_and_the_run_goes_on(tmp_path):
    servers = {"broken": ("/nonexistent/module-server", "mcp")}
    with Harness(tmp_path, Script(tool("science_plan", {"plan": PLAN})), mcp_servers=servers) as h:
        conversation_id = h.post(text=QUESTION).json()["conversation"]["id"]
        state = h.wait(conversation_id)
        events = h.events(conversation_id)
        assert any(e["type"] == "notice" and e["data"].get("code") == "MODULE_SERVER_UNAVAILABLE"
                   and "'broken'" in e["data"]["text"] for e in events)
        assert len(h.provider.requests[0]["tools"]) == 4
        assert h.now(state["conversation"]["request_id"])["phase"] == "WORK"


# ---- paths a model proposes ------------------------------------------------------
def test_evidence_paths_are_expanded_from_labels_and_kept_inside_the_configured_directories(tmp_path):
    def submit(path):
        return tool("science_submit", {"step_id": "survey", "status": "DONE",
                                       "summary": "See $WORKSPACE/notes.txt (label inside prose stays).",
                                       "evidence": [{"path": path}]})
    script = Script(tool("science_plan", {"plan": PLAN}),
                    submit("$WORKSPACE/.bioharness/requests/secret.json"),
                    submit("$WORKSPACE/../outside.txt"),
                    submit("$WORKSPACE/notes.txt"))
    with Harness(tmp_path, script) as h:
        (h.workspace / "notes.txt").write_text("A count table lists counts (fixture).", encoding="utf-8")
        (tmp_path / "outside.txt").write_text("outside", encoding="utf-8")
        conversation_id = h.post(text=QUESTION).json()["conversation"]["id"]
        state = h.wait(conversation_id)
        events = h.events(conversation_id)
        # two proposals were never handed to Core; the third was, with the label made a real path
        assert operations(events, "core").count(("science_submit", "SUCCEEDED")) == 1
        assert [e["data"]["code"] for e in events if e["type"] == "notice" and e["data"].get("code")][:2] == [
            "PATH_NOT_PERMITTED", "PATH_NOT_PERMITTED"]
        told = json.loads(h.provider.requests[2]["messages"][-1]["content"])["host_error"]
        assert "$WORKSPACE/.bioharness/requests/secret.json" in told and str(h.workspace) not in told
        record = json.loads(next((h.workspace / ".bioharness" / "requests").glob("*.json")).read_text())
        submission = record["submissions"][0]
        assert submission["evidence"][0]["source"] == str(h.workspace / "notes.txt")
        assert submission["summary"] == "See $WORKSPACE/notes.txt (label inside prose stays)."
        # the model and the event log only ever see the label
        assert str(h.workspace) not in json.dumps(h.provider.requests) + json.dumps(events)
        assert h.now(state["conversation"]["request_id"])["phase"] == "READY_TO_DELIVER"


# ---- one conversation is one request ---------------------------------------------
def test_a_message_after_delivery_does_not_reach_the_model(tmp_path):
    script = Script(tool("science_plan", {"plan": PLAN}), tool("science_submit", SUBMIT),
                    tool("science_deliver", DELIVER), {"text": "Delivered."})
    with Harness(tmp_path, script) as h:
        conversation_id = h.post(text=QUESTION).json()["conversation"]["id"]
        h.wait(conversation_id)
        asked = len(h.provider.requests)
        before = len(h.events(conversation_id))
        assert h.post(f"/{conversation_id}/runs", text="And how is it normalised?").status_code == 202
        h.wait(conversation_id)
        later = h.events(conversation_id)[before:]
        assert len(h.provider.requests) == asked  # a follow-up is new work: it starts with science_begin
        assert [e["data"]["code"] for e in later if e["type"] == "notice"] == ["REQUEST_DELIVERED"]
        assert finished(later) == [{"state": "FINISHED", "reason": "the turn ended"}]
        # a delivered request cannot be attached for continuation either
        request_id = h.conversation(conversation_id)["conversation"]["request_id"]
        refused = h.post(request_id=request_id)
        assert refused.status_code == 422 and refused.json()["detail"]["code"] == "REQUEST_DELIVERED"


def test_two_conversations_do_not_work_on_one_request_at_the_same_time(tmp_path):
    import threading
    release = threading.Event()

    def held(messages, tools):  # the first run stays in its model request until released
        release.wait(60)
        return {"text": "done (fixture)"}

    with Harness(tmp_path, held) as h:
        try:
            first = h.post(text=QUESTION).json()["conversation"]["id"]
            deadline = time.time() + 30
            while not h.provider.requests and time.time() < deadline:
                time.sleep(0.05)
            request_id = h.conversation(first)["conversation"]["request_id"]
            second = h.post(request_id=request_id).json()["conversation"]["id"]
            busy = h.post(f"/{second}/runs")
            assert busy.status_code == 409 and busy.json()["detail"]["code"] == "REQUEST_BUSY"
        finally:
            release.set()
        h.wait(first)
        assert h.post(f"/{second}/runs").status_code == 202
        h.wait(second)


def test_an_attach_in_progress_keeps_a_run_from_starting(tmp_path):
    import asyncio
    with Harness(tmp_path, Script()) as h:
        begun = core(h.workspace, "science_begin", {"question": QUESTION})
        runtime = h.client.app.state.runtime
        conversation = runtime.create("pilot")
        real_call = runtime.core.call

        async def scenario():
            asked = asyncio.Event()
            go = asyncio.Event()

            async def slow_call(workspace, tool, arguments):
                asked.set()
                await go.wait()
                return await real_call(workspace, tool, arguments)

            runtime.core.call = slow_call
            attach = asyncio.ensure_future(runtime.attach("pilot", conversation["id"], begun["request_id"]))
            await asked.wait()
            try:
                runtime.start_run("pilot", conversation["id"], "a different question?")
                started = True
            except Exception as refusal:
                started = getattr(refusal, "code", repr(refusal))
            go.set()
            await attach
            runtime.core.call = real_call
            return started

        assert h.client.portal.call(scenario) == "RUN_ACTIVE"
        assert runtime.ledger.conversation(conversation["id"])["request_id"] == begun["request_id"]
        assert runtime.ledger.events(conversation["id"])[0]["type"] == "notice"  # only the attach was recorded


# ---- what leaves the host ---------------------------------------------------------
def test_the_services_own_credentials_are_removed_wherever_they_are_echoed(tmp_path):
    said = f"A long enough opening so that text is shown while it is written. The key is {KEY} and the token is {TOKEN}. And some more text after them, also long enough to be shown."
    script = Script({"text": said, "delay": 0.03, "reasoning": "PRIVATE-REASONING-OF-THE-MODEL"})
    with Harness(tmp_path, script) as h:
        conversation_id = h.post(text=f"Fixture question mentioning {TOKEN}?").json()["conversation"]["id"]
        live = read_stream(h, conversation_id)
        state = h.wait(conversation_id)
        # text shown while it is being written never carries a credential either
        shown = "".join(json.loads(b["data"])["data"]["text"] for b in live if b["event"] == "assistant.delta")
        assert len(shown) > 60 and said.startswith(shown[:40])
        assert KEY not in shown and TOKEN not in shown and KEY[:12] not in shown.replace("[credential", "")
        everything = json.dumps(live) + json.dumps(h.events(conversation_id))
        assert "PRIVATE-REASONING" not in everything  # provider reasoning is neither shown nor kept
        stored = json.dumps(h.events(conversation_id))
        assert KEY not in stored and TOKEN not in stored and "[credential removed by host]" in stored
        # Core still received the user's words exactly as written
        assert h.now(state["conversation"]["request_id"])["question"] == f"Fixture question mentioning {TOKEN}?"


def test_old_tool_results_of_a_run_are_dropped_before_the_request_grows_without_bound(tmp_path):
    chatter = lambda messages, tools: tool("science_now", {})
    with Harness(tmp_path, chatter, max_model_turns_per_run=6, model_context_chars=30_000) as h:
        conversation_id = h.post(text=QUESTION).json()["conversation"]["id"]
        h.wait(conversation_id)
        last = h.provider.requests[-1]["messages"]
        results = [json.loads(m["content"]) for m in last if m["role"] == "tool"]
        assert len(results) == 5 and results[0].get("omitted_by_host") is True
        assert results[-1].get("phase") == "NEEDS_PLAN"  # the most recent result is intact
        assert '"phase": "NEEDS_PLAN"' in last[0]["content"]  # and Core's state is always given in full
        assert max(len(json.dumps(r["messages"][1:])) for r in h.provider.requests) < 60_000


# ---- the event stream -------------------------------------------------------------
def read_stream(h, conversation_id, after=0):
    """What a reader of the conversation's event stream receives, up to the end of the run.
    Collected inside the application's event loop, where the runtime lives."""
    from bioharness_web.stream import conversation_stream
    runtime = h.client.app.state.runtime

    async def collect():
        seen = []
        generator = conversation_stream(runtime, conversation_id, after, keepalive=0.2)
        try:
            async for chunk in generator:
                if chunk.startswith(":"):
                    continue
                block = dict(line.split(": ", 1) for line in chunk.strip().split("\n"))
                seen.append(block)
                if block["event"] == "run.finished":
                    break
        finally:
            await generator.aclose()
        return seen

    return h.client.portal.call(collect)


def test_the_event_stream_replays_recorded_events_and_gives_ids_only_to_them(tmp_path):
    script = Script(tool("science_plan", {"plan": PLAN}),
                    {"text": "The plan is in place and this sentence is long enough to be shown while written (fixture).",
                     "delay": 0.03})
    with Harness(tmp_path, script) as h:
        conversation_id = h.post(text=QUESTION).json()["conversation"]["id"]
        live = read_stream(h, conversation_id)  # connected while the run is under way
        h.wait(conversation_id)
        recorded = h.events(conversation_id)
        deltas = [b for b in live if b["event"] == "assistant.delta"]
        assert deltas and all("id" not in b for b in deltas)  # text being written is not a recorded event
        ids = [int(b["id"]) for b in live if "id" in b]
        assert ids == sorted(ids) and len(ids) == len(set(ids))
        assert set(ids) <= {e["seq"] for e in recorded}

        replay = read_stream(h, conversation_id)
        assert [int(b["id"]) for b in replay] == [e["seq"] for e in recorded]
        assert [b["event"] for b in replay] == [e["type"] for e in recorded]
        assert json.loads(replay[0]["data"])["type"] == "run.started"

        middle = recorded[len(recorded) // 2]["seq"]
        rest = read_stream(h, conversation_id, after=middle)
        assert [int(b["id"]) for b in rest] == [e["seq"] for e in recorded if e["seq"] > middle]
        # a reader that is ahead of this log (the log was replaced) gets all of it again
        ahead = read_stream(h, conversation_id, after=recorded[-1]["seq"] + 1000)
        assert [int(b["id"]) for b in ahead] == [e["seq"] for e in recorded]


def test_the_stream_route_resumes_after_the_last_event_the_browser_saw(tmp_path, monkeypatch):
    from bioharness_web import api as api_module
    starts = []

    def fake_stream(_runtime, _conversation_id, start):
        starts.append(start)

        async def nothing():
            return
            yield  # pragma: no cover

        return nothing()

    monkeypatch.setattr(api_module, "conversation_stream", fake_stream)
    with Harness(tmp_path, Script()) as h:
        conversation_id = h.post(text=QUESTION).json()["conversation"]["id"]
        h.wait(conversation_id)
        url = f"{h.url}/{conversation_id}/events"
        h.client.get(url, headers=AUTH)
        h.client.get(url + "?after=7", headers=AUTH)
        h.client.get(url, headers={**AUTH, "Last-Event-ID": "12"})
        h.client.get(url + "?after=3", headers={**AUTH, "Last-Event-ID": "not-a-number"})
        assert starts == [0, 7, 12, 3]
        assert h.client.get(f"{h.url}/conv-unknown/events", headers=AUTH).status_code == 404


def test_a_model_that_only_talks_is_not_reported_as_finished_while_core_expects_work(tmp_path):
    with Harness(tmp_path, lambda messages, tools: {"text": "I will think about it (fixture)."}) as h:
        conversation_id = h.post(text=QUESTION).json()["conversation"]["id"]
        state = h.wait(conversation_id)
        events = h.events(conversation_id)
        # Core asked twice to continue, in its own words, and the model was shown them
        assert [e["data"]["source"] for e in events if e["type"] == "notice"] == ["core", "core", "host"]
        assert h.provider.requests[1]["messages"][-1]["content"].startswith(
            "[Notice from the BioHarness host, not from the user]\nBioHarness Core:\nBioHarness Core still expects")
        assert len(h.provider.requests) == 3
        assert finished(events) == [{"state": "INTERRUPTED",
                                     "reason": "the model stopped while Core still expects work"}]
        assert h.now(state["conversation"]["request_id"])["phase"] == "NEEDS_PLAN"


def test_every_runtime_route_requires_authentication(tmp_path):
    with Harness(tmp_path, Script()) as h:
        conversation_id = h.post(text=QUESTION).json()["conversation"]["id"]
        h.wait(conversation_id)
        base = f"{h.url}/{conversation_id}"
        for method, path in [("get", h.url), ("post", h.url), ("get", base), ("put", base + "/request"),
                             ("post", base + "/runs"), ("post", base + "/runs/run-x/cancel"),
                             ("get", base + "/events")]:
            assert getattr(h.client, method)(path).status_code == 401, (method, path)
        assert h.client.get(f"/api/workspaces/other/conversations", headers=AUTH).status_code == 404
        ghost = h.client.post("/api/workspaces/other/conversations", json={"text": "q"}, headers=AUTH)
        assert ghost.status_code == 404
        # a conversation that could not be started leaves nothing behind
        before = len(h.client.get(h.url, headers=AUTH).json())
        assert h.post(request_id="sci-00000000-nope").status_code == 422
        assert len(h.client.get(h.url, headers=AUTH).json()) == before
        assert h.post(text=QUESTION, scope={"id": "x" * 201}).status_code == 422
        assert h.client.get(f"{h.url}/conv-unknown", headers=AUTH).status_code == 404
        assert h.post(text="x" * 50_001).status_code == 422
        assert h.post(text=QUESTION, scope={"id": "p", "path": "/etc"}).status_code == 422


def test_the_runtime_routes_do_not_exist_without_a_configured_model(tmp_path):
    workspace = (tmp_path / "ws").resolve()
    workspace.mkdir()
    settings = Settings(service_id="read-only", access_token=TOKEN,
                        workspaces={"pilot": Workspace("pilot", workspace, (workspace,))})
    client = TestClient(create_app(settings))
    assert client.get("/api/meta", headers=AUTH).json()["runtime"] == {
        "enabled": False, "model": None, "module_tool_servers": []}
    assert client.post("/api/workspaces/pilot/conversations", json={"text": "q"}, headers=AUTH).status_code in (404, 405)
