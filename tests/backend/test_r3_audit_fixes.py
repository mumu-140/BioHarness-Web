"""R3 post-audit remediation backend tests covering:
1. Verbatim user question preserved in Core science_begin while attachments bind independently.
2. Professional modules record real executions in the existing SQLite ledger, save artifacts to
   authorized upload_root, and allow immediate downstream verification & citation.
3. Optimized concise/thorough budgets, continuation preserving strategy, and bounded recovery
   against unnecessary auto-interruption when Core must_not_stop=True.
4. Dynamic module version & CLI callability probing without hardcoded user paths or domain terms.
"""
from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from bioharness_web.app import create_app
from bioharness_web.settings import ModelSettings, Settings, Workspace
from contract.test_runtime import AUTH, DELIVER, Harness, PLAN, SUBMIT, Script, finished, tool

TOKEN = "r3-audit-token-0123456789abcdef"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}


def _find_cli(name: str) -> str | None:
    found = shutil.which(name)
    if found:
        return found
    local_bin = Path.home() / ".local/bin" / name
    return str(local_bin) if local_bin.is_file() else None


def test_audit1_verbatim_question_preserved_and_attachments_bound_separately(tmp_path: Path):
    """Uploading & attaching a file MUST NOT mutate Core science_begin question text."""
    script = Script(
        tool("science_plan", {"plan": PLAN}),
        tool("science_submit", SUBMIT),
        tool("science_deliver", DELIVER),
        {"text": "Final answer grounded in attached input."},
    )
    with Harness(tmp_path, script) as h:
        sample = h.workspace / "counts.csv"
        sample_bytes = b"gene,tpm\nG1,12.5\n"
        sample.write_bytes(sample_bytes)
        sha = hashlib.sha256(sample_bytes).hexdigest()

        verbatim_q = "Compare expression levels across replicates cleanly."
        resp = h.client.post(
            h.url,
            headers=AUTH,
            json={
                "text": verbatim_q,
                "attachments": [{"path": "$WORKSPACE/counts.csv", "sha256": sha}],
            },
        )
        assert resp.status_code == 201, resp.text
        convo_id = resp.json()["conversation"]["id"]
        state = h.wait(convo_id)
        req_id = state["conversation"]["request_id"]
        assert req_id

        # Core holds the exact verbatim user question with ZERO injected attachment prose
        now = h.now(req_id)
        assert now["question"] == verbatim_q
        assert "附带研究资料" not in now["question"]

        # Event log records verbatim user.message.text + structured attachments separately
        events = h.events(convo_id)
        user_ev = next(e for e in events if e["type"] == "user.message")
        assert user_ev["data"]["text"] == verbatim_q
        assert len(user_ev["data"]["attachments"]) == 1
        assert user_ev["data"]["attachments"][0]["sha256"] == sha
        assert user_ev["data"]["attachments"][0]["server_path"] == "$WORKSPACE/counts.csv"

        # Model actually received the attachment metadata via separate host context message
        all_prompt_text = json.dumps(h.provider.requests[0], ensure_ascii=False)
        assert "$WORKSPACE/counts.csv" in all_prompt_text
        assert sha in all_prompt_text


def test_audit1_attachment_sha256_mismatch_and_traversal_rejected(tmp_path: Path):
    """Cross-workspace or tampered attachments are rejected cleanly before starting a run."""
    script = Script({"text": "unreachable"})
    with Harness(tmp_path, script) as h:
        sample = h.workspace / "counts.csv"
        sample.write_bytes(b"a,b\n1,2\n")
        r_bad_sha = h.client.post(
            h.url,
            headers=AUTH,
            json={
                "text": "Test bad sha",
                "attachments": [{"path": "$WORKSPACE/counts.csv", "sha256": "0" * 64}],
            },
        )
        assert r_bad_sha.status_code == 409
        assert r_bad_sha.json()["detail"]["code"] == "ATTACHMENT_SHA_MISMATCH"

        r_escape = h.client.post(
            h.url,
            headers=AUTH,
            json={
                "text": "Test traversal",
                "attachments": [{"path": "/etc/passwd"}],
            },
        )
        assert r_escape.status_code == 403
        assert r_escape.json()["detail"]["code"] == "ATTACHMENT_OUTSIDE_WORKSPACE"


def test_audit2_module_ledger_recording_artifact_saving_and_downstream_reuse(tmp_path: Path):
    """Statistics render & Protein Methods persist artifacts under upload_root, log into the
    existing Web SQLite ledger, update actually_used counts, and feed directly into /invocations
    and downstream verify."""
    stat_cli = _find_cli("bioharness-statistics-report-binding")
    pm_cli = _find_cli("bioharness-protein-methods")
    if not stat_cli or not pm_cli:
        pytest.skip("statistics or protein-methods CLI not installed")

    ws = tmp_path / "ws"
    upload_dir = ws / "inputs"
    upload_dir.mkdir(parents=True)
    state_dir = tmp_path / "state"
    state_dir.mkdir()

    bundle = {
        "records": [
            {
                "metric_id": "rate_a",
                "unit": "proportion",
                "value": 0.25,
                "numerator": 5,
                "denominator": 20,
                "event": {"outcome": "pos"},
                "given": {"group": "A"},
                "population": "group=A",
                "stratum": "outcome=pos",
                "method": "exact_binomial",
                "display_decimals": 1,
            }
        ],
        "tables": [],
    }
    (ws / "bundle.json").write_text(json.dumps(bundle), encoding="utf-8")
    (ws / "tpl.md").write_text("Result: {{stat:rate_a}}.\n", encoding="utf-8")
    (ws / "mini.pdb").write_text(
        "ATOM      1  N   ALA A   1      11.104  13.207   2.100  1.00 20.00           N\n"
        "ATOM      2  CA  ALA A   1      12.560  13.207   2.100  1.00 20.00           C\n"
        "TER       3      ALA A   1\nEND\n",
        encoding="utf-8",
    )

    settings = Settings(
        service_id="svc-audit2",
        workspaces={
            "demo": Workspace(
                id="demo",
                path=ws.resolve(),
                evidence_roots=(ws.resolve(),),
                upload_root=upload_dir.resolve(),
            )
        },
        access_token=TOKEN,
        model=ModelSettings(base_url="http://127.0.0.1:9/v1", api_key="sk-audit-0000", name="test-model"),
        ledger_path=state_dir / "ledger.sqlite3",
        statistics_cli=stat_cli,
        protein_cli=pm_cli,
    )

    with TestClient(create_app(settings)) as client:
        convo_id = client.app.state.runtime.create("demo")["id"]

        # 1. Run statistics render -> saves artifact + records ledger + visible in /invocations
        r = client.post(
            "/api/workspaces/demo/modules/statistics/report-binding",
            headers=HEADERS,
            json={
                "action": "render",
                "records_path": "bundle.json",
                "template_path": "tpl.md",
                "save_output": True,
                "conversation_id": convo_id,
            },
        )
        assert r.status_code == 200, r.text
        rb = r.json()
        assert rb["status"] == "PASS"
        assert rb["recorded_in_ledger"] is True
        saved = rb["saved_artifact"]
        assert saved is not None
        assert saved["relative_path"].startswith("inputs/module-artifacts/statistics/")
        assert (ws / saved["relative_path"]).is_file()

        # 2. Immediately verify the persisted rendered artifact via statistics verify
        v = client.post(
            "/api/workspaces/demo/modules/statistics/report-binding",
            headers=HEADERS,
            json={
                "action": "verify",
                "records_path": "bundle.json",
                "template_path": "tpl.md",
                "report_path": saved["relative_path"],
                "conversation_id": convo_id,
            },
        )
        assert v.status_code == 200, v.text
        assert v.json()["status"] == "PASS"

        # 3. Run protein-methods without conversation_id (workspace-level) -> persists & logs in ledger
        pm = client.post(
            "/api/workspaces/demo/modules/protein/run",
            headers=HEADERS,
            json={"operation": "structure-inventory", "input_path": "mini.pdb", "save_output": True},
        )
        assert pm.status_code == 200, pm.text
        assert pm.json()["saved_artifact"]["relative_path"].startswith("inputs/module-artifacts/protein-methods/")
        assert pm.json()["recorded_in_ledger"] is True

        # 4. Domain modules & capabilities snapshots immediately reflect actually_used=True + recent_invocations
        dm = client.get("/api/workspaces/demo/domain-modules", headers=HEADERS).json()
        by_id = {m["id"]: m for m in dm["modules"]}
        assert by_id["statistics"]["actually_used"] is True
        assert by_id["statistics"]["use_count"] >= 2
        assert by_id["protein-methods"]["actually_used"] is True
        assert by_id["protein-methods"]["use_count"] >= 1
        assert len(dm["recent_invocations"]) >= 3

        caps = client.get("/api/workspaces/demo/capabilities", headers=HEADERS).json()
        cli_by_id = {c["id"]: c for c in caps["cli_modules"]}
        assert cli_by_id["statistics"]["actually_used"] is True
        assert cli_by_id["protein-methods"]["actually_used"] is True

        # 5. Saved artifact is discoverable in /inputs for direct attachment in future runs
        inp = client.get("/api/workspaces/demo/inputs", headers=HEADERS).json()
        assert any(f["name"] == saved["name"] for f in inp["files"])

        # 6. Conversation /invocations exposes the recorded statistics operations
        inv = client.get(f"/api/workspaces/demo/conversations/{convo_id}/invocations", headers=HEADERS).json()
        names = [item["name"] for item in inv["items"]]
        assert "statistics:render" in names
        assert "statistics:verify" in names


def test_audit3_budgets_continuation_strategy_and_midwork_recovery(tmp_path: Path):
    """Fast/deep budgets avoid premature 12-turn cutoffs, single mid-work pause completes cleanly
    via Core stop hook, and resuming an interrupted run preserves requested strategy."""
    from bioharness_web.runtime import run_strategies
    default_s = Settings(service_id="s", workspaces={}, access_token=TOKEN)
    by_strat = {s["id"]: s for s in run_strategies(default_s)}
    assert by_strat["concise"]["max_turns"] >= 24
    assert by_strat["concise"]["context_chars"] >= 120_000
    assert by_strat["thorough"]["max_turns"] >= 80
    assert by_strat["thorough"]["context_chars"] >= 360_000

    # 1. Single mid-work pause completes cleanly without unnecessary interruption
    script = Script(
        tool("science_plan", {"plan": PLAN}),
        {"text": "Interim note before submitting evidence."},
        tool("science_submit", SUBMIT),
        tool("science_deliver", DELIVER),
        {"text": "Completed cleanly without interruption."},
    )
    (tmp_path / "m1").mkdir()
    with Harness(tmp_path / "m1", script) as h:
        cid = h.post(text="Run full analysis despite transient summary pause.").json()["conversation"]["id"]
        state = h.wait(cid)
        events = h.events(cid)
        assert finished(events) == [{"state": "FINISHED", "reason": "the turn ended"}]
        assert h.now(state["conversation"]["request_id"])["phase"] == "DELIVERED"

    # 2. Resuming an interrupted run with strategy=thorough preserves thorough budget & finishes
    script2 = Script(
        tool("science_plan", {"plan": PLAN}),
        {"text": "Pause 1"},
        {"text": "Pause 2"},
        {"text": "Pause 3"},
        tool("science_submit", SUBMIT),
        tool("science_deliver", DELIVER),
        {"text": "Resumed and delivered with thorough strategy."},
    )
    (tmp_path / "m2").mkdir()
    with Harness(tmp_path / "m2", script2) as h:
        cid = h.post(text="Task to resume with thorough budget.").json()["conversation"]["id"]
        h.wait(cid)
        ev1 = h.events(cid)
        assert finished(ev1)[-1]["state"] == "INTERRUPTED"
        res = h.client.post(
            f"{h.url}/{cid}/runs",
            headers=AUTH,
            json={"strategy": "thorough"},
        )
        assert res.status_code == 202, res.text
        state2 = h.wait(cid)
        ev2 = h.events(cid)
        started_events = [e["data"] for e in ev2 if e["type"] == "run.started"]
        assert started_events[-1]["strategy"] == "thorough"
        assert started_events[-1]["max_turns"] >= 80
        assert finished(ev2)[-1]["state"] == "FINISHED"
        assert h.now(state2["conversation"]["request_id"])["phase"] == "DELIVERED"


def test_audit4_dynamic_probe_and_honest_skill_callability(tmp_path: Path):
    """Workspace SKILL.md reports callable=None (advisory doc) and broken CLI reports callable=False."""
    ws = tmp_path / "ws"
    (ws / ".claude/skills/my-guide").mkdir(parents=True)
    (ws / ".claude/skills/my-guide/SKILL.md").write_text("---\nname: my-guide\ndescription: Guide\n---\n", encoding="utf-8")
    broken_cli = tmp_path / "broken-stat-cli"
    broken_cli.write_text("#!/bin/sh\nexit 127\n", encoding="utf-8")
    broken_cli.chmod(0o755)
    settings = Settings(
        service_id="svc-audit4",
        workspaces={"demo": Workspace(id="demo", path=ws.resolve(), evidence_roots=(ws.resolve(),))},
        access_token=TOKEN,
        statistics_cli=str(broken_cli),
    )
    with TestClient(create_app(settings)) as client:
        caps = client.get("/api/workspaces/demo/capabilities", headers=HEADERS).json()
        assert caps["skills"][0]["callable"] is None
        cli_by_id = {c["id"]: c for c in caps["cli_modules"]}
        assert cli_by_id["statistics"]["installed"] is True
        assert cli_by_id["statistics"]["callable"] is False
