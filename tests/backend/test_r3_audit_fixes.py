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


def test_final1_literature_fetch_persists_pdfs_and_rewrites_downloads_json(tmp_path: Path):
    """Literature fetch must persist downloaded PDFs under upload_root/module-artifacts/literature/
    and rewrite downloads.json so entries point to durable workspace paths instead of deleted /tmp."""
    lit_cli = _find_cli("bioharness-literature")
    if not lit_cli:
        pytest.skip("bioharness-literature CLI not installed")

    ws = tmp_path / "ws"
    upload_dir = ws / "inputs"
    upload_dir.mkdir(parents=True)
    state_dir = tmp_path / "state"
    state_dir.mkdir()

    # Minimal valid search.json
    (ws / "search.json").write_text(
        json.dumps({
            "operation": "search",
            "question": "test fetch",
            "papers": [
                {
                    "rank": 1,
                    "title": "Sample Study",
                    "doi": "10.1000/test.pdf.1",
                    "identifier": "10.1000/test.pdf.1",
                }
            ],
        }),
        encoding="utf-8",
    )

    # Stub scansci-pdf CLI that writes a real PDF inside --output and prints JSON manifest
    fake_scansci = tmp_path / "fake_scansci"
    fake_scansci.write_text(
        "#!/usr/bin/env python3\n"
        "import json, os, sys\n"
        "from pathlib import Path\n"
        "args = sys.argv[1:]\n"
        "out_dir = Path('.')\n"
        "for i, a in enumerate(args):\n"
        "    if a in ('-o', '--output', '--output-dir') and i + 1 < len(args):\n"
        "        out_dir = Path(args[i + 1])\n"
        "out_dir.mkdir(parents=True, exist_ok=True)\n"
        "pdf = out_dir / 'sample_paper.pdf'\n"
        "pdf.write_bytes(b'%PDF-1.4\\n%real persisted pdf fixture\\n')\n"
        "print(json.dumps({'downloaded': [{'identifier': '10.1000/test.pdf.1', 'file': str(pdf), 'status': 'downloaded'}]}))\n",
        encoding="utf-8",
    )
    fake_scansci.chmod(0o755)

    # Stub bioharness-literature fetch CLI to simulate exact downloads.json + PDF output inside --output
    fake_lit = tmp_path / "fake_lit"
    fake_lit.write_text(
        "#!/usr/bin/env python3\n"
        "import json, sys\n"
        "from pathlib import Path\n"
        "args = sys.argv[1:]\n"
        "out_dir = Path(args[args.index('--output') + 1])\n"
        "pdfs = out_dir / 'pdfs'\n"
        "pdfs.mkdir(parents=True, exist_ok=True)\n"
        "pdf = pdfs / 'study_2026.pdf'\n"
        "pdf_bytes = b'%PDF-1.4\\n%persisted study pdf\\n'\n"
        "pdf.write_bytes(pdf_bytes)\n"
        "manifest = {\n"
        "    'ok': True,\n"
        "    'operation': 'fetch',\n"
        "    'downloaded_identifiers': 1,\n"
        "    'requested_identifiers': 1,\n"
        "    'entries': [\n"
        "        {'identifier': '10.1000/test.pdf.1', 'status': 'downloaded', 'file': str(pdf)}\n"
        "    ],\n"
        "}\n"
        "(out_dir / 'downloads.json').write_text(json.dumps(manifest), encoding='utf-8')\n"
        "print(json.dumps(manifest))\n",
        encoding="utf-8",
    )
    fake_lit.chmod(0o755)

    settings = Settings(
        service_id="svc-final1",
        workspaces={
            "demo": Workspace(
                id="demo",
                path=ws.resolve(),
                evidence_roots=(ws.resolve(),),
                upload_root=upload_dir.resolve(),
            )
        },
        access_token=TOKEN,
        ledger_path=state_dir / "ledger.sqlite3",
        literature_cli=str(fake_lit),
        scansci_cli=str(fake_scansci),
    )

    with TestClient(create_app(settings)) as client:
        res = client.post(
            "/api/workspaces/demo/modules/literature/run",
            headers=HEADERS,
            json={"operation": "fetch", "search_json_path": "search.json", "save_output": True},
        )
        assert res.status_code == 200, res.text
        body = res.json()
        assert len(body["saved_pdfs"]) == 1
        pdf_art = body["saved_pdfs"][0]
        assert pdf_art["relative_path"].startswith("inputs/module-artifacts/literature/")
        assert (ws / pdf_art["relative_path"]).is_file()
        assert (ws / pdf_art["relative_path"]).read_bytes().startswith(b"%PDF-1.4")

        # Persisted downloads.json points to durable $WORKSPACE path (never deleted /tmp path)
        saved_dl = body["saved_artifact"]
        assert saved_dl is not None
        dl_data = json.loads((ws / saved_dl["relative_path"]).read_text(encoding="utf-8"))
        assert dl_data["entries"][0]["file"] == pdf_art["server_path"]
        assert "/tmp/" not in dl_data["entries"][0]["file"]
        assert dl_data["entries"][0]["sha256"] == pdf_art["sha256"]

        # Persisted PDF is immediately discoverable in /inputs
        inp = client.get("/api/workspaces/demo/inputs", headers=HEADERS).json()
        assert any(f["name"] == pdf_art["name"] for f in inp["files"])


def test_final2_attachment_bounded_read_identity_drift_and_real_data_analysis(tmp_path: Path):
    """Uploaded CSV content is identity-verified via descriptor, bounded-read into host context,
    and genuinely parsed by the model for analysis; drifted files are refused safely."""
    import re
    from bioharness_web import inputs

    # Scripted provider dynamically parses CSV rows from the host prompt to compute exact ratio!
    def data_aware_provider(messages, tools):
        tool_results = [m for m in messages if m.get("role") == "tool"]
        if len(tool_results) == 0:
            return tool("science_plan", {"plan": PLAN})
        if len(tool_results) == 1:
            return tool("science_submit", SUBMIT)
        if len(tool_results) == 2:
            full_prompt = json.dumps(messages, ensure_ascii=False)
            m = re.search(r"G1,([0-9.]+),([0-9.]+)", full_prompt)
            assert m is not None, f"CSV data row missing from model prompt: {full_prompt}"
            ratio = float(m.group(2)) / float(m.group(1))
            return tool(
                "science_deliver",
                {**DELIVER, "answer": f"Computed from uploaded counts.csv: G1_fold_change={ratio:.2f}x"},
            )
        return {"text": "Delivered analysis computed from actual uploaded CSV rows."}

    with Harness(tmp_path, data_aware_provider) as h:
        csv_path = h.workspace / "counts.csv"
        csv_bytes = b"gene,baseline,treatment\nG1,10.0,35.0\nG2,4.0,10.0\n"
        csv_path.write_bytes(csv_bytes)
        sha = hashlib.sha256(csv_bytes).hexdigest()

        q = "Compute fold change for G1 from attached counts."
        resp = h.client.post(
            h.url,
            headers=AUTH,
            json={"text": q, "attachments": [{"path": "$WORKSPACE/counts.csv", "sha256": sha}]},
        )
        assert resp.status_code == 201, resp.text
        cid = resp.json()["conversation"]["id"]
        state = h.wait(cid)
        now = h.now(state["conversation"]["request_id"])
        assert now["question"] == q
        assert "G1_fold_change=3.50x" in now["answer"]

        events = h.events(cid)
        read_ev = next(e for e in events if e["type"] == "attachments.read")
        assert read_ev["data"]["items"][0]["file_identity"] == "MATCHES_RECORD"
        assert read_ev["data"]["items"][0]["readable"] is True

        # Tamper file on disk -> read_attachment_for_model refuses drifted bytes!
        csv_path.write_bytes(b"gene,baseline,treatment\nG1,10.0,999.0\n")
        ws_obj = Workspace(id="demo", path=h.workspace.resolve(), evidence_roots=(h.workspace.resolve(),))
        drifted = inputs.read_attachment_for_model(
            ws_obj,
            {"name": "counts.csv", "server_path": "$WORKSPACE/counts.csv", "sha256": sha},
        )
        assert drifted["file_identity"] == "DIFFERS_FROM_RECORD"
        assert drifted["readable"] is False
        assert "excerpt" not in drifted


def test_final3_ledger_true_lifecycle_recovery_attribution_and_chat_isolation(tmp_path: Path):
    """Module invocations record STARTED -> terminal state with real timestamps, restart recovery
    to UNKNOWN, request/scope attribution, cross-workspace rejection, and zero chat last_run_state corruption."""
    from bioharness_web.ledger import Ledger

    led = Ledger(tmp_path / "ledger.sqlite3")
    try:
        c1 = led.create_conversation("ws-a", request_id="sci-req-1")
        chat_run = led.start_run(c1["id"])
        led.end_run(chat_run, "INTERRUPTED", "paused")

        # 1. Cross-workspace conversation_id must be rejected
        with pytest.raises(ValueError):
            led.start_module_operation(
                "ws-b", module_id="statistics", operation="render", conversation_id=c1["id"]
            )

        # 2. Two-phase lifecycle records STARTED (ended_at=None) then FAILED (real ended_at >= started_at)
        started = led.start_module_operation(
            "ws-a",
            module_id="statistics",
            operation="verify",
            input_data={"records_path": "r.json"},
            conversation_id=c1["id"],
            scope_id="proj-x",
        )
        assert started["state"] == "STARTED"
        assert started["ended_at"] is None
        assert started["request_id"] == "sci-req-1"
        assert started["scope_id"] == "proj-x"

        # Started-only op is NOT prematurely counted as finished usage
        assert led.observed_module_usage("ws-a")["total_tool_calls"] == 0

        finished_rec = led.finish_module_operation(
            started["id"],
            state="FAILED",
            error_data={"code": "REPORT_BINDING_FAIL", "message": "mismatch"},
        )
        assert finished_rec is not None
        assert finished_rec["state"] == "FAILED"
        assert finished_rec["ended_at"] is not None
        assert finished_rec["ended_at"] >= finished_rec["started_at"]

        # Failed module op must NOT overwrite chat conversation's INTERRUPTED last_run_state!
        convos = led.conversations("ws-a")
        assert convos[0]["last_run_state"] == "INTERRUPTED"

        # 3. In-flight STARTED module op recovers to UNKNOWN on service restart
        inflight = led.start_module_operation(
            "ws-a",
            module_id="protein-methods",
            operation="structure-inventory",
            conversation_id=c1["id"],
        )
        led.recover()
        invs = led.module_invocations("ws-a", limit=10)
        by_id = {i["id"]: i for i in invs}
        assert by_id[inflight["id"]]["state"] == "UNKNOWN"
        assert by_id[inflight["id"]]["ended_at"] is not None
        assert by_id[inflight["id"]]["error"]["code"] == "SERVICE_RESTARTED"
    finally:
        led.close()


def test_final4_preserve_real_cli_error_codes_and_no_speculative_inference(tmp_path: Path):
    """Missing or crashing statistics CLI must preserve TOOL_UNAVAILABLE (503) / TOOL_FAILED (502),
    never masking them as REPORT_BINDING_FAIL; configured [advisor] reports callable=None."""
    ws = tmp_path / "ws"
    (ws / ".bioharness").mkdir(parents=True)
    (ws / ".bioharness/config.toml").write_text('[advisor]\nfactory = "pkg:fn"\n', encoding="utf-8")
    (ws / "b.json").write_text('{"records":[],"tables":[]}', encoding="utf-8")
    (ws / "t.md").write_text("hi\n", encoding="utf-8")

    crash_cli = tmp_path / "crash_stat"
    crash_cli.write_text("#!/bin/sh\necho 'ImportError: broken env' >&2\nexit 2\n", encoding="utf-8")
    crash_cli.chmod(0o755)

    # Case A: missing CLI -> 503 TOOL_UNAVAILABLE
    s_missing = Settings(
        service_id="svc-f4a",
        workspaces={"demo": Workspace(id="demo", path=ws.resolve(), evidence_roots=(ws.resolve(),))},
        access_token=TOKEN,
        statistics_cli="/nonexistent/stat-cli",
    )
    with TestClient(create_app(s_missing)) as client:
        r = client.post(
            "/api/workspaces/demo/modules/statistics/report-binding",
            headers=HEADERS,
            json={"action": "render", "records_path": "b.json", "template_path": "t.md"},
        )
        assert r.status_code == 503, r.text
        assert r.json()["detail"]["code"] == "TOOL_UNAVAILABLE"

        dm = client.get("/api/workspaces/demo/domain-modules", headers=HEADERS).json()
        rev = next(m for m in dm["modules"] if m["id"] == "scientific-review")
        assert rev["advisor_config"]["configured"] is True
        assert rev["callable"] is None

    # Case B: crashing CLI (non-binding stderr) -> 502 TOOL_FAILED (never REPORT_BINDING_FAIL!)
    s_crash = Settings(
        service_id="svc-f4b",
        workspaces={"demo": Workspace(id="demo", path=ws.resolve(), evidence_roots=(ws.resolve(),))},
        access_token=TOKEN,
        statistics_cli=str(crash_cli),
    )
    with TestClient(create_app(s_crash)) as client:
        r = client.post(
            "/api/workspaces/demo/modules/statistics/report-binding",
            headers=HEADERS,
            json={"action": "render", "records_path": "b.json", "template_path": "t.md"},
        )
        assert r.status_code == 502, r.text
        assert r.json()["detail"]["code"] == "TOOL_FAILED"

def test_correctness_attachment_digest_and_excerpt_are_one_stream(tmp_path, monkeypatch):
    """Reproduces C16 without relying on a race timing or production file."""
    import os
    from bioharness_web import inputs
    path = tmp_path / "counts.csv"
    before = b"G1,10,20\n"
    after = b"G1,10,99\n"
    path.write_bytes(before)
    ws = Workspace(id="demo", path=tmp_path, evidence_roots=(tmp_path,))
    digest = hashlib.sha256(before).hexdigest()
    original = inputs._capture_fd_bounded

    def change_after_capture(fd, prefix_limit=0):
        result = original(fd, prefix_limit)
        path.write_bytes(after)
        return result

    monkeypatch.setattr(inputs, "_capture_fd_bounded", change_after_capture)
    result = inputs.read_attachment_for_model(
        ws, {"server_path": "$WORKSPACE/counts.csv", "sha256": digest}, max_chars=8_000)
    assert result["file_identity"] == "MATCHES_RECORD"
    assert result["excerpt"] == before.decode()
    assert result["sha256"] == digest

    monkeypatch.setattr(inputs, "_capture_fd_bounded", original)
    monkeypatch.setattr(inputs.evidence, "HASH_LIMIT_BYTES", 4)
    result = inputs.read_attachment_for_model(ws, {"server_path": "$WORKSPACE/counts.csv", "sha256": None})
    assert result["file_identity"] == "NOT_CHECKED" and not result["readable"]
    assert "excerpt" not in result

    # Grow a file after its initial stat, while hashing: no partial digest.
    path.write_bytes(b"abcd")
    fd = os.open(path, os.O_RDONLY)
    read = os.read
    try:
        def grow(f, size):
            chunk = read(f, size)
            if f == fd and chunk:
                with path.open("ab") as fh:
                    fh.write(b"x")
            return chunk
        monkeypatch.setattr(inputs.os, "read", grow)
        digest, prefix, _ = original(fd, 4)
        assert digest is None and prefix == b""
    finally:
        os.close(fd)


def test_correctness_attachment_budget_and_large_reference(tmp_path, monkeypatch):
    from bioharness_web import inputs
    path = tmp_path / "large.csv"
    data = b"g,a,b\n" * 4000
    path.write_bytes(data)
    ws = Workspace(id="demo", path=tmp_path, evidence_roots=(tmp_path,))
    attachment = {"server_path": "$WORKSPACE/large.csv", "sha256": hashlib.sha256(data).hexdigest()}
    verified = inputs.read_attachment_for_model(ws, attachment, max_chars=16000)
    assert verified["truncated"] and verified["chars_read"] <= 8000
    exhausted = inputs.read_attachment_for_model(ws, attachment, max_chars=0)
    assert exhausted["file_identity"] == "MATCHES_RECORD" and not exhausted["readable"]
    monkeypatch.setattr(inputs.evidence, "HASH_LIMIT_BYTES", 10)
    bound = inputs.validate_attachments(ws, [attachment])[0]
    assert bound["hash_skipped"] and bound["file_identity"] == "NOT_CHECKED"
    assert bound["sha256"] == attachment["sha256"]
    assert not inputs.read_attachment_for_model(ws, bound)["readable"]


def test_correctness_literature_exact_paths_and_partial_retention(tmp_path):
    from bioharness_web import domain_modules
    ws_root = tmp_path / "workspace"
    upload = ws_root / "inputs"
    upload.mkdir(parents=True)
    ws = Workspace(id="demo", path=ws_root, evidence_roots=(ws_root,), upload_root=upload)
    output = tmp_path / "output"
    for sub, data in (("a", b"%PDF-1.4\nA"), ("b", b"%PDF-1.4\nB")):
        (output / sub).mkdir(parents=True)
        (output / sub / "same.pdf").write_bytes(data)
    data_a = (output / "a/same.pdf").read_bytes()
    data_b = (output / "b/same.pdf").read_bytes()
    payload = {"downloaded_identifiers": 4, "entries": [
        {"identifier": "a", "status": "downloaded", "file": "a/same.pdf", "sha256": hashlib.sha256(data_a).hexdigest()},
        {"identifier": "b", "status": "downloaded", "file": "b/same.pdf", "sha256": hashlib.sha256(data_b).hexdigest()},
        {"identifier": "missing", "status": "downloaded", "file": "missing/same.pdf"},
        {"identifier": "wrong-digest", "status": "downloaded", "file": "a/same.pdf", "sha256": "0" * 64},
    ]}
    saved, result = domain_modules._persist_literature_pdfs(ws, output, payload, max_upload_bytes=100)
    assert len(saved) == 2 and result["retention"]["status"] == "PARTIAL"
    assert result["retention"]["retained_identifiers"] == 2
    assert result["retention"]["not_retained_identifiers"] == 2
    assert result["entries"][0]["sha256"] != result["entries"][1]["sha256"]
    assert result["entries"][2]["file"] is None and result["entries"][3]["file"] is None
    assert result["downloaded_identifiers"] == 4
    assert payload["entries"][2]["file"] == "missing/same.pdf"
    _, absent = domain_modules._persist_literature_pdfs(ws, output, {"ok": True}, max_upload_bytes=100)
    assert absent["retention"]["status"] == "MANIFEST_UNAVAILABLE"


def test_correctness_module_owner_validation(tmp_path, monkeypatch):
    from unittest.mock import AsyncMock
    from bioharness_web import domain_modules
    from bioharness_web.ledger import Ledger
    from bioharness_web.sources import Sources
    led = Ledger(":memory:")
    try:
        convo = led.create_conversation("demo", "request-A")
        with pytest.raises(ValueError, match="bound request"):
            led.start_module_operation("demo", module_id="statistics", operation="render",
                                       conversation_id=convo["id"], request_id="request-B")
        assert not led.module_invocations("demo")
    finally:
        led.close()
    ws = tmp_path / "ws"
    ws.mkdir()
    settings = Settings(service_id="owner-test", workspaces={"demo": Workspace(id="demo", path=ws, evidence_roots=(ws,))},
                        access_token=TOKEN)
    raw = AsyncMock(return_value=None)
    call = AsyncMock(return_value={"status": "INSPECTED_ONLY"})
    monkeypatch.setattr(Sources, "raw", raw)
    monkeypatch.setattr(domain_modules, "run_statistics_report_binding", call)
    with TestClient(create_app(settings)) as client:
        response = client.post("/api/workspaces/demo/modules/statistics/report-binding", headers=HEADERS,
                               json={"action": "inspect", "records_path": "r.json",
                                     "request_id": "unverified-request", "scope_id": "unverified-scope"})
        assert response.status_code == 200
        assert response.json()["owner_binding"] == {"conversation_id": None, "request_id": None, "scope_id": None}
        assert response.json()["save_note"]
        assert call.call_args.kwargs["request_id"] is None
        raw.return_value = {"ok": True, "request_id": "real-request", "scope_context": {"scope_id": "actual-scope"}}
        response = client.post("/api/workspaces/demo/modules/statistics/report-binding", headers=HEADERS,
                               json={"action": "inspect", "records_path": "r.json",
                                     "request_id": "real-request", "scope_id": "wrong-scope"})
        assert response.status_code == 200
        assert response.json()["owner_binding"]["scope_id"] == "actual-scope"


def test_correctness_memory_source_is_not_silently_replaced(tmp_path, monkeypatch):
    import asyncio
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    from bioharness_web import capabilities
    from bioharness_web.cli import ToolError
    ws = Workspace(id="demo", path=tmp_path, evidence_roots=(tmp_path,))
    settings = SimpleNamespace(mcp_servers={"memory-a": ["a"], "memory-b": ["b"]},
                               tool_timeout_seconds=5, tool_env_passthrough=(), module_tool_timeout_seconds=5)
    specs = [SimpleNamespace(name="memory_recall"), SimpleNamespace(name="memory_status"),
             SimpleNamespace(name="memory_expand")]
    async def list_tools(argv, **kwargs):
        if argv[0] == "a":
            raise ToolError("TOOL_UNAVAILABLE", "a unavailable")
        return specs
    monkeypatch.setattr(capabilities.mcp_tools, "list_tools", list_tools)
    call = AsyncMock(return_value={"structured_content": {"memory_ref": "mem@1"}})
    monkeypatch.setattr(capabilities.mcp_tools, "call_tool", call)
    with pytest.raises(capabilities.CapabilityError):
        asyncio.run(capabilities.call_memory_tool(settings, ws, "memory_expand", {"memory_ref": "mem@1"}, server="memory-a"))
    assert call.await_count == 0
    name, _, _ = asyncio.run(capabilities.call_memory_tool(settings, ws, "memory_expand", {"memory_ref": "mem@1"}, server="memory-b"))
    assert name == "memory-b" and call.await_count == 1
