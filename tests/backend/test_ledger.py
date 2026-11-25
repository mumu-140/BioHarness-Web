import pytest

from bioharness_web.ledger import MAX_EVENT_CHARS, Ledger, RunActive


@pytest.fixture
def ledger(tmp_path):
    book = Ledger(tmp_path / "ledger.sqlite3")
    yield book
    book.close()


def test_a_conversation_gets_its_request_once_and_is_never_repointed(ledger):
    conversation = ledger.create_conversation("pilot")
    assert conversation["request_id"] is None and conversation["native_session"].startswith("web-")
    assert ledger.set_request(conversation["id"], "sci-1") is True
    assert ledger.set_request(conversation["id"], "sci-2") is False
    assert ledger.conversation(conversation["id"])["request_id"] == "sci-1"
    other = ledger.create_conversation("pilot")
    assert other["native_session"] != conversation["native_session"]


def test_the_database_itself_allows_one_running_run_per_conversation(ledger):
    conversation = ledger.create_conversation("pilot")["id"]
    first = ledger.start_run(conversation)
    with pytest.raises(RunActive):
        ledger.start_run(conversation)
    ledger.end_run(first, "FINISHED")
    second = ledger.start_run(conversation)
    assert ledger.active_run(conversation)["id"] == second
    ledger.end_run(first, "FAILED")  # an ended run keeps the state it ended with
    assert ledger.run(first)["state"] == "FINISHED"


def test_cancellation_is_recorded_as_requested_only_for_a_run_in_progress(ledger):
    conversation = ledger.create_conversation("pilot")["id"]
    run = ledger.start_run(conversation)
    assert ledger.request_cancel(run) is True
    assert ledger.run(run)["cancel_requested"] == 1 and ledger.run(run)["state"] == "RUNNING"
    ledger.end_run(run, "CANCELLED")
    assert ledger.request_cancel(run) is False


def test_events_are_ordered_replayable_and_bounded(ledger):
    conversation = ledger.create_conversation("pilot")["id"]
    first = ledger.append(conversation, None, "user.message", {"text": "问题"})
    big = ledger.append(conversation, None, "operation.finished", {"output": {"blob": "x" * (MAX_EVENT_CHARS + 10)}})
    assert first["seq"] < big["seq"] and ledger.last_seq(conversation) == big["seq"]
    stored = ledger.events(conversation)
    assert stored[0]["data"] == {"text": "问题"}
    assert stored[1]["data"]["output"]["omitted"] is True
    assert stored[1]["data"]["output"]["characters"] > MAX_EVENT_CHARS
    assert ledger.events(conversation, after=first["seq"]) == stored[1:]
    assert ledger.events("conv-other") == [] and ledger.last_seq("conv-other") == 0


def test_another_conversation_running_on_the_same_request_is_seen(ledger):
    a, b = ledger.create_conversation("pilot", "sci-1")["id"], ledger.create_conversation("pilot", "sci-1")["id"]
    c = ledger.create_conversation("other-workspace", "sci-1")["id"]
    run = ledger.start_run(a)
    assert ledger.running_elsewhere("pilot", "sci-1", b) is True
    assert ledger.running_elsewhere("pilot", "sci-1", a) is False
    assert ledger.running_elsewhere("other-workspace", "sci-1", c) is False
    ledger.end_run(run, "FINISHED")
    assert ledger.running_elsewhere("pilot", "sci-1", b) is False


def test_after_a_restart_running_becomes_interrupted_and_started_becomes_unknown(tmp_path):
    path = tmp_path / "ledger.sqlite3"
    before = Ledger(path)
    conversation = before.create_conversation("pilot")["id"]
    run = before.start_run(conversation)
    done = before.start_operation(run, "core", "science_plan")
    before.end_operation(done, "SUCCEEDED")
    pending = before.start_operation(run, "core", "science_submit")
    before.close()

    after = Ledger(path)
    assert [r["id"] for r in after.recover()] == [run]
    states = {o["id"]: o["state"] for o in after.operations(run)}
    assert states == {done: "SUCCEEDED", pending: "UNKNOWN"}  # never assumed finished or failed
    assert after.run(run)["state"] == "INTERRUPTED" and after.active_run(conversation) is None
    events = after.events(conversation)
    assert [(e["type"], e["data"]["state"]) for e in events] == [
        ("operation.finished", "UNKNOWN"), ("run.finished", "INTERRUPTED")]
    assert after.recover() == []  # nothing left to recover
    after.start_run(conversation)  # and the conversation can be worked on again
    after.close()
