#!/usr/bin/env bash
# Step 4 real-browser Chromium acceptance:
# Research tree (@rc-component/tree), React Flow + Dagre plan canvas & step detail,
# Discuss-this-step draft staging, background run continuity across view switches,
# independent Execution records, and Evidence viewers (AG Grid, self-hosted PDF.js,
# read-only self-hosted Monaco, sandboxed DOMPurify HTML, drift refusal, unsupported binary).
set -euo pipefail

IMAGE="${1:?container image with Node and Playwright Chromium}"
PORT="${BIOHARNESS_STEP4_PORT:-18736}"
MODEL_PORT="${BIOHARNESS_STEP4_MODEL_PORT:-18746}"
TOKEN="bioharness-step4-token-0123456789abcdef"
PROVIDER_KEY="sk-step4-secret-99887766554433221100"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
SERVER_PID=""
MODEL_PID=""
DOCKER_RC=0

cleanup() {
  for p in "$SERVER_PID" "$MODEL_PID"; do
    if [ -n "$p" ] && kill -0 "$p" 2>/dev/null; then
      kill "$p" 2>/dev/null || true
      wait "$p" 2>/dev/null || true
    fi
  done
  if [ "${KEEP_WORK:-0}" != "1" ] && [ "${DOCKER_RC:-1}" = "0" ]; then
    rm -rf "$WORK"
  fi
}
trap cleanup EXIT

mkdir -p "$WORK/ws/fixture/.bioharness/requests" "$WORK/ws/fixture/.bioharness/evidence" "$WORK/ws/fixture/.bioharness/sessions" "$WORK/bin" "$WORK/state"

# Create real evidence files in fixture workspace and record their SHA-256 digests.
python3 - "$WORK/ws/fixture" "$WORK/evidence_manifest.json" <<'PY_FIXTURE_FILES'
import hashlib, json, pathlib, sys

ws = pathlib.Path(sys.argv[1])
manifest_path = pathlib.Path(sys.argv[2])

# 1. Valid minimal 1-page PDF (real PDF-1.4 with readable text object for PDF.js)
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

pdf_bytes = make_minimal_pdf("BioHarness Step 4 Verified PDF")
(ws / "study.pdf").write_bytes(pdf_bytes)

# 2. TSV structured table (120 rows so pagination & AG Grid sorting work cleanly)
tsv_lines = ["gene\tlog2fc\tpadj\tpathway"]
tsv_lines.append("BRCA1\t2.45\t0.0001\tDNA_Repair")
tsv_lines.append("TP53\t-1.82\t0.0004\tCell_Cycle")
for idx in range(3, 121):
    tsv_lines.append(f"GENE_{idx:03d}\t{(idx % 7) - 3}.25\t0.0{idx % 9 + 1}\tPath_{idx % 4}")
tsv_bytes = ("\n".join(tsv_lines) + "\n").encode("utf-8")
(ws / "deg.tsv").write_bytes(tsv_bytes)

# 3. JSON summary for read-only self-hosted Monaco code viewer
json_bytes = json.dumps({"cohort": "pilot-s4", "significant_genes": 2, "top": ["BRCA1", "TP53"]}, indent=2).encode("utf-8")
(ws / "summary.json").write_bytes(json_bytes)

# 4. Static HTML containing an attempted XSS script tag (must be stripped + sandboxed)
html_bytes = b"<div><h2>Safe Report Heading</h2><script>window.__bhXssExecuted=true;</script><p>Verified static HTML.</p></div>"
(ws / "report.html").write_bytes(html_bytes)

# 5. Drifted PDF (recorded hash differs from current bytes on disk!)
orig_drift_bytes = make_minimal_pdf("Original recorded PDF")
drift_sha = hashlib.sha256(orig_drift_bytes).hexdigest()
(ws / "drifted.pdf").write_bytes(orig_drift_bytes + b"%MUTATED_ON_DISK")

# 6. Unsupported binary (.bam)
bam_bytes = b"\x1f\x8b\x08\x04\x00\x00\x00\x00BAM_BINARY_DATA"
(ws / "reads.bam").write_bytes(bam_bytes)

def entry(eid, fname, raw_bytes, override_sha=None):
    p = ws / fname
    return {
        "id": eid,
        "evidence_id": eid,
        "kind": "file",
        "source": str(p),
        "sha256": override_sha or hashlib.sha256(raw_bytes).hexdigest(),
        "bytes": len(raw_bytes),
    }

manifest = {
    "ev-pdf": entry("ev-pdf", "study.pdf", pdf_bytes),
    "ev-table": entry("ev-table", "deg.tsv", tsv_bytes),
    "ev-json": entry("ev-json", "summary.json", json_bytes),
    "ev-html": entry("ev-html", "report.html", html_bytes),
    "ev-drift": entry("ev-drift", "drifted.pdf", orig_drift_bytes, override_sha=drift_sha),
    "ev-bam": entry("ev-bam", "reads.bam", bam_bytes),
}
manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
PY_FIXTURE_FILES

# Fake Core CLI returning multi-predecessor diamond DAG plan (S1 -> S2, S3 -> S4)
cat > "$WORK/bin/fake-core" <<'PY_CORE'
#!/usr/bin/env python3
import json, sys

raw_args = sys.argv[1:]
args = [a for a in raw_args if not a.startswith("--")]
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
    if tool == "science_open":
        print(json.dumps({
            "ok": True,
            "core_state_present": True,
            "open_requests": [
                {
                    "request_id": "req-s4-1",
                    "question": "Evaluate BRCA1/TP53 pathway convergence across RNA-seq cohorts",
                    "scope_id": "leaf-deg",
                    "project_id": "proj-genomics",
                    "updated_at": "2026-11-28T00:00:00Z",
                }
            ],
            "may_be_incomplete": False,
            "source_message": None,
        }))
        sys.exit(0)
    if tool == "science_now":
        print(json.dumps({
            "ok": True,
            "request_id": req.get("request_id") or "req-s4-1",
            "question": "Evaluate BRCA1/TP53 pathway convergence across RNA-seq cohorts",
            "phase": "EXECUTING",
            "action": "RUN_STEP",
            "must_not_stop": False,
            "scope_context": {"scope_id": "leaf-deg", "project_id": "proj-genomics"},
            "plan_version": 2,
            "plan": {
                "objective": "Verify BRCA1/TP53 pathway convergence with multi-branch QC",
                "steps": [
                    {"id": "S1", "kind": "acquire", "objective": "Collect paired cohort counts", "method": "Import normalized count matrices"},
                    {"id": "S2", "kind": "analyze", "objective": "Run differential expression branch A", "method": "DESeq2 Wald test", "depends_on": ["S1"]},
                    {"id": "S3", "kind": "analyze", "objective": "Run pathway enrichment branch B", "method": "GSEA hallmark scan", "depends_on": ["S1"]},
                    {"id": "S4", "kind": "synthesize", "objective": "Synthesize convergent markers from branches A & B", "why": "Confirm overlap across independent analyses", "method": "Intersect FDR<0.05 genes and compile evidence", "deliverable": "Verified marker table & PDF report", "check": "Cross-check SHA-256 snapshots", "depends_on": ["S2", "S3"]},
                ],
            },
            "progress": {
                "done": 2,
                "total": 4,
                "steps": [
                    {"id": "S1", "kind": "acquire", "status": "DONE", "attempts": 1, "review": "Counts verified"},
                    {"id": "S2", "kind": "analyze", "status": "DONE", "attempts": 1, "review": "DEG table recorded"},
                    {"id": "S3", "kind": "analyze", "status": "ACTIVE", "attempts": 1, "review": "Running enrichment"},
                    {"id": "S4", "kind": "synthesize", "status": "PENDING", "attempts": 0, "review": "Awaiting S2 + S3 convergence"},
                ],
            },
            "step": {"id": "S3", "kind": "analyze", "objective": "Run pathway enrichment branch B"},
            "evidence_changed_since_submission": [],
        }))
        sys.exit(0)
    if tool == "science_begin":
        print(json.dumps({"ok": True, "request_id": "req-s4-1", "phase": "EXECUTING", "must_not_stop": False}))
        sys.exit(0)
    print(json.dumps({"ok": True}))
    sys.exit(0)

print(json.dumps({"ok": True}))
PY_CORE
chmod +x "$WORK/bin/fake-core"

# Fake Project Governance CLI serving multi-level tree, routes, context, and evidence anchor resolution
cat > "$WORK/bin/fake-gov" <<PY_GOV
#!/usr/bin/env python3
import json, pathlib, sys

manifest = json.loads(pathlib.Path("$WORK/evidence_manifest.json").read_text(encoding="utf-8"))
raw_args = sys.argv[1:]
pos = [a for a in raw_args if not a.startswith("--")]
sub = pos[0] if pos else ""

def opt(flag):
    prefix = flag + "="
    for idx, a in enumerate(raw_args):
        if a.startswith(prefix):
            return a[len(prefix):]
        if a == flag and idx + 1 < len(raw_args):
            return raw_args[idx + 1]
    return None

ev_refs = [
    {
        "request_id": "req-s4-1",
        "submission_index": 1,
        "evidence_id": e["evidence_id"],
        "sha256": e["sha256"],
        "source": e["source"],
        "kind": e["kind"],
        "bytes": e["bytes"],
    }
    for e in manifest.values()
]

if sub == "tree":
    print(json.dumps({
        "ok": True,
        "project_id": "proj-genomics",
        "nodes": [
            {
                "scope_id": "proj-genomics",
                "parent_scope_id": None,
                "path": ["proj-genomics"],
                "title": "Genomics Program",
                "objective": "Multi-cohort oncology research",
                "mainline_version": 1,
                "request_count": 1,
                "requests": [],
            },
            {
                "scope_id": "sub-rnaseq",
                "parent_scope_id": "proj-genomics",
                "path": ["proj-genomics", "sub-rnaseq"],
                "title": "RNA-seq Track",
                "objective": "Transcriptomic convergence",
                "mainline_version": 1,
                "request_count": 1,
                "requests": [],
            },
            {
                "scope_id": "leaf-deg",
                "parent_scope_id": "sub-rnaseq",
                "path": ["proj-genomics", "sub-rnaseq", "leaf-deg"],
                "title": "DEG Convergence",
                "objective": "BRCA1/TP53 convergence",
                "mainline_version": 1,
                "request_count": 1,
                "requests": [
                    {"request_id": "req-s4-1", "scope_id": "leaf-deg", "request_status": "OPEN"}
                ],
            },
        ],
        "request_binding": {
            "request_id": "req-s4-1",
            "scope_id": "leaf-deg",
            "request_status": "OPEN",
            "path": ["proj-genomics", "sub-rnaseq", "leaf-deg"],
        },
        "shared_evidence": [],
    }))
    sys.exit(0)

if sub == "routes":
    print(json.dumps({
        "ok": True,
        "scope_id": "leaf-deg",
        "included_scope_ids": ["leaf-deg"],
        "attempt_count": 1,
        "offset": 0,
        "attempts": [
            {
                "request_id": "req-s4-1",
                "scope_id": "leaf-deg",
                "request_status": "OPEN",
                "submission_index": 1,
                "step_id": "S4",
                "at": "2026-11-28T00:05:00Z",
                "submission_status": "ACCEPTED",
                "summary": "Compiled PDF report, DEG table, JSON summary, static HTML, drifted sample, and BAM binary.",
                "method_used": "DESeq2 + GSEA",
                "parameters_used": {"fdr": 0.05},
                "condition_gaps": [],
                "execution_verified": True,
                "evidence": ev_refs,
            }
        ],
    }))
    sys.exit(0)

if sub == "context":
    print(json.dumps({
        "ok": True,
        "shared": {
            "scope": {"scope_id": "leaf-deg", "title": "DEG Convergence"},
            "recent_submissions": [
                {
                    "request_id": "req-s4-1",
                    "submission_index": 1,
                    "step_id": "S4",
                    "submission_status": "ACCEPTED",
                    "summary": "Step 4 fixture bundle",
                    "evidence": ev_refs,
                }
            ],
        },
    }))
    sys.exit(0)

if sub == "evidence":
    eid = opt("--evidence-id")
    sha = opt("--sha256")
    item = manifest.get(eid or "")
    if item and item["sha256"] == sha:
        print(json.dumps({
            "ok": True,
            "recorded_reference": f"req-s4-1#1:{eid}",
            "snapshot_integrity": "RECORDED_IN_GOVERNANCE",
            "note": "Governance recorded evidence reference.",
            "evidence": item,
        }))
    else:
        print(json.dumps({"ok": False, "error": "Evidence reference does not match the recorded version"}))
    sys.exit(0)

print(json.dumps({"ok": True}))
PY_GOV
chmod +x "$WORK/bin/fake-gov"

# Fake OpenAI provider supporting quick & slow runs for background-run continuity check
cat > "$WORK/fake_openai.py" <<'PY_MODEL'
import json, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

port = int(sys.argv[1])

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        return
    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        body = json.loads(self.rfile.read(length).decode("utf-8"))
        text_all = json.dumps(body)
        slow = "[slow-run]" in text_all
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        if slow:
            for chunk_text in ["Background part 1. ", "Background part 2. ", "Background completed cleanly."]:
                time.sleep(0.8)
                payload = {"id": "cmpl-s4", "object": "chat.completion.chunk", "created": 1,
                           "model": body.get("model", "step4-model"),
                           "choices": [{"index": 0, "delta": {"role": "assistant", "content": chunk_text}, "finish_reason": None}]}
                self.wfile.write(f"data: {json.dumps(payload)}\n\n".encode("utf-8"))
                self.wfile.flush()
        else:
            payload = {"id": "cmpl-s4", "object": "chat.completion.chunk", "created": 1,
                       "model": body.get("model", "step4-model"),
                       "choices": [{"index": 0, "delta": {"role": "assistant", "content": "Initial step4 reply ready."}, "finish_reason": None}]}
            self.wfile.write(f"data: {json.dumps(payload)}\n\n".encode("utf-8"))
            self.wfile.flush()
        done_payload = {"id": "cmpl-s4", "object": "chat.completion.chunk", "created": 1,
                        "model": body.get("model", "step4-model"),
                        "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}
        self.wfile.write(f"data: {json.dumps(done_payload)}\n\n".encode("utf-8"))
        self.wfile.write(b"data: [DONE]\n\n")
        self.wfile.flush()

ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
PY_MODEL

"$ROOT/.venv/bin/python" "$WORK/fake_openai.py" "$MODEL_PORT" >"$WORK/model.log" 2>&1 &
MODEL_PID=$!

env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u all_proxy -u ALL_PROXY \
  BIOHARNESS_WEB_SERVICE_ID="step4-qa" \
  BIOHARNESS_WEB_ACCESS_TOKEN="$TOKEN" \
  BIOHARNESS_WEB_WORKSPACES="{\"fixture\":\"$WORK/ws/fixture\"}" \
  BIOHARNESS_WEB_STATIC_DIR="$ROOT/ui/client/dist" \
  BIOHARNESS_WEB_CORE_CLI="$WORK/bin/fake-core" \
  BIOHARNESS_WEB_GOVERNANCE_CLI="$WORK/bin/fake-gov" \
  BIOHARNESS_WEB_LEDGER="$WORK/state/ledger.sqlite" \
  BIOHARNESS_WEB_MODEL_BASE_URL="http://127.0.0.1:$MODEL_PORT/v1" \
  BIOHARNESS_WEB_MODEL_API_KEY="$PROVIDER_KEY" \
  BIOHARNESS_WEB_MODEL_NAME="step4-model" \
  "$ROOT/.venv/bin/uvicorn" bioharness_web.app:create_app --factory \
    --host 127.0.0.1 --port "$PORT" >"$WORK/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 40); do
  if env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u all_proxy -u ALL_PROXY \
       curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

if ! env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u all_proxy -u ALL_PROXY \
     curl -sf "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
  echo "server failed to start" >&2
  cat "$WORK/server.log" >&2
  exit 1
fi

set +e
docker run --rm --network=host \
  -e "BASE_URL=http://127.0.0.1:$PORT" \
  -e "TOKEN=$TOKEN" \
  -e "PROVIDER_KEY=$PROVIDER_KEY" \
  -e "PLAYWRIGHT_MODULE=${PLAYWRIGHT_MODULE:-playwright}" \
  -v "$ROOT/tests/browser/ui_step4_check.cjs:/qa/check.cjs:ro" \
  -v "$WORK:/out" \
  "$IMAGE" node /qa/check.cjs
DOCKER_RC=$?
set -e

if [ "$DOCKER_RC" != "0" ]; then
  echo "step4 check failed (docker exit=$DOCKER_RC)" >&2
  cat "$WORK/server.log" >&2
  echo "artifacts: $WORK" >&2
  exit 1
fi

echo "STEP 4 CHROMIUM ACCEPTANCE PASSED"
