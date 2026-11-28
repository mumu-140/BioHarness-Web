#!/usr/bin/env bash
# Step 5 comprehensive real-browser Chromium parity, theme, keyboard, narrow-screen,
# large-data, failure/boundary, external-mutation SSE, and real server restart-recovery acceptance.
set -euo pipefail

IMAGE="${1:?container image with Node and Playwright Chromium}"
PORT="${BIOHARNESS_STEP5_PORT:-18738}"
MODEL_PORT="${BIOHARNESS_STEP5_MODEL_PORT:-18748}"
TOKEN="bioharness-step5-token-0123456789abcdef"
PROVIDER_KEY="sk-step5-secret-99887766554433221100"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
SERVER_PID=""
MODEL_PID=""
WATCHER_PID=""
DOCKER_RC=0

cleanup() {
  for p in "$WATCHER_PID" "$SERVER_PID" "$MODEL_PID"; do
    if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then
      kill "$p" 2>/dev/null || true
      wait "$p" 2>/dev/null || true
    fi
  done
  if [ -f "$WORK/server.pid" ]; then
    SP="$(cat "$WORK/server.pid" 2>/dev/null || true)"
    if [ -n "$SP" ] && kill -0 "$SP" 2>/dev/null; then
      kill "$SP" 2>/dev/null || true
      wait "$SP" 2>/dev/null || true
    fi
  fi
  if [ "${KEEP_WORK:-0}" != "1" ] && [ "${DOCKER_RC:-1}" = "0" ]; then
    rm -rf "$WORK"
  fi
}
trap cleanup EXIT

mkdir -p \
  "$WORK/ws/fixture/.bioharness/requests" "$WORK/ws/fixture/.bioharness/evidence" "$WORK/ws/fixture/.bioharness/sessions" \
  "$WORK/ws/second/.bioharness/requests" "$WORK/ws/second/.bioharness/evidence" "$WORK/ws/second/.bioharness/sessions" \
  "$WORK/ws/multi/.bioharness/requests" "$WORK/ws/multi/.bioharness/evidence" "$WORK/ws/multi/.bioharness/sessions" \
  "$WORK/outside" "$WORK/bin" "$WORK/out" "$WORK/ctrl"

chmod 777 "$WORK/out" "$WORK/ctrl"

# Build fixture evidence files (including 2,500-row large TSV, symlink escape target, drifted file)
python3 - "$WORK/ws/fixture" "$WORK/ws/second" "$WORK/outside" "$WORK/evidence_manifest.json" <<'PY_FIX'
import hashlib, json, os, pathlib, sys

ws1 = pathlib.Path(sys.argv[1])
ws2 = pathlib.Path(sys.argv[2])
outside = pathlib.Path(sys.argv[3])
manifest_path = pathlib.Path(sys.argv[4])

def make_minimal_pdf(text: str) -> bytes:
    stream = f"BT /F1 18 Tf 50 700 Td ({text}) Tj ET\n".encode("latin-1")
    objs = [
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
        b"4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
        b"5 0 obj\n<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"endstream\nendobj\n",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objs:
        offsets.append(len(out))
        out.extend(obj)
    xref_pos = len(out)
    out.extend(f"xref\n0 {len(objs) + 1}\n".encode())
    out.extend(b"0000000000 65535 f \n")
    for off in offsets[1:]:
        out.extend(f"{off:010d} 00000 n \n".encode())
    out.extend(f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode())
    return bytes(out)

# Workspace 1 files
pdf_bytes = make_minimal_pdf("BioHarness Step 5 Verified PDF")
(ws1 / "study.pdf").write_bytes(pdf_bytes)

# 2,500-row large TSV for bounded pagination & performance test
rows = ["gene\tlog2fc\tpadj\tpathway"]
rows.append("BRCA1\t2.45\t0.0001\tDNA_Repair")
rows.append("TP53\t-1.82\t0.0004\tCell_Cycle")
for i in range(3, 2501):
    rows.append(f"GENE_{i:04d}\t{(i % 9) - 4}.15\t0.00{(i % 9) + 1}\tPathway_{i % 6}")
large_tsv = ("\n".join(rows) + "\n").encode("utf-8")
(ws1 / "large_2500.tsv").write_bytes(large_tsv)

json_bytes = json.dumps({"workspace": "fixture", "status": "verified", "genes": ["BRCA1", "TP53"]}, indent=2).encode("utf-8")
(ws1 / "summary.json").write_bytes(json_bytes)

drift_orig = make_minimal_pdf("Original Step 5 PDF")
drift_sha = hashlib.sha256(drift_orig).hexdigest()
(ws1 / "drifted.pdf").write_bytes(drift_orig + b"%DRIFTED")

# Symlink pointing outside configured workspace root (must be refused!)
secret_out = outside / "escape_secret.txt"
secret_out.write_bytes(b"SECRET_OUTSIDE_WORKSPACE_NEVER_SERVE\n")
escape_link = ws1 / "escape_link.txt"
os.symlink(secret_out, escape_link)

# Workspace 2 file with identical filename/evidence_id to verify workspace isolation!
ws2_json = json.dumps({"workspace": "second", "marker": "SECOND_WORKSPACE_ONLY"}, indent=2).encode("utf-8")
(ws2 / "summary.json").write_bytes(ws2_json)

def entry(eid, path: pathlib.Path, raw: bytes, req_id: str, sub_idx: int, override_sha=None):
    return {
        "id": eid,
        "evidence_id": eid,
        "request_id": req_id,
        "submission_index": sub_idx,
        "kind": "file",
        "source": str(path),
        "sha256": override_sha or hashlib.sha256(raw).hexdigest(),
        "bytes": len(raw),
    }

manifest = {
    "fixture": {
        "ev-pdf": entry("ev-pdf", ws1 / "study.pdf", pdf_bytes, "req-main", 1),
        "ev-large": entry("ev-large", ws1 / "large_2500.tsv", large_tsv, "req-main", 1),
        "ev-json": entry("ev-json", ws1 / "summary.json", json_bytes, "req-main", 2),
        "ev-drift": entry("ev-drift", ws1 / "drifted.pdf", drift_orig, "req-main", 2, override_sha=drift_sha),
        "ev-escape": entry("ev-escape", escape_link, secret_out.read_bytes(), "req-main", 2),
    },
    "second": {
        "ev-json": entry("ev-json", ws2 / "summary.json", ws2_json, "req-second-1", 1),
    },
}
manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
PY_FIX

# Fake Core CLI supporting:
# - multi-workspace ("fixture", "second", "multi")
# - req-main (diamond DAG, 180-char long objective, advisory open_concerns, external mutation file ctrl/mutate_s3, 503 toggle ctrl/fail_503)
# - req-empty-plan (empty steps)
# - req-no-ver (plan_version omitted)
# - req-unscoped (no scope_context)
# - req-large-dag (12-step multi-predecessor DAG)
cat > "$WORK/bin/fake-core" <<'PY_CORE'
#!/usr/bin/env python3
import json, os, pathlib, sys

CTRL = pathlib.Path(os.environ["STEP5_CTRL_DIR"])
raw = sys.argv[1:]
ws_path = ""
args = []
i = 0
while i < len(raw):
    a = raw[i]
    if a == "--workspace" and i + 1 < len(raw):
        ws_path = raw[i + 1]
        i += 2
    elif a.startswith("--workspace="):
        ws_path = a.split("=", 1)[1]
        i += 1
    elif a.startswith("--"):
        i += 1
    else:
        args.append(a)
        i += 1

ws_name = pathlib.Path(ws_path).name if ws_path else "fixture"
cmd = args[0] if args else ""

if cmd == "rules":
    print("Follow BioHarness Core scientific plan.")
    sys.exit(0)

if cmd == "mcp":
    tools = [
        {"name": name, "description": f"Fixture {name}", "inputSchema": {"type": "object", "properties": {"request_id": {"type": "string"}}}}
        for name in ("science_now", "science_plan", "science_submit", "science_deliver")
    ]
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        msg = json.loads(line)
        mid = msg.get("id")
        method = msg.get("method", "")
        if method == "initialize":
            resp = {"jsonrpc": "2.0", "id": mid, "result": {
                "protocolVersion": msg.get("params", {}).get("protocolVersion", "2024-11-05"),
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "fake-core", "version": "1.0.0"},
            }}
            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()
        elif method == "tools/list":
            resp = {"jsonrpc": "2.0", "id": mid, "result": {"tools": tools}}
            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()
        elif mid is not None:
            resp = {"jsonrpc": "2.0", "id": mid, "result": {}}
            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()
    sys.exit(0)

if cmd == "hook":
    print(json.dumps({"decision": "allow"}))
    sys.exit(0)

if cmd == "call":
    tool = args[1] if len(args) > 1 else ""
    req = json.loads(sys.stdin.read() or "{}")

    if tool == "science_begin":
        print(json.dumps({
            "ok": True,
            "request_id": "req-main",
            "phase": "EXECUTING",
            "action": "RUN_STEP",
            "must_not_stop": False,
        }))
        sys.exit(0)

    if tool == "science_now":
        rid = req.get("request_id")
        if not rid:
            if ws_name == "second":
                print(json.dumps({
                    "ok": True,
                    "request_id": "req-second-1",
                    "question": "Second workspace independent analysis",
                    "scope_context": {"scope_id": "sec-scope", "project_id": "sec-proj"},
                }))
                sys.exit(0)
            if ws_name == "multi":
                print(json.dumps({
                    "ok": False,
                    "error": {
                        "code": "REQUEST_AMBIGUOUS",
                        "message": "2 open requests in multi-project workspace",
                        "open_requests": [
                            {"request_id": "req-multi-a", "question": "Alpha project branch question", "scope_id": "alpha-leaf", "project_id": "proj-alpha"},
                            {"request_id": "req-multi-b", "question": "Beta project branch question", "scope_id": "beta-root", "project_id": "proj-beta"},
                        ],
                    },
                }))
                sys.exit(0)
            print(json.dumps({
                "ok": False,
                "error": {
                    "code": "REQUEST_AMBIGUOUS",
                    "message": "5 requests are open; choose explicitly",
                    "open_requests": [
                        {"request_id": "req-main", "question": "VeryLongScientificObjectiveLabel_" + ("X" * 160), "scope_id": "leaf-deg", "project_id": "proj-genomics"},
                        {"request_id": "req-empty-plan", "question": "Initial intake before plan exists", "scope_id": "leaf-deg", "project_id": "proj-genomics"},
                        {"request_id": "req-no-ver", "question": "Legacy request without exposed plan version", "scope_id": "leaf-deg", "project_id": "proj-genomics"},
                        {"request_id": "req-unscoped", "question": "Ad-hoc unscoped request", "scope_id": None, "project_id": None},
                        {"request_id": "req-large-dag", "question": "12-step large DAG benchmark", "scope_id": "leaf-deg", "project_id": "proj-genomics"},
                    ],
                },
            }))
            sys.exit(0)

        # Transient 503 failure injection for req-main
        if rid == "req-main" and (CTRL / "fail_503").exists():
            sys.stderr.write("Simulated Core transient 503 failure\n")
            sys.exit(2)

        if rid == "req-empty-plan":
            print(json.dumps({
                "ok": True,
                "request_id": "req-empty-plan",
                "question": "Initial intake before plan exists",
                "phase": "PLANNING",
                "action": "SUBMIT_PLAN",
                "scope_context": {"scope_id": "leaf-deg", "project_id": "proj-genomics"},
                "plan": None,
            }))
            sys.exit(0)

        if rid == "req-no-ver":
            print(json.dumps({
                "ok": True,
                "request_id": "req-no-ver",
                "question": "Legacy request without exposed plan version",
                "phase": "EXECUTING",
                "action": "RUN_STEP",
                "scope_context": {"scope_id": "leaf-deg", "project_id": "proj-genomics"},
                "plan": {
                    "objective": "Unversioned plan test",
                    "steps": [{"id": "NV1", "kind": "analyze", "objective": "Inspect unversioned step", "depends_on": []}],
                },
                "progress": {"done": 0, "total": 1, "steps": [{"id": "NV1", "kind": "analyze", "status": "ACTIVE", "attempts": 1}]},
                "step": {"id": "NV1", "kind": "analyze", "objective": "Inspect unversioned step"},
            }))
            sys.exit(0)

        if rid == "req-unscoped":
            print(json.dumps({
                "ok": True,
                "request_id": "req-unscoped",
                "question": "Ad-hoc unscoped request",
                "phase": "EXECUTING",
                "action": "RUN_STEP",
                "scope_context": None,
                "plan_version": 1,
                "plan": {
                    "objective": "Unscoped exploratory check",
                    "steps": [{"id": "U1", "kind": "analyze", "objective": "Exploratory check", "depends_on": []}],
                },
                "progress": {"done": 0, "total": 1, "steps": [{"id": "U1", "kind": "analyze", "status": "ACTIVE", "attempts": 0}]},
                "step": {"id": "U1", "kind": "analyze", "objective": "Exploratory check"},
            }))
            sys.exit(0)

        if rid == "req-large-dag":
            steps = []
            prog = []
            for idx in range(1, 13):
                deps = []
                if idx > 1:
                    deps.append(f"L{idx - 1}")
                if idx > 3 and idx % 3 == 0:
                    deps.append(f"L{idx - 3}")
                steps.append({
                    "id": f"L{idx}",
                    "kind": "analyze" if idx < 12 else "synthesize",
                    "objective": f"Large DAG stage {idx} computation",
                    "depends_on": deps,
                })
                prog.append({
                    "id": f"L{idx}",
                    "kind": "analyze" if idx < 12 else "synthesize",
                    "status": "DONE" if idx <= 6 else ("ACTIVE" if idx == 7 else "PENDING"),
                    "attempts": 1 if idx <= 7 else 0,
                })
            print(json.dumps({
                "ok": True,
                "request_id": "req-large-dag",
                "question": "12-step large DAG benchmark",
                "phase": "EXECUTING",
                "action": "RUN_STEP",
                "scope_context": {"scope_id": "leaf-deg", "project_id": "proj-genomics"},
                "plan_version": 1,
                "plan": {"objective": "12-step multi-branch scientific pipeline", "steps": steps},
                "progress": {"done": 6, "total": 12, "steps": prog},
                "step": {"id": "L7", "kind": "analyze", "objective": "Large DAG stage 7 computation"},
            }))
            sys.exit(0)

        if rid == "req-second-1":
            print(json.dumps({
                "ok": True,
                "request_id": "req-second-1",
                "question": "Second workspace independent analysis",
                "phase": "EXECUTING",
                "action": "RUN_STEP",
                "scope_context": {"scope_id": "sec-scope", "project_id": "sec-proj"},
                "plan_version": 1,
                "plan": {
                    "objective": "Second workspace plan objective",
                    "steps": [{"id": "SEC1", "kind": "analyze", "objective": "Second workspace step", "depends_on": []}],
                },
                "progress": {"done": 0, "total": 1, "steps": [{"id": "SEC1", "kind": "analyze", "status": "ACTIVE", "attempts": 1}]},
                "step": {"id": "SEC1", "kind": "analyze", "objective": "Second workspace step"},
            }))
            sys.exit(0)

        # Default: req-main (with optional external mutation ctrl/mutate_s3)
        mutated = (CTRL / "mutate_s3").exists()
        long_obj = "VeryLongScientificObjective_" + ("ConvergenceAnalysisSegment_" * 7)
        print(json.dumps({
            "ok": True,
            "request_id": rid,
            "question": long_obj,
            "phase": "EXECUTING",
            "action": "RUN_STEP",
            "must_not_stop": False,
            "scope_context": {"scope_id": "leaf-deg", "project_id": "proj-genomics"},
            "plan_version": 2,
            "open_concerns": [{"about": "S3", "concern": "Advisory: check batch normalization sensitivity (non-blocking)"}],
            "plan": {
                "objective": long_obj,
                "steps": [
                    {"id": "S1", "kind": "acquire", "objective": "Collect paired cohort counts", "method": "Normalize", "depends_on": []},
                    {"id": "S2", "kind": "analyze", "objective": "Run differential expression branch A", "method": "DESeq2", "depends_on": ["S1"]},
                    {"id": "S3", "kind": "analyze", "objective": "Run pathway enrichment branch B", "method": "GSEA", "depends_on": ["S1"]},
                    {"id": "S4", "kind": "synthesize", "objective": "Synthesize convergent markers from branches A & B", "method": "Meta-analysis", "depends_on": ["S2", "S3"]},
                ],
            },
            "progress": {
                "done": 3 if mutated else 2,
                "total": 4,
                "steps": [
                    {"id": "S1", "kind": "acquire", "status": "DONE", "attempts": 1, "review": "Counts verified"},
                    {"id": "S2", "kind": "analyze", "status": "DONE", "attempts": 1, "review": "DEG table recorded"},
                    {"id": "S3", "kind": "analyze", "status": "DONE" if mutated else "ACTIVE", "attempts": 1, "review": "Advisory note: unreviewed optional check"},
                    {"id": "S4", "kind": "synthesize", "status": "ACTIVE" if mutated else "PENDING", "attempts": 0, "review": "Awaiting S2 + S3"},
                ],
            },
            "step": {"id": "S4" if mutated else "S3", "kind": "synthesize" if mutated else "analyze"},
            "evidence_changed_since_submission": [],
        }))
        sys.exit(0)

    print(json.dumps({"ok": True}))
    sys.exit(0)
PY_CORE
chmod +x "$WORK/bin/fake-core"

# Fake Governance CLI supporting multi-project tree (ws=multi), single-project tree (ws=fixture, second),
# context with non-blocking goal_version_changes & related_requests, routes, and exact evidence lookup.
cat > "$WORK/bin/fake-gov" <<'PY_GOV'
#!/usr/bin/env python3
import json, os, pathlib, sys

MANIFEST = json.loads(pathlib.Path(os.environ["STEP5_MANIFEST"]).read_text("utf-8"))

raw = sys.argv[1:]
ws_path = ""
project_id = None
scope_id = None
request_id = None
evidence_id = None
submission_index = None
sha256 = None
cmd = None

i = 0
while i < len(raw):
    a = raw[i]
    if a == "--workspace" and i + 1 < len(raw):
        ws_path = raw[i + 1]; i += 2
    elif a.startswith("--workspace="):
        ws_path = a.split("=", 1)[1]; i += 1
    elif a == "--project-id" and i + 1 < len(raw):
        project_id = raw[i + 1]; i += 2
    elif a.startswith("--project-id="):
        project_id = a.split("=", 1)[1]; i += 1
    elif a == "--scope-id" and i + 1 < len(raw):
        scope_id = raw[i + 1]; i += 2
    elif a.startswith("--scope-id="):
        scope_id = a.split("=", 1)[1]; i += 1
    elif a == "--request-id" and i + 1 < len(raw):
        request_id = raw[i + 1]; i += 2
    elif a.startswith("--request-id="):
        request_id = a.split("=", 1)[1]; i += 1
    elif a == "--evidence-id" and i + 1 < len(raw):
        evidence_id = raw[i + 1]; i += 2
    elif a.startswith("--evidence-id="):
        evidence_id = a.split("=", 1)[1]; i += 1
    elif a == "--submission-index" and i + 1 < len(raw):
        submission_index = int(raw[i + 1]); i += 2
    elif a.startswith("--submission-index="):
        submission_index = int(a.split("=", 1)[1]); i += 1
    elif a == "--sha256" and i + 1 < len(raw):
        sha256 = raw[i + 1]; i += 2
    elif a.startswith("--sha256="):
        sha256 = a.split("=", 1)[1]; i += 1
    elif a.startswith("--"):
        i += 2 if (i + 1 < len(raw) and not raw[i + 1].startswith("--")) else 1
    else:
        if cmd is None:
            cmd = a
        i += 1

ws_name = pathlib.Path(ws_path).name if ws_path else "fixture"

if cmd == "tree":
    if ws_name == "multi":
        if not project_id:
            print(json.dumps({
                "ok": True,
                "projects": [
                    {"scope_id": "proj-alpha", "title": "Project Alpha", "objective": "Alpha multi-branch study", "request_count": 1},
                    {"scope_id": "proj-beta", "title": "Project Beta", "objective": "Beta independent study", "request_count": 1},
                ],
                "nodes": [],
            }))
            sys.exit(0)
        if project_id == "proj-alpha":
            print(json.dumps({
                "ok": True,
                "project_id": "proj-alpha",
                "nodes": [
                    {"scope_id": "proj-alpha", "parent_scope_id": None, "path": ["proj-alpha"], "title": "Project Alpha", "request_count": 0, "requests": []},
                    {"scope_id": "alpha-leaf", "parent_scope_id": "proj-alpha", "path": ["proj-alpha", "alpha-leaf"], "title": "Alpha Leaf Branch", "request_count": 1, "requests": [{"request_id": "req-multi-a", "request_status": "EXECUTING"}]},
                ],
                "goal_version_changes": [{"request_id": "req-multi-a", "scope_id": "alpha-leaf"}],
                "related_requests": [{"source_request_id": "req-multi-a", "target_request_id": "req-multi-b"}],
            }))
            sys.exit(0)
        print(json.dumps({
            "ok": True,
            "project_id": "proj-beta",
            "nodes": [
                {"scope_id": "beta-root", "parent_scope_id": None, "path": ["beta-root"], "title": "Project Beta", "request_count": 1, "requests": [{"request_id": "req-multi-b", "request_status": "EXECUTING"}]},
            ],
        }))
        sys.exit(0)

    if ws_name == "second":
        print(json.dumps({
            "ok": True,
            "project_id": "sec-proj",
            "nodes": [
                {"scope_id": "sec-scope", "parent_scope_id": None, "path": ["sec-scope"], "title": "Second Workspace Scope", "request_count": 1, "requests": [{"request_id": "req-second-1", "request_status": "EXECUTING"}]},
            ],
        }))
        sys.exit(0)

    print(json.dumps({
        "ok": True,
        "project_id": "proj-genomics",
        "nodes": [
            {"scope_id": "proj-genomics", "parent_scope_id": None, "path": ["proj-genomics"], "title": "Genomics Program", "request_count": 0, "requests": []},
            {"scope_id": "branch-rnaseq", "parent_scope_id": "proj-genomics", "path": ["proj-genomics", "branch-rnaseq"], "title": "RNA-seq Cohorts", "request_count": 0, "requests": []},
            {
                "scope_id": "leaf-deg",
                "parent_scope_id": "branch-rnaseq",
                "path": ["proj-genomics", "branch-rnaseq", "leaf-deg"],
                "title": "BRCA1/TP53 Convergence",
                "request_count": 4,
                "requests": [
                    {"request_id": "req-main", "request_status": "EXECUTING"},
                    {"request_id": "req-empty-plan", "request_status": "PLANNING"},
                    {"request_id": "req-no-ver", "request_status": "EXECUTING"},
                    {"request_id": "req-large-dag", "request_status": "EXECUTING"},
                ],
            },
        ],
        "goal_version_changes": [{"request_id": "req-main", "scope_id": "leaf-deg"}],
        "related_requests": [{"source_request_id": "req-main", "target_request_id": "req-large-dag"}],
    }))
    sys.exit(0)

if cmd == "context":
    print(json.dumps({
        "ok": True,
        "shared": {
            "scope": {"scope_id": scope_id or "leaf-deg", "title": "BRCA1/TP53 Convergence"},
            "goal_version_changes": [{"request_id": "req-main", "scope_id": "leaf-deg"}],
            "goal_version_change_count": 1,
            "related_requests": [{"request_id": "req-large-dag", "scope_id": "leaf-deg"}],
            "related_count": 1,
        },
    }))
    sys.exit(0)

if cmd == "routes":
    if ws_name == "second":
        m2 = MANIFEST["second"]
        print(json.dumps({
            "ok": True,
            "scope_id": scope_id or "sec-scope",
            "attempt_count": 1,
            "offset": 0,
            "attempts": [
                {
                    "request_id": "req-second-1",
                    "submission_index": 1,
                    "step_id": "SEC1",
                    "plan_version": 1,
                    "submission_status": "DONE",
                    "summary": "Second workspace evidence",
                    "evidence": [m2["ev-json"]],
                }
            ],
        }))
        sys.exit(0)

    m1 = MANIFEST["fixture"]
    print(json.dumps({
        "ok": True,
        "scope_id": scope_id or "leaf-deg",
        "attempt_count": 3,
        "offset": 0,
        "attempts": [
            {
                "request_id": "req-main",
                "submission_index": 1,
                "step_id": "S1",
                "plan_version": 2,
                "at": "2026-11-28T00:10:00Z",
                "submission_status": "DONE",
                "summary": "Verified PDF and 2,500-row cohort table",
                "evidence": [m1["ev-pdf"], m1["ev-large"]],
            },
            {
                "request_id": "req-main",
                "submission_index": 2,
                "step_id": "S2",
                "plan_version": 2,
                "at": "2026-11-28T00:12:00Z",
                "submission_status": "DONE",
                "summary": "JSON summary, drifted PDF, and escape symlink test",
                "evidence": [m1["ev-json"], m1["ev-drift"], m1["ev-escape"]],
            },
            {
                "request_id": "req-no-ver",
                "submission_index": 1,
                "step_id": "NV1",
                "plan_version": 1,
                "at": "2026-11-28T00:05:00Z",
                "submission_status": "DONE",
                "summary": "Historical v1 submission for unversioned plan test",
                "evidence": [],
            },
        ],
    }))
    sys.exit(0)

if cmd == "evidence":
    ws_m = MANIFEST.get(ws_name, {})
    ev = ws_m.get(evidence_id or "")
    if not ev or (sha256 and ev["sha256"] != sha256):
        print(json.dumps({"ok": False, "error": "evidence anchor not found"}))
        sys.exit(0)
    print(json.dumps({
        "ok": True,
        "recorded_reference": f"{request_id}#{submission_index or 1}:{ev['evidence_id']}",
        "snapshot_integrity": "RECORDED_IN_GOVERNANCE",
        "reference": {
            "request_id": request_id,
            "submission_index": submission_index or 1,
            "evidence_id": ev["evidence_id"],
            "sha256": ev["sha256"],
        },
        "evidence": ev,
        "snapshot": {"present": False},
    }))
    sys.exit(0)

print(json.dumps({"ok": True}))
PY_GOV
chmod +x "$WORK/bin/fake-gov"

# Lightweight scripted OpenAI-compatible provider answering cleanly for Step 5 journey & restart tests
cat > "$WORK/bin/fake-provider.py" <<'PY_PROV'
import json, sys, time
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = int(sys.argv[1])
class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args): pass
    def do_GET(self):
        if self.path == "/v1/models":
            body = json.dumps({"object": "list", "data": [{"id": "step5-mock-model", "object": "model"}]}).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body)
        else:
            self.send_response(404); self.end_headers()
    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        payload = json.loads(self.rfile.read(length) or "{}")
        msgs = payload.get("messages") or []
        last_user = ""
        for m in reversed(msgs):
            if m.get("role") == "user":
                c = m.get("content", "")
                last_user = c if isinstance(c, str) else str(c)
                break
        text = f"Step 5 verified assistant reply for: {last_user[:80]}"
        if payload.get("stream"):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            for chunk_text in (text[:24], text[24:]):
                frame = {"id": "cmpl-s5", "object": "chat.completion.chunk", "model": "step5-mock-model",
                         "choices": [{"index": 0, "delta": {"role": "assistant", "content": chunk_text}, "finish_reason": None}]}
                self.wfile.write(f"data: {json.dumps(frame)}\n\n".encode()); self.wfile.flush()
            end_frame = {"id": "cmpl-s5", "object": "chat.completion.chunk", "model": "step5-mock-model",
                         "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}
            self.wfile.write(f"data: {json.dumps(end_frame)}\n\ndata: [DONE]\n\n".encode()); self.wfile.flush()
        else:
            body = json.dumps({"id": "cmpl-s5", "object": "chat.completion", "model": "step5-mock-model",
                               "choices": [{"index": 0, "message": {"role": "assistant", "content": text}, "finish_reason": "stop"}]}).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body)

HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
PY_PROV

"$ROOT/.venv/bin/python" "$WORK/bin/fake-provider.py" "$MODEL_PORT" &
MODEL_PID=$!

# Seed SQLite ledger with:
# - conv-crashed: has a RUNNING run so server startup / restart recovery marks it INTERRUPTED!
# - conv-execs: has 14 recorded operations to test cursor pagination
"$ROOT/.venv/bin/python" - "$WORK/ledger.sqlite3" <<'PY_SEED'
import sys, pathlib
sys.path.insert(0, str(pathlib.Path("backend").resolve()))
from bioharness_web.ledger import Ledger

ledger = Ledger(pathlib.Path(sys.argv[1]))
c = ledger.create_conversation("fixture", request_id="req-main")
r_id = ledger.start_run(c["id"])
for idx in range(1, 15):
    op_id = ledger.start_operation(r_id, "core" if idx % 2 else "model", f"step5_op_{idx:02d}")
    ledger.append(c["id"], r_id, "operation.started", {"operation_id": op_id, "kind": "core" if idx % 2 else "model", "name": f"step5_op_{idx:02d}", "input": {"step": idx}})
    ledger.end_operation(op_id, "SUCCEEDED")
    ledger.append(c["id"], r_id, "operation.finished", {"operation_id": op_id, "state": "SUCCEEDED", "output": {"ok": True, "idx": idx}})
ledger.end_run(r_id, "FINISHED")

# Seed a conversation whose run was interrupted mid-flight (simulated process crash before restart)
c_crash = ledger.create_conversation("fixture", request_id="req-no-ver")
r_crash = ledger.start_run(c_crash["id"])
ledger.append(c_crash["id"], r_crash, "user.message", {"text": "Pre-crash message that must survive restart"})
ledger.append(c_crash["id"], r_crash, "run.started", {"run_id": r_crash, "model": "step5-mock-model"})
# Intentionally leave r_crash RUNNING until server startup/restart recovers it!
ledger.close()
PY_SEED

start_web_server() {
  env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u all_proxy -u ALL_PROXY \
    PYTHONPATH="$ROOT/backend" \
    STEP5_MANIFEST="$WORK/evidence_manifest.json" \
    STEP5_CTRL_DIR="$WORK/ctrl" \
    BIOHARNESS_WEB_SERVICE_ID="bh-step5-qa" \
    BIOHARNESS_WEB_WORKSPACES="{\"fixture\":\"$WORK/ws/fixture\",\"second\":\"$WORK/ws/second\",\"multi\":\"$WORK/ws/multi\"}" \
    BIOHARNESS_WEB_ACCESS_TOKEN="$TOKEN" \
    BIOHARNESS_WEB_CORE_CLI="$WORK/bin/fake-core" \
    BIOHARNESS_WEB_GOVERNANCE_CLI="$WORK/bin/fake-gov" \
    BIOHARNESS_WEB_TOOL_ENV="STEP5_CTRL_DIR,STEP5_MANIFEST" \
    BIOHARNESS_WEB_STATIC_DIR="$ROOT/ui/client/dist" \
    BIOHARNESS_WEB_POLL_INTERVAL_SECONDS="1" \
    BIOHARNESS_WEB_MODEL_BASE_URL="http://127.0.0.1:$MODEL_PORT/v1" \
    BIOHARNESS_WEB_MODEL_API_KEY="$PROVIDER_KEY" \
    BIOHARNESS_WEB_MODEL_NAME="step5-mock-model" \
    BIOHARNESS_WEB_LEDGER="$WORK/ledger.sqlite3" \
    BIOHARNESS_WEB_HOST="127.0.0.1" \
    BIOHARNESS_WEB_PORT="$PORT" \
    "$ROOT/.venv/bin/python" -m bioharness_web >> "$WORK/server.log" 2>&1 &
  SERVER_PID=$!
  echo "$SERVER_PID" > "$WORK/server.pid"

  for _ in $(seq 1 40); do
    if env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  echo "ERROR: BioHarness server failed to start on port $PORT" >&2
  cat "$WORK/server.log" >&2
  exit 1
}

start_web_server

# Background watcher: when Chromium test writes ctrl/restart_request, kill and restart the real backend process!
(
  while true; do
    if [ -f "$WORK/ctrl/restart_request" ]; then
      rm -f "$WORK/ctrl/restart_request"
      OLD_PID="$(cat "$WORK/server.pid" 2>/dev/null || true)"
      if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        kill "$OLD_PID" 2>/dev/null || true
        for _ in $(seq 1 20); do
          kill -0 "$OLD_PID" 2>/dev/null || break
          sleep 0.2
        done
        if kill -0 "$OLD_PID" 2>/dev/null; then
          kill -9 "$OLD_PID" 2>/dev/null || true
        fi
        wait "$OLD_PID" 2>/dev/null || true
      fi
      sleep 0.3
      # Also inject a mid-flight RUNNING row right before restart to verify ledger.recover() on actual restart!
      "$ROOT/.venv/bin/python" - "$WORK/ledger.sqlite3" <<'PY_PRE_RESTART'
import sys, pathlib
sys.path.insert(0, str(pathlib.Path("backend").resolve()))
from bioharness_web.ledger import Ledger
l = Ledger(pathlib.Path(sys.argv[1]))
c = l.create_conversation("fixture", request_id="req-large-dag")
rid = l.start_run(c["id"])
l.append(c["id"], rid, "user.message", {"text": "In-flight run interrupted by server restart"})
l.append(c["id"], rid, "run.started", {"run_id": rid, "model": "step5-mock-model"})
l.close()
PY_PRE_RESTART
      start_web_server
      touch "$WORK/ctrl/restart_done"
    fi
    sleep 0.3
  done
) &
WATCHER_PID=$!

set +e
docker run --rm --network host \
  -e BASE="http://127.0.0.1:$PORT" \
  -e TOKEN="$TOKEN" \
  -e PROVIDER_KEY="$PROVIDER_KEY" \
  -e WORKSPACE_DIR="$WORK/ws/fixture" \
  -e MANIFEST_PATH="/qa/manifest.json" \
  -e PLAYWRIGHT_MODULE="${PLAYWRIGHT_MODULE:-playwright}" \
  -v "$ROOT/tests/browser/ui_step5_check.cjs:/qa/check.cjs:ro" \
  -v "$WORK/evidence_manifest.json:/qa/manifest.json:ro" \
  -v "$WORK/out:/qa/out" \
  -v "$WORK/ctrl:/qa/ctrl" \
  "$IMAGE" node /qa/check.cjs
DOCKER_RC=$?
set -e

if [ -f "$WORK/out/results.json" ]; then
  python3 - "$WORK/out/results.json" <<'PY_REPORT'
import json, sys
rows = json.load(open(sys.argv[1]))
passed = sum(1 for r in rows if r["ok"])
for r in rows:
    tag = "PASS" if r["ok"] else "FAIL"
    det = f" — {r['detail']}" if r.get("detail") else ""
    print(f"{tag} {r['name']}{det}")
print(f"TOTAL {passed} / {len(rows)}")
if passed != len(rows):
    sys.exit(1)
PY_REPORT
else
  echo "FAIL results.json missing (docker rc=$DOCKER_RC)"
  tail -n 60 "$WORK/server.log" || true
  exit 1
fi

if [ "$DOCKER_RC" != "0" ]; then
  echo "FAIL browser container exited with code $DOCKER_RC"
  exit "$DOCKER_RC"
fi

echo "STEP 5 CHROMIUM ACCEPTANCE PASSED"
