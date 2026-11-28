"""R3.2 backend tests: bounded research-input uploads, per-run model override, real host strategies, and readable history."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient

from bioharness_web.app import create_app
from bioharness_web.ledger import Ledger
from bioharness_web.model_config import ModelConfigStore, UpdateModelConfigBody
from bioharness_web.runtime import run_strategies
from bioharness_web.settings import ModelSettings, Settings, Workspace, parse_workspaces

TOKEN = "r3-test-token-0123456789abcdef"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}


def _make_settings(tmp_path: Path, *, with_upload: bool = True, with_runtime: bool = False) -> Settings:
    ws_dir = tmp_path / "ws"
    ws_dir.mkdir(exist_ok=True)
    (ws_dir / ".bioharness").mkdir(exist_ok=True)
    (ws_dir / "existing_counts.tsv").write_text("gene\tcount\nG1\t10\n", encoding="utf-8")
    upload_dir = None
    if with_upload:
        upload_dir = ws_dir / "inputs"
        upload_dir.mkdir(exist_ok=True)
    ws = Workspace(id="demo", path=ws_dir.resolve(), evidence_roots=(ws_dir.resolve(),), upload_root=upload_dir.resolve() if upload_dir else None)
    model = None
    ledger = None
    if with_runtime:
        model = ModelSettings(base_url="http://127.0.0.1:9/v1", api_key="sk-default-secret-1111", name="model-default")
        state_dir = tmp_path / "state"
        state_dir.mkdir(exist_ok=True)
        ledger = state_dir / "ledger.sqlite3"
    return Settings(
        service_id="svc-r3",
        workspaces={"demo": ws},
        access_token=TOKEN,
        model=model,
        ledger_path=ledger,
        max_upload_bytes=1024 * 64,
    )


def test_parse_workspaces_upload_root_validation(tmp_path: Path):
    ws = tmp_path / "proj"
    ws.mkdir()
    (ws / ".bioharness").mkdir()
    uploads = ws / "inputs"
    uploads.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()

    parsed = parse_workspaces(json.dumps({"p": {"path": str(ws), "upload_root": str(uploads)}}))
    assert parsed["p"].upload_root == uploads.resolve()

    with pytest.raises(ValueError, match="evidence_roots"):
        parse_workspaces(json.dumps({"p": {"path": str(ws), "upload_root": str(outside)}}))

    with pytest.raises(ValueError, match=r"\.bioharness"):
        parse_workspaces(json.dumps({"p": {"path": str(ws), "upload_root": str(ws / ".bioharness")}}))


def test_inputs_upload_disabled_is_honest_and_listing_stays_readonly(tmp_path: Path):
    settings = _make_settings(tmp_path, with_upload=False)
    app = create_app(settings)
    with TestClient(app) as client:
        meta = client.get("/api/meta", headers=HEADERS).json()
        assert meta["workspace_details"]["demo"]["upload_enabled"] is False

        listed = client.get("/api/workspaces/demo/inputs", headers=HEADERS)
        assert listed.status_code == 200
        body = listed.json()
        assert body["upload_enabled"] is False
        assert body["upload_disabled_reason"]
        assert any(f["name"] == "existing_counts.tsv" and f["server_path"] == "$WORKSPACE/existing_counts.tsv" for f in body["files"])

        refused = client.post(
            "/api/workspaces/demo/inputs",
            headers={**HEADERS, "X-BioHarness-Filename": "sample.csv"},
            content=b"a,b\n1,2\n",
        )
        assert refused.status_code == 403
        assert refused.json()["detail"]["code"] == "UPLOAD_NOT_CONFIGURED"


def test_inputs_upload_csv_fasta_pdf_no_overwrite_and_security_guards(tmp_path: Path):
    settings = _make_settings(tmp_path, with_upload=True)
    app = create_app(settings)
    with TestClient(app) as client:
        samples = [
            ("counts.csv", b"gene,tpm\nAtGRF1,42.5\n", "PPGR"),
            ("seqs.fasta", b">seq1\nATGCGTACGT\n", "PPGR"),
            ("paper.pdf", b"%PDF-1.4\n%synthetic\n", None),
        ]
        for name, payload, scope in samples:
            hdrs = {**HEADERS, "X-BioHarness-Filename": quote(name)}
            if scope:
                hdrs["X-BioHarness-Scope"] = quote(scope)
            resp = client.post("/api/workspaces/demo/inputs", headers=hdrs, content=payload)
            assert resp.status_code == 201, resp.text
            data = resp.json()
            assert data["name"] == name
            assert data["bytes"] == len(payload)
            assert data["sha256"] == hashlib.sha256(payload).hexdigest()
            assert data["evidence_verified"] is False
            assert data["server_path"].startswith("$WORKSPACE/inputs/")
            assert str(tmp_path) not in data["server_path"]

        # Duplicate upload must NEVER overwrite existing research data
        dup = client.post(
            "/api/workspaces/demo/inputs",
            headers={**HEADERS, "X-BioHarness-Filename": "counts.csv", "X-BioHarness-Scope": "PPGR"},
            content=b"mutated",
        )
        assert dup.status_code == 409
        assert dup.json()["detail"]["code"] == "INPUT_ALREADY_EXISTS"

        # Disallowed extension, traversal, oversized payload rejected
        for bad_name, expected_status in [("../evil.csv", 422), (".hidden.csv", 422), ("run.sh", 415)]:
            r = client.post(
                "/api/workspaces/demo/inputs",
                headers={**HEADERS, "X-BioHarness-Filename": quote(bad_name)},
                content=b"data",
            )
            assert r.status_code == expected_status

        too_big = client.post(
            "/api/workspaces/demo/inputs",
            headers={**HEADERS, "X-BioHarness-Filename": "huge.csv"},
            content=b"x" * (settings.max_upload_bytes + 1),
        )
        assert too_big.status_code == 413

        # Symlink inside upload root is rejected
        target_outside = tmp_path / "outside.csv"
        target_outside.write_text("secret", encoding="utf-8")
        os.symlink(target_outside, settings.workspaces["demo"].upload_root / "link.csv")
        sym = client.post(
            "/api/workspaces/demo/inputs",
            headers={**HEADERS, "X-BioHarness-Filename": "link.csv"},
            content=b"a,b\n",
        )
        assert sym.status_code in (400, 409)

        # Listing includes uploaded inputs and excludes symlinks/.bioharness
        listed = client.get("/api/workspaces/demo/inputs", headers=HEADERS).json()
        names = {f["name"] for f in listed["files"]}
        assert {"counts.csv", "seqs.fasta", "paper.pdf", "existing_counts.tsv"}.issubset(names)
        assert "link.csv" not in names


def test_model_override_validation_and_strategies(tmp_path: Path):
    settings = _make_settings(tmp_path, with_upload=False, with_runtime=True)
    store = ModelConfigStore(settings)
    store.update(UpdateModelConfigBody.model_validate({
        "providers": [
            {
                "id": "p1",
                "name": "Primary",
                "protocol": "openai-compatible",
                "base_url": "http://127.0.0.1:9999/v1",
                "api_key": "sk-p1-secret-9999",
                "models": ["gpt-fast", "gpt-deep"],
                "enabled": True,
            },
            {
                "id": "p2",
                "name": "Disabled",
                "protocol": "openai-compatible",
                "base_url": "http://127.0.0.1:9998/v1",
                "api_key": "sk-p2-secret-8888",
                "models": ["hidden-model"],
                "enabled": False,
            },
        ],
        "slots": {"chat": {"provider_id": "p1", "model": "gpt-fast"}},
    }))

    avail = store.available_models()
    assert [(m["provider_id"], m["model"]) for m in avail] == [("p1", "gpt-fast"), ("p1", "gpt-deep")]

    resolved = store.resolve_model_override("p1", "gpt-deep")
    assert resolved.name == "gpt-deep"
    assert resolved.api_key == "sk-p1-secret-9999"

    with pytest.raises(Exception):
        store.resolve_model_override("p2", "hidden-model")
    with pytest.raises(Exception):
        store.resolve_model_override("p1", "unconfigured-model")

    strats = {s["id"]: s for s in run_strategies(settings)}
    assert set(strats) == {"standard", "concise", "thorough"}
    assert strats["concise"]["max_turns"] < strats["standard"]["max_turns"]
    assert strats["thorough"]["max_turns"] >= strats["standard"]["max_turns"]


def test_ledger_conversations_returns_readable_first_message_and_updated_at(tmp_path: Path):
    ledger = Ledger(tmp_path / "ledger.sqlite3")
    try:
        c = ledger.create_conversation("demo", request_id="sci-20261128-abc123")
        run_id = ledger.start_run(c["id"])
        ledger.append(c["id"], run_id, "run.started", {"model": "gpt-deep", "strategy": "thorough"})
        ledger.append(c["id"], run_id, "user.message", {"text": "比较 PPGR 转录组处理组与对照组的差异表达\n第二行细节"})
        rows = ledger.conversations("demo")
        assert len(rows) == 1
        assert rows[0]["first_message"] == "比较 PPGR 转录组处理组与对照组的差异表达"
        assert rows[0]["last_model"] == "gpt-deep"
        assert rows[0]["last_strategy"] == "thorough"
        assert rows[0]["updated_at"]
    finally:
        ledger.close()
