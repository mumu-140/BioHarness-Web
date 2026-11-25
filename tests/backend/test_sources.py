import asyncio

import pytest

from bioharness_web.cli import ToolError
from bioharness_web.sources import SelectorError, Sources, UnknownWorkspace, normalize_selector


def make(settings, runner):
    return Sources(settings, runner)


# ---- selectors ---------------------------------------------------------------
def test_selector_requires_what_the_owner_requires():
    with pytest.raises(SelectorError, match="requires: request_id"):
        normalize_selector("now", {})
    with pytest.raises(SelectorError, match="requires: evidence_id, sha256"):
        normalize_selector("evidence", {"request_id": "r", "submission_index": 1})


@pytest.mark.parametrize("view,selector", [
    ("nope", {}),
    ("tree", {"scope_id": "s"}),
    ("now", {"request_id": "a\nb"}),
    ("now", {"request_id": ""}),
    ("now", {"request_id": "x" * 201}),
    ("routes", {"scope_id": "s", "limit": -1}),
    ("routes", {"scope_id": "s", "limit": True}),
    ("evidence", {"request_id": "r", "submission_index": 1, "evidence_id": "e1",
                  "sha256": "ABC"}),
])
def test_malformed_selectors_are_rejected(view, selector):
    with pytest.raises(SelectorError):
        normalize_selector(view, selector)


def test_selector_drops_unset_values_and_is_order_independent():
    a = normalize_selector("routes", {"scope_id": "s", "include_related": False,
                                      "include_descendants": True, "limit": None})
    assert a == {"include_descendants": True, "scope_id": "s"}


# ---- argv --------------------------------------------------------------------
async def test_core_is_called_with_fixed_argv_and_json_stdin(settings, fake_runner, workspace_dir):
    fake_runner.answers["now"] = {"ok": True, "request_id": "r1", "phase": "WORK"}
    await make(settings, fake_runner).get("pilot", "now", {"request_id": "r1"})
    argv, stdin = fake_runner.calls[0]
    assert argv == ["bioharness-host", "call", f"--workspace={workspace_dir}", "science_now", "-"]
    assert stdin == {"request_id": "r1"}


async def test_governance_values_cannot_become_options(settings, fake_runner, workspace_dir):
    fake_runner.answers["routes"] = {"ok": True, "attempts": []}
    await make(settings, fake_runner).get(
        "pilot", "routes", {"scope_id": "--workspace=/etc", "include_descendants": True, "limit": 5})
    argv, stdin = fake_runner.calls[0]
    assert argv == ["bioharness-governance", f"--workspace={workspace_dir}", "routes",
                    "--include-descendants", "--limit=5", "--scope-id=--workspace=/etc"]
    assert stdin is None


async def test_unknown_workspace(settings, fake_runner):
    with pytest.raises(UnknownWorkspace):
        await make(settings, fake_runner).get("other", "tree", {})
    assert fake_runner.calls == []


# ---- snapshot envelope -------------------------------------------------------
async def test_snapshot_carries_identity_source_and_opaque_version(settings, fake_runner):
    fake_runner.answers["tree"] = {"ok": True, "nodes": [], "view_sha256": "v1",
                                   "warnings": ["Unreadable request file: x.json"]}
    snapshot = await make(settings, fake_runner).get("pilot", "tree", {"project_id": "p"})
    assert snapshot["service"] == "test-service"
    assert snapshot["workspace"] == "pilot"
    assert snapshot["view"] == "tree" and snapshot["selector"] == {"project_id": "p"}
    assert snapshot["source"] == {"owner": "project-governance", "interface": "tree"}
    assert snapshot["ok"] is True and snapshot["error"] is None
    assert snapshot["source_version"] == {"view_sha256": "v1"}
    assert len(snapshot["content_sha256"]) == 64
    assert snapshot["warnings"] == ["Unreadable request file: x.json"]


async def test_core_exposes_no_version_so_none_is_invented(settings, fake_runner):
    fake_runner.answers["now"] = {"ok": True, "request_id": "r1", "phase": "WORK",
                                  "shortened": {"note": "Parts marked PREVIEW were shortened"}}
    snapshot = await make(settings, fake_runner).get("pilot", "now", {"request_id": "r1"})
    assert snapshot["source_version"] is None
    assert snapshot["shortened"] == {"note": "Parts marked PREVIEW were shortened"}


async def test_content_version_changes_only_with_content(settings, fake_runner):
    sources = make(settings, fake_runner)
    fake_runner.answers["now"] = {"ok": True, "request_id": "r1", "phase": "WORK"}
    first = await sources.get("pilot", "now", {"request_id": "r1"}, max_age=0)
    again = await sources.get("pilot", "now", {"request_id": "r1"}, max_age=0)
    fake_runner.answers["now"] = {"ok": True, "request_id": "r1", "phase": "READY_TO_DELIVER"}
    changed = await sources.get("pilot", "now", {"request_id": "r1"}, max_age=0)
    assert first["content_sha256"] == again["content_sha256"] != changed["content_sha256"]


async def test_core_refusal_keeps_the_nested_code(settings, fake_runner):
    fake_runner.answers["now"] = {"ok": False, "error": {
        "code": "REQUEST_NOT_FOUND", "message": "no such request",
        "problems": [{"field": "request_id", "problem": "unknown", "fix": "use science_begin"}]}}
    snapshot = await make(settings, fake_runner).get("pilot", "now", {"request_id": "zz"})
    assert snapshot["ok"] is False and snapshot["data"] is None
    assert snapshot["error"]["origin"] == "core"
    assert snapshot["error"]["code"] == "REQUEST_NOT_FOUND"
    assert snapshot["error"]["detail"]["problems"][0]["field"] == "request_id"


async def test_governance_refusal_is_a_plain_message(settings, fake_runner):
    fake_runner.answers["context"] = {"ok": False,
                                      "error": "request_id does not belong to selected scope"}
    snapshot = await make(settings, fake_runner).get(
        "pilot", "context", {"scope_id": "s", "request_id": "r"})
    assert snapshot["error"] == {"origin": "project-governance", "code": None,
                                 "message": "request_id does not belong to selected scope",
                                 "detail": {}}


async def test_server_paths_are_relabelled(settings, fake_runner, workspace_dir):
    fake_runner.answers["evidence"] = {"ok": True, "evidence": {
        "source": f"{workspace_dir}/results/table.tsv", "kind": "file"},
        "sibling": f"{workspace_dir}-other/file"}
    snapshot = await make(settings, fake_runner).get("pilot", "evidence", {
        "request_id": "r", "submission_index": 1, "evidence_id": "e1", "sha256": "a" * 64})
    assert snapshot["data"]["evidence"]["source"] == "$WORKSPACE/results/table.tsv"
    # a different directory that merely shares the prefix is not the workspace
    assert snapshot["data"]["sibling"] == f"{workspace_dir}-other/file"


async def test_file_paths_outside_configured_directories_keep_only_their_name(settings, fake_runner, workspace_dir):
    fake_runner.answers["now"] = {
        "ok": True, "request_id": "r1", "phase": "WORK",
        "instruction": "free text is not a path field: /srv/elsewhere/notes.txt",
        "evidence_changed_since_submission": [
            "/srv/private/run 1/table.tsv (modified after submission)",
            f"{workspace_dir}/inputs.tsv (no longer present)"]}
    fake_runner.answers["routes"] = {"ok": True, "attempts": [{"evidence": [
        {"kind": "file", "source": "/srv/private/run 1/table.tsv"},
        {"kind": "file", "source": f"{workspace_dir}/inputs.tsv"},
        {"kind": "text", "source": "/not/a/file/path/but/a/label"}]}]}
    sources = make(settings, fake_runner)
    now = (await sources.get("pilot", "now", {"request_id": "r1"}))["data"]
    assert now["evidence_changed_since_submission"] == [
        "$OUTSIDE_CONFIGURED_ROOTS/table.tsv (modified after submission)",
        "$WORKSPACE/inputs.tsv (no longer present)"]
    evidence = (await sources.get("pilot", "routes", {"scope_id": "s"}))["data"]["attempts"][0]["evidence"]
    assert [e["source"] for e in evidence] == [
        "$OUTSIDE_CONFIGURED_ROOTS/table.tsv", "$WORKSPACE/inputs.tsv", "/not/a/file/path/but/a/label"]


async def test_tool_failure_propagates_and_is_not_cached(settings, fake_runner):
    sources = make(settings, fake_runner)
    fake_runner.answers["tree"] = ToolError("TOOL_TIMEOUT", "slow")
    with pytest.raises(ToolError):
        await sources.get("pilot", "tree", {})
    fake_runner.answers["tree"] = {"ok": True, "nodes": []}
    assert (await sources.get("pilot", "tree", {}))["ok"] is True


# ---- open requests -----------------------------------------------------------
async def test_open_listing_from_idle(settings, fake_runner):
    fake_runner.answers["now"] = {"ok": True, "phase": "IDLE", "action": "BEGIN"}
    snapshot = await make(settings, fake_runner).get("pilot", "open", {})
    assert fake_runner.calls[0][1] == {}
    assert snapshot["data"]["open_requests"] == []
    assert snapshot["data"]["core_state_present"] is True


async def test_open_listing_from_a_single_unscoped_open_request(settings, fake_runner):
    fake_runner.answers["now"] = {"ok": True, "request_id": "r1", "phase": "WORK",
                                  "question": "Q?", "plan": {"steps": []}}
    snapshot = await make(settings, fake_runner).get("pilot", "open", {})
    assert snapshot["data"]["open_requests"] == [{"request_id": "r1", "question": "Q?"}]
    assert snapshot["data"]["may_be_incomplete"] is False


async def test_open_listing_keeps_the_scope_core_reports_for_a_single_request(settings, fake_runner):
    fake_runner.answers["now"] = {
        "ok": True, "request_id": "r1", "phase": "WORK", "question": "Q?",
        "scope_context": {"scope_id": "branch", "project_id": "project", "path": ["project", "branch"]}}
    snapshot = await make(settings, fake_runner).get("pilot", "open", {})
    assert snapshot["data"]["open_requests"] == [
        {"request_id": "r1", "question": "Q?", "scope_id": "branch", "project_id": "project"}]


async def test_open_listing_from_ambiguity_never_picks_one(settings, fake_runner):
    listed = [{"request_id": f"r{i}", "question": "q", "updated_at": ""} for i in range(20)]
    fake_runner.answers["now"] = {"ok": False, "error": {
        "code": "REQUEST_AMBIGUOUS", "message": "25 requests are open", "open_requests": listed}}
    snapshot = await make(settings, fake_runner).get("pilot", "open", {})
    assert snapshot["ok"] is True
    assert [r["request_id"] for r in snapshot["data"]["open_requests"]] == [f"r{i}" for i in range(20)]
    assert snapshot["data"]["may_be_incomplete"] is True
    assert snapshot["data"]["source_message"] == "25 requests are open"


async def test_open_listing_reports_any_other_refusal(settings, fake_runner):
    fake_runner.answers["now"] = {"ok": False, "error": {"code": "INTERNAL_ERROR", "message": "x"}}
    snapshot = await make(settings, fake_runner).get("pilot", "open", {})
    assert snapshot["ok"] is False and snapshot["error"]["code"] == "INTERNAL_ERROR"


async def test_core_is_not_called_in_a_workspace_without_core_state(settings, fake_runner, workspace_dir):
    (workspace_dir / ".bioharness" / "requests").rmdir()
    sources = make(settings, fake_runner)
    listing = await sources.get("pilot", "open", {})
    now = await sources.get("pilot", "now", {"request_id": "r1"})
    assert fake_runner.calls == []  # the Core CLI would create state directories
    assert listing["data"] == {"core_state_present": False, "open_requests": [],
                               "may_be_incomplete": False, "source_message": None}
    assert now["ok"] is False and now["error"]["code"] == "WORKSPACE_NO_CORE_STATE"
    assert not (workspace_dir / ".bioharness" / "requests").exists()


@pytest.mark.parametrize("missing", ["evidence", "sessions"])
async def test_core_is_not_called_on_a_partial_state_directory(settings, fake_runner, workspace_dir, missing):
    (workspace_dir / ".bioharness" / missing).rmdir()  # Core would create it during a read
    listing = await make(settings, fake_runner).get("pilot", "open", {})
    assert fake_runner.calls == []
    assert listing["data"]["core_state_present"] is False


async def test_a_repeated_read_within_max_age_reuses_the_snapshot(settings, fake_runner):
    fake_runner.answers["tree"] = {"ok": True, "nodes": []}
    sources = make(settings, fake_runner)
    first = await sources.get("pilot", "tree", {}, max_age=60)
    again = await sources.get("pilot", "tree", {}, max_age=60)
    assert again is first and len(fake_runner.calls) == 1
    await sources.get("pilot", "tree", {}, max_age=0)
    assert len(fake_runner.calls) == 2


# ---- reuse of in-flight reads --------------------------------------------------
async def test_concurrent_identical_reads_share_one_call(settings, fake_runner):
    gate = asyncio.Event()

    class Slow:
        calls = 0

        async def run_json(self, argv, stdin=None):
            Slow.calls += 1
            await gate.wait()
            return {"ok": True, "nodes": []}

    sources = make(settings, Slow())
    tasks = [asyncio.create_task(sources.get("pilot", "tree", {})) for _ in range(5)]
    await asyncio.sleep(0.05)
    gate.set()
    results = await asyncio.gather(*tasks)
    assert Slow.calls == 1
    assert len({r["content_sha256"] for r in results}) == 1
