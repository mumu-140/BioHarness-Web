"""R3.4 backend integration tests against real installed BioHarness professional modules:
bioharness-statistics-report-binding, bioharness-protein-methods, bioharness-literature,
and scientific-review / non-runnable module boundaries.
"""
from __future__ import annotations

import json
import os
import shutil
import stat
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from bioharness_web.app import create_app
from bioharness_web.settings import ModelSettings, Settings, Workspace

TOKEN = "r34-test-token-0123456789abcdef"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}


def _find_cli(name: str) -> str | None:
    found = shutil.which(name)
    if found:
        return found
    local_bin = Path("/home/yangs/.local/bin") / name
    return str(local_bin) if local_bin.is_file() else None


def test_r34_domain_modules_discovery_and_honest_boundaries(tmp_path: Path):
    ws = tmp_path / "ws"
    ws.mkdir()
    (ws / "sample.json").write_text("{}", encoding="utf-8")
    (ws / "mini.pdb").write_text("END\n", encoding="utf-8")
    state = tmp_path / "state"
    state.mkdir()

    settings = Settings(
        service_id="svc-r34",
        workspaces={"demo": Workspace(id="demo", path=ws.resolve(), evidence_roots=(ws.resolve(),))},
        access_token=TOKEN,
        literature_cli=_find_cli("bioharness-literature") or "bioharness-literature",
        statistics_cli=_find_cli("bioharness-statistics-report-binding") or "bioharness-statistics-report-binding",
        protein_cli=_find_cli("bioharness-protein-methods") or "bioharness-protein-methods",
        paperseek_cli="/nonexistent/paperseek",
        scansci_cli="/nonexistent/scansci-pdf",
    )
    with TestClient(create_app(settings)) as client:
        res = client.get("/api/workspaces/demo/domain-modules", headers=HEADERS)
        assert res.status_code == 200, res.text
        data = res.json()
        by_id = {m["id"]: m for m in data["modules"]}

        assert by_id["literature"]["providers"]["paperqa2"]["status"] == "NOT_PRODUCTION_ENABLED"
        assert by_id["literature"]["providers"]["paperseek"]["available"] is False
        assert by_id["statistics"]["subcomponents"]["clinical_subgroup_reviewers"] == "PRODUCTION_NOT_ENABLED"
        assert "BioHarness-Modules" in by_id["scientific-review"]["direct_model_api_gap_note"]
        assert "[advisor]" in by_id["scientific-review"]["direct_model_api_gap_note"]
        assert by_id["dapseq"]["callable"] is False
        assert "NOT_PUBLISHED" in by_id["dapseq"]["status"]
        assert by_id["genome-web-tf"]["callable"] is False
        assert "NOT_RUNNABLE" in by_id["genome-web-tf"]["status"]
        assert by_id["sequence"]["callable"] is False
        assert "NOT_RUNNABLE" in by_id["sequence"]["status"]
        assert "sample.json" in data["workspace_files"]["json"]
        assert "mini.pdb" in data["workspace_files"]["structures"]

        # Running literature search when paperseek is absent must honestly return 503
        missing = client.post(
            "/api/workspaces/demo/modules/literature/run",
            headers=HEADERS,
            json={"operation": "search", "question": "plant GRF motif evolution"},
        )
        assert missing.status_code == 503
        assert missing.json()["detail"]["code"] == "UPSTREAM_UNAVAILABLE"


def test_r34_statistics_real_report_binding_render_verify_and_drift(tmp_path: Path):
    stat_cli = _find_cli("bioharness-statistics-report-binding")
    if not stat_cli:
        pytest.skip("bioharness-statistics-report-binding not installed")

    ws = tmp_path / "ws"
    ws.mkdir()
    bundle = {
        "records": [
            {
                "metric_id": "mut_rate",
                "unit": "proportion",
                "value": 6 / 40,
                "numerator": 6,
                "denominator": 40,
                "event": {"alteration": "ESR1_mut"},
                "given": {"cohort": "HRpos_post_tx"},
                "population": "cohort=HRpos_post_tx",
                "stratum": "alteration=ESR1_mut",
                "method": "Exact binomial Wilson 95% CI",
                "display_decimals": 1,
            },
            {
                "metric_id": "treated_n",
                "kind": "count",
                "unit": "count",
                "value": 40,
                "population": "cohort=HRpos_post_tx",
                "stratum": "all_patients",
                "method": "patient_deduplicated_count",
            },
            {
                "metric_id": "de_or",
                "kind": "model_metric",
                "unit": "odds_ratio",
                "value": 2.45,
                "ci_low": 1.32,
                "ci_high": 4.55,
                "ci_level": 0.95,
                "p_value": 0.004,
                "fdr": 0.018,
                "population": "cohort=HRpos_post_tx",
                "stratum": "ESR1_vs_WT",
                "method": "Logistic regression + BH FDR",
                "status": "significant",
            },
        ],
        "tables": [],
    }
    (ws / "stats_bundle.json").write_text(json.dumps(bundle, indent=2), encoding="utf-8")
    (ws / "answer.template.md").write_text(
        "Cohort size: {{stat:treated_n}}. Rate: {{stat:mut_rate}}. Effect: {{stat:de_or}}.\n",
        encoding="utf-8",
    )

    settings = Settings(
        service_id="svc-r34-stat",
        workspaces={"demo": Workspace(id="demo", path=ws.resolve(), evidence_roots=(ws.resolve(),))},
        access_token=TOKEN,
        statistics_cli=stat_cli,
    )
    with TestClient(create_app(settings)) as client:
        # 1. Deterministic render via real CLI
        r = client.post(
            "/api/workspaces/demo/modules/statistics/report-binding",
            headers=HEADERS,
            json={
                "action": "render",
                "records_path": "stats_bundle.json",
                "template_path": "answer.template.md",
            },
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["status"] == "PASS"
        assert body["binding"]["bound_statements"] == 3
        assert "15.0%(6/40)" in body["rendered_markdown"]
        assert len(body["records"]) == 3

        # 2. Save exact rendered output and verify PASS
        (ws / "answer.txt").write_text(body["rendered_markdown"], encoding="utf-8")
        v_ok = client.post(
            "/api/workspaces/demo/modules/statistics/report-binding",
            headers=HEADERS,
            json={
                "action": "verify",
                "records_path": "stats_bundle.json",
                "template_path": "answer.template.md",
                "report_path": "answer.txt",
            },
        )
        assert v_ok.status_code == 200
        assert v_ok.json()["status"] == "PASS"

        # 3. Tamper with a single number and confirm verify FAIL
        (ws / "answer_drifted.txt").write_text(
            body["rendered_markdown"].replace("15.0%(6/40)", "18.0%(6/40)"),
            encoding="utf-8",
        )
        v_fail = client.post(
            "/api/workspaces/demo/modules/statistics/report-binding",
            headers=HEADERS,
            json={
                "action": "verify",
                "records_path": "stats_bundle.json",
                "template_path": "answer.template.md",
                "report_path": "answer_drifted.txt",
            },
        )
        assert v_fail.status_code == 200
        assert v_fail.json()["status"] == "FAIL"
        assert v_fail.json()["error"]["code"] == "REPORT_BINDING_FAIL"


def test_r34_protein_methods_real_structure_inventory_and_path_containment(tmp_path: Path):
    pm_cli = _find_cli("bioharness-protein-methods")
    if not pm_cli:
        pytest.skip("bioharness-protein-methods not installed")

    ws = tmp_path / "ws"
    ws.mkdir()
    outside = tmp_path / "outside_secret.pdb"
    outside.write_text("SECRET\n", encoding="utf-8")
    os.symlink(outside, ws / "escape.pdb")

    pdb = (
        "ATOM      1  N   ALA A   1      11.104  13.207   2.100  1.00 20.00           N\n"
        "ATOM      2  CA  ALA A   1      12.560  13.207   2.100  1.00 20.00           C\n"
        "ATOM      3  C   ALA A   1      13.060  14.650   2.100  1.00 20.00           C\n"
        "ATOM      4  O   ALA A   1      12.260  15.580   2.100  1.00 20.00           O\n"
        "TER       5      ALA A   1\n"
        "END\n"
    )
    (ws / "helix.pdb").write_text(pdb, encoding="utf-8")

    settings = Settings(
        service_id="svc-r34-pm",
        workspaces={"demo": Workspace(id="demo", path=ws.resolve(), evidence_roots=(ws.resolve(),))},
        access_token=TOKEN,
        protein_cli=pm_cli,
    )
    with TestClient(create_app(settings)) as client:
        ok = client.post(
            "/api/workspaces/demo/modules/protein/run",
            headers=HEADERS,
            json={"operation": "structure-inventory", "input_path": "helix.pdb"},
        )
        assert ok.status_code == 200, ok.text
        res = ok.json()["result"]
        assert res["status"] == "observed"
        assert res["format"] == "pdb"
        assert res["unambiguous_atom_count"] == 4
        assert res["protein_residue_count"] == 1
        assert res["residues"][0]["chain"] == "A"
        assert res["module_version"] == "0.2.0"

        # Symlink escape refused cleanly
        esc = client.post(
            "/api/workspaces/demo/modules/protein/run",
            headers=HEADERS,
            json={"operation": "structure-inventory", "input_path": "escape.pdb"},
        )
        assert esc.status_code == 403
        assert esc.json()["detail"]["code"] == "SYMLINK_REFUSED"


def test_r34_literature_real_adapter_search_and_inspect_pagination(tmp_path: Path):
    lit_cli = _find_cli("bioharness-literature")
    if not lit_cli:
        pytest.skip("bioharness-literature not installed")

    ws = tmp_path / "ws"
    ws.mkdir()

    # Contract-conformant local paperseek executable for isolated CLI verification
    fake_ps = tmp_path / "paperseek_stub"
    fake_ps.write_text(
        """#!/usr/bin/env python3
import json, sys
print(json.dumps({
    "source": "openalex",
    "query": "GRF transcription factor plant",
    "total_results": 42,
    "ranked": [
        {
            "rank": 1,
            "title": "Growth-Regulating Factors in Plant Development",
            "authors": ["Kim JH", "Kende H"],
            "year": 2024,
            "venue": "Molecular Plant",
            "doi": "10.1016/j.molp.2024.01.001",
            "abstract": "GRF transcription factors coordinate leaf growth with GIF cofactors.",
            "url": "https://doi.org/10.1016/j.molp.2024.01.001?secret_token=dropme",
        },
        {
            "rank": 2,
            "title": "Evolutionary Diversification of Plant Motif Families",
            "authors": ["Li Y"],
            "year": 2025,
            "venue": "New Phytologist",
            "doi": "10.1111/nph.20250",
            "abstract": "Comparative genomics reveals conserved cis-regulatory motifs.",
        },
        {
            "rank": 3,
            "title": "Unresolved Preprint Record Without Identifier",
            "authors": ["Anon"],
            "year": 2026,
            "venue": "Preprint",
        },
    ],
}))
""",
        encoding="utf-8",
    )
    fake_ps.chmod(stat.S_IRWXU)

    settings = Settings(
        service_id="svc-r34-lit",
        workspaces={"demo": Workspace(id="demo", path=ws.resolve(), evidence_roots=(ws.resolve(),))},
        access_token=TOKEN,
        literature_cli=lit_cli,
        paperseek_cli=str(fake_ps),
        scansci_cli="/nonexistent/scansci-pdf",
    )
    with TestClient(create_app(settings)) as client:
        run_res = client.post(
            "/api/workspaces/demo/modules/literature/run",
            headers=HEADERS,
            json={"operation": "search", "question": "GRF plant motif", "maximum": 5, "iterations": 1},
        )
        assert run_res.status_code == 200, run_res.text
        payload = run_res.json()["result"]
        assert payload["ok"] is True
        assert payload["coverage"] == "ranked_subset_not_exhaustive"
        assert payload["reported_total_results"] == 42
        assert payload["returned_records"] == 3
        # Adapter strips URL query secrets
        assert "secret_token" not in json.dumps(payload)

        # Save real adapter output to workspace and test paginated inspection
        (ws / "search.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        page1 = client.post(
            "/api/workspaces/demo/modules/literature/inspect",
            headers=HEADERS,
            json={"path": "search.json", "offset": 0, "limit": 2},
        )
        assert page1.status_code == 200, page1.text
        p1 = page1.json()
        assert p1["total_items"] == 3
        assert len(p1["items"]) == 2
        assert p1["has_more"] is True
        assert p1["reported_total_results"] == 42

        page2 = client.post(
            "/api/workspaces/demo/modules/literature/inspect",
            headers=HEADERS,
            json={"path": "search.json", "offset": 2, "limit": 2},
        )
        assert page2.status_code == 200
        p2 = page2.json()
        assert len(p2["items"]) == 1
        assert p2["has_more"] is False
        assert p2["items"][0]["identifier_status"] == "unresolved"
