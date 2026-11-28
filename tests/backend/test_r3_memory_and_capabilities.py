'''R3.3 backend integration tests against real installed bioharness-memory-mcp,
bioharness-host, and bioharness-governance CLIs in isolated temporary directories.
'''
from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from bioharness_web.app import create_app
from bioharness_web.ledger import Ledger
from bioharness_web.settings import ModelSettings, Settings, Workspace

TOKEN = "r33-test-token-0123456789abcdef"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}
MEMORY_PYTHON = Path("/home/yangs/.local/share/bioharness-modules/memory/current/venv/bin/python")


def _build_isolated_memory_env(base: Path) -> tuple[dict[str, str], str, str]:
    '''Create a real isolated Memory SQLite ledger + SourceAnchor manifest + inbox.'''
    mem_dir = base / "memory"
    src_dir = mem_dir / "sources"
    src_dir.mkdir(parents=True)
    mem_dir.chmod(0o700)
    src_dir.chmod(0o700)
    source_file = src_dir / "ppgr_notes.md"
    source_bytes = (
        "PPGR_LINE_1: Use DESeq2 with Wald test and BH FDR < 0.05 on >= 3 biological replicates.\n"
        "PPGR_LINE_2: Do not pool technical replicates as independent biological replicates.\n"
    ).encode("utf-8")
    source_file.write_bytes(source_bytes)
    source_file.chmod(0o600)
    source_sha = hashlib.sha256(source_bytes).hexdigest()
    manifest = mem_dir / "source_manifest.json"
    manifest.write_text(
        json.dumps({
            "scope_ref": "scope:ppgr-r33",
            "source_id": "notes",
            "source_count": 1,
            "sources": [
                {
                    "snapshot": "ppgr_notes.md",
                    "source_id": "notes",
                    "bytes": len(source_bytes),
                    "sha256": source_sha,
                }
            ],
        }),
        encoding="utf-8",
    )
    manifest.chmod(0o600)
    db_path = mem_dir / "memory.sqlite3"
    inbox_path = mem_dir / "candidates.jsonl"
    inbox_path.touch()
    os.chmod(inbox_path, 0o600)

    seed_script = '''
import sys
from pathlib import Path
from bioharness_memory.curation import (
    CuratorDecision,
    CuratorEvidence,
    CuratorProposal,
    ThemeProposal,
    publish_reviewed,
    publish_theme,
)
from bioharness_memory.ledger import MemoryLedger
from bioharness_memory.sources.native_text import NativeLineSource
from bioharness_memory.themes import MemoryThemes

db_path, src_dir = Path(sys.argv[1]), Path(sys.argv[2])
ledger = MemoryLedger(db_path, scope_ref="scope:ppgr-r33", create=True)
source = NativeLineSource(
    root=src_dir,
    source_id="notes",
    allowed_files=("ppgr_notes.md",),
    allow_text=True,
)
rec1 = source.resolve(relative_path="ppgr_notes.md", record_index=1)
assert rec1.text is not None
t2 = {"method": "DESeq2 Wald + BH FDR", "threshold": "padj < 0.05", "min_replicates": 3}
prop = CuratorProposal(
    memory_id="mem:ppgr-deseq2",
    revision=1,
    scope_ref="scope:ppgr-r33",
    t1_core="Use DESeq2 Wald + BH FDR < 0.05 with >= 3 biological replicates",
    t2_detail=t2,
    required_conditions={"research_area": "plant_motif_evolution"},
    evidence=(CuratorEvidence(anchor=rec1.source_anchor, exact_excerpt=rec1.text.strip()),),
)
decision = CuratorDecision(
    proposal_sha256=prop.digest(),
    disposition="accept_as_reported",
    reviewer_ref="reviewer:r33-fixture",
    rationale="Verified exact line anchor in isolated fixture.",
)
publish_reviewed(
    prop,
    decision,
    source=source,
    ledger=ledger,
    event_id="evt-seed-mem-1",
    expected_revision=0,
)
themes = MemoryThemes(ledger)
basis = themes.summary_basis("t1:rnaseq-de", scope_ref="scope:ppgr-r33", add_members=("mem:ppgr-deseq2",))
tprop = ThemeProposal(
    t1_id="t1:rnaseq-de",
    base_revision=0,
    scope_ref="scope:ppgr-r33",
    title="RNA-seq Differential Expression",
    scope="Statistical best practices for plant RNA-seq differential analysis",
    cues=("DESeq2", "replicates", "FDR"),
    summary="Require >=3 biological replicates and BH FDR control.",
    summary_member_digest=basis,
    add_members=("mem:ppgr-deseq2",),
)
tdec = CuratorDecision(
    proposal_sha256=tprop.digest(),
    disposition="accept_as_reported",
    reviewer_ref="reviewer:r33-fixture",
    rationale="Verified theme membership against seeded revision.",
)
publish_theme(
    tprop,
    tdec,
    themes=themes,
    ledger=ledger,
    event_id="evt-seed-theme-1",
)
'''
    proc = subprocess.run(
        [str(MEMORY_PYTHON), "-c", seed_script, str(db_path), str(src_dir)],
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, f"seed_script failed: {proc.stderr}\n{proc.stdout}"
    wrapper = mem_dir / "run_memory_mcp.sh"
    wrapper.write_text(
        f'''#!/bin/sh
set -eu
export BIOHARNESS_MEMORY_DB="{db_path}"
export BIOHARNESS_MEMORY_SOURCE_ROOT="{src_dir}"
export BIOHARNESS_MEMORY_MANIFEST="{manifest}"
export BIOHARNESS_MEMORY_INBOX="{inbox_path}"
exec "{MEMORY_PYTHON}" -m bioharness_memory.mcp_server "$@"
''',
        encoding="utf-8",
    )
    wrapper.chmod(0o700)
    return {"wrapper": str(wrapper), "inbox": str(inbox_path)}, "mem:ppgr-deseq2@1", "t1:rnaseq-de@1"


def test_r33_memory_real_mcp_pipeline_and_honest_gaps(tmp_path: Path):
    if not MEMORY_PYTHON.is_file():
        pytest.skip("bioharness-module-memory runtime not installed")

    mem_env, mem_ref, t1_ref = _build_isolated_memory_env(tmp_path)
    ws_dir = tmp_path / "ws"
    ws_dir.mkdir()
    state_dir = tmp_path / "state"
    state_dir.mkdir()

    settings = Settings(
        service_id="svc-r33",
        workspaces={"demo": Workspace(id="demo", path=ws_dir.resolve(), evidence_roots=(ws_dir.resolve(),))},
        access_token=TOKEN,
        model=ModelSettings(base_url="http://127.0.0.1:9/v1", api_key="sk-r33-secret-0000", name="test-model"),
        ledger_path=state_dir / "ledger.sqlite3",
        mcp_servers={"bioharness-memory": (mem_env["wrapper"],)},
    )
    with TestClient(create_app(settings)) as client:
        st = client.get("/api/workspaces/demo/memory/status", headers=HEADERS)
        assert st.status_code == 200, st.text
        body = st.json()
        assert body["callable"] is True
        assert body["server"] == "bioharness-memory"
        assert body["status"]["active_memory_count"] == 1
        assert body["capabilities"]["recall_modes"] == {"FAST": True, "STANDARD": True, "DEEP": False}
        assert body["capabilities"]["curator_interactive_publish"] is False
        assert "BioHarness-Modules" in body["capabilities"]["curator_gap_note"]

        rc = client.post(
            "/api/workspaces/demo/memory/recall",
            headers=HEADERS,
            json={"query": "DESeq2 biological replicates", "task_conditions": {"research_area": "plant_motif_evolution"}, "mode": "FAST"},
        )
        assert rc.status_code == 200, rc.text
        res = rc.json()["result"]
        assert res["backend"] in ("FTS5", "FTS5_FALLBACK", "EMBEDDING", "EXACT")
        assert any(c["memory_ref"] == mem_ref for c in res["candidates"])
        assert any(t["t1_ref"] == t1_ref for t in res["themes"])

        deep = client.post(
            "/api/workspaces/demo/memory/recall",
            headers=HEADERS,
            json={"query": "DESeq2", "mode": "DEEP"},
        )
        assert deep.status_code == 501
        assert deep.json()["detail"]["code"] == "RECALL_MODE_NOT_IMPLEMENTED"

        ex1 = client.post(
            "/api/workspaces/demo/memory/expand",
            headers=HEADERS,
            json={"memory_ref": t1_ref, "task_conditions": {"research_area": "plant_motif_evolution"}, "detail": "T1"},
        )
        assert ex1.status_code == 200
        assert ex1.json()["result"]["members"][0]["memory_ref"] == mem_ref

        ex2 = client.post(
            "/api/workspaces/demo/memory/expand",
            headers=HEADERS,
            json={"memory_ref": mem_ref, "task_conditions": {"research_area": "plant_motif_evolution"}, "detail": "T2"},
        )
        assert ex2.status_code == 200
        assert ex2.json()["result"]["content"]["method"] == "DESeq2 Wald + BH FDR"

        ex3 = client.post(
            "/api/workspaces/demo/memory/expand",
            headers=HEADERS,
            json={"memory_ref": mem_ref, "task_conditions": {"research_area": "plant_motif_evolution"}, "detail": "T3"},
        )
        assert ex3.status_code == 200
        sources_list = ex3.json()["result"]["sources"]
        assert len(sources_list) == 1
        assert sources_list[0]["relative_path"] == "ppgr_notes.md"
        assert sources_list[0]["line"] == 1
        assert sources_list[0]["source_revision"].startswith("sha256:")
        assert sources_list[0]["record_sha256"].startswith("sha256:")
        assert sources_list[0]["text"] is None

        prop = client.post(
            "/api/workspaces/demo/memory/propose",
            headers=HEADERS,
            json={
                "kind": "candidate",
                "event_id": "evt-r33-cand-1",
                "summary": "Check GC bias before comparing expression levels across replicates.",
                "evidence_locator": "ppgr_notes.md#L2",
            },
        )
        assert prop.status_code == 200, prop.text
        assert prop.json()["result"]["status"] == "UNREVIEWED_PENDING_IMPORT"

        rep = client.post(
            "/api/workspaces/demo/memory/report-use",
            headers=HEADERS,
            json={
                "event_id": "evt-r33-use-1",
                "memory_ref": mem_ref,
                "task_ref": "sci-20261128-r33demo",
                "stage": "consumed",
            },
        )
        assert rep.status_code == 200, rep.text

        diag = client.get("/api/workspaces/demo/memory/status", headers=HEADERS).json()["diagnose"]
        assert diag["pending_candidates"]["count"] == 1
        assert diag["use_feedback"]["consumed"] == 1


def test_r33_skills_resources_documents_four_states_and_diagnostics(tmp_path: Path):
    ws_dir = tmp_path / "ws"
    ws_dir.mkdir()
    state_dir = tmp_path / "state"
    state_dir.mkdir()

    sk_dir = ws_dir / ".claude" / "skills" / "rna-qc"
    sk_dir.mkdir(parents=True)
    (sk_dir / "SKILL.md").write_text(
        "---\nname: rna-qc\ndescription: Check FASTQ quality and replicate balance\n---\n# RNA QC\n",
        encoding="utf-8",
    )
    (ws_dir / "STATUS.md").write_text("# Project Status\nAll samples verified.\n", encoding="utf-8")

    subprocess.run(
        ["bioharness-host", "call", f"--workspace={ws_dir}", "science_begin", "-"],
        input=json.dumps({"question": "Verify PPGR resources and docs", "scope": {"id": "PPGR", "create": True}}),
        check=True,
        capture_output=True,
        text=True,
    )
    cfg = ws_dir / ".bioharness" / "config.toml"
    cfg.write_text(
        '''[[resources]]
id = "echo-mod"
kind = "workflow"
title = "Echo module"
how_to_use = "Call structured tool"
''',
        encoding="utf-8",
    )
    cfg.chmod(0o600)

    ledger_path = state_dir / "ledger.sqlite3"
    ledger = Ledger(ledger_path)
    convo = ledger.create_conversation("demo")
    run_id = ledger.start_run(convo["id"])
    op_id = ledger.start_operation(run_id, "tool", "structured")
    ledger.end_operation(op_id, "SUCCEEDED")
    ledger.append(convo["id"], run_id, "tool.started", {"server": "echo-mod", "name": "structured"})
    ledger.close()

    echo_server = str(Path(__file__).resolve().parents[1] / "support" / "echo_mcp.py")
    settings = Settings(
        service_id="svc-cap",
        workspaces={"demo": Workspace(id="demo", path=ws_dir.resolve(), evidence_roots=(ws_dir.resolve(),))},
        access_token=TOKEN,
        model=ModelSettings(base_url="http://127.0.0.1:9/v1", api_key="sk-secret-dont-leak-9999", name="test-model"),
        ledger_path=ledger_path,
        mcp_servers={"echo-mod": (sys.executable, echo_server)},
    )

    with TestClient(create_app(settings)) as client:
        resp = client.get(
            "/api/workspaces/demo/capabilities",
            params={"scope_id": "PPGR", "probe_mcp": "true"},
            headers=HEADERS,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["core_state_present"] is True
        assert any(s["id"] == "rna-qc" and s["installed"] is True for s in data["skills"])
        assert any(r["id"] == "echo-mod" and r["declared"] and r["callable"] and r["actually_used"] for r in data["resources"])
        assert "status" in data["documents"]["loaded"]
        assert "All samples verified" in data["documents"]["loaded"]["status"]["preview"]
        assert data["compute"]["remote_compute_enabled"] is False

        diag = client.get("/api/workspaces/demo/diagnostics", headers=HEADERS)
        assert diag.status_code == 200
        dbody = diag.json()
        assert dbody["security_posture"]["provider_keys_server_side_only"] is True
        assert "sk-secret-dont-leak-9999" not in diag.text
        assert TOKEN not in diag.text
