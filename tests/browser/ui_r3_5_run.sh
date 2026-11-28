#!/bin/bash
# R3.5 Full Product-Level Joint Acceptance Walkthrough:
# Exercises R3.2 + R3.3 + R3.4 + real server restart recovery + 1440/1024/390/320px viewports
# in one unified isolated researcher session against real Core, Governance, Memory MCP,
# Literature, Statistics report_binding, and Protein Methods CLIs.
set -u
export PATH="/home/yangs/.local/bin:$PATH"
IMAGE="${1:?container image with Node and Playwright Chromium}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
WS="$WORK/ws"
MEM_DIR="$WORK/memory"
SRC_DIR="$MEM_DIR/sources"
SAMPLES="$WORK/samples"
CTRL="$WORK/ctrl"
mkdir -p "$WS/.claude/skills/rna-qc" "$WS/inputs" "$SRC_DIR" "$SAMPLES" "$CTRL" "$WORK/out"
chmod 700 "$MEM_DIR" "$SRC_DIR"

TOKEN="r35-token-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
API_KEY_SECRET="sk-r35-secret-do-not-leak-7741"
PORT="${BHWEB_R35_PORT:-$("$REPO/.venv/bin/python" -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')}"
MEMORY_PY="/home/yangs/.local/share/bioharness-modules/memory/current/venv/bin/python"
[ -f "$REPO/ui/client/dist/index.html" ] || { echo "ui/client/dist is not built"; exit 1; }
[ -x "$MEMORY_PY" ] || { echo "bioharness-module-memory missing"; exit 1; }

# Seed small real format upload samples + SKILL.md + STATUS.md + Literature + Statistics + Protein PDB
printf 'gene,tpm\nAtGRF1,42.5\n' > "$SAMPLES/counts.csv"
printf '>AtGRF1\nATGCGTACGTAGCTAG\n' > "$SAMPLES/seqs.fasta"
printf '%%PDF-1.4\n%%synthetic R3.5 fixture\n' > "$SAMPLES/paper.pdf"

cat > "$WS/.claude/skills/rna-qc/SKILL.md" <<'EOF'
---
name: rna-qc
description: Validate FASTQ metrics and biological replicate independence
---
# RNA QC Skill
EOF
cat > "$WS/STATUS.md" <<'EOF'
# Project Status
All PPGR samples QC passed for R3.5 product acceptance.
EOF

FAKE_PS="$WORK/paperseek_stub"
cat > "$FAKE_PS" <<'PYPS'
#!/usr/bin/env python3
import json
print(json.dumps({
    "source": "openalex",
    "query": "GRF motif",
    "total_results": 25,
    "ranked": [
        {
            "rank": 1,
            "title": "Plant GRF-GIF Conserved Motifs",
            "authors": ["Kim JH"],
            "year": 2024,
            "venue": "Molecular Plant",
            "doi": "10.1016/j.molp.2024.01.001",
            "abstract": "Comparative plant motif study.",
            "url": "https://doi.org/10.1016/j.molp.2024.01.001",
        }
    ],
}))
PYPS
chmod 700 "$FAKE_PS"
bioharness-literature search "GRF motif" --output "$WORK/lit_out" --paperseek "$FAKE_PS" >/dev/null
cp "$WORK/lit_out/search.json" "$WS/search.json"

cat > "$WS/stats_bundle.json" <<'JSON'
{
  "records": [
    {
      "metric_id": "mut_rate",
      "unit": "proportion",
      "value": 0.15,
      "numerator": 6,
      "denominator": 40,
      "event": {"alteration": "ESR1_mut"},
      "given": {"cohort": "HRpos_post_tx"},
      "population": "cohort=HRpos_post_tx",
      "stratum": "alteration=ESR1_mut",
      "method": "Exact binomial Wilson 95% CI",
      "display_decimals": 1
    }
  ],
  "tables": []
}
JSON
cat > "$WS/answer.template.md" <<'MD'
Rate: {{stat:mut_rate}}.
MD
cat > "$WS/helix.pdb" <<'PDB'
ATOM      1  N   ALA A   1      11.104  13.207   2.100  1.00 20.00           N
ATOM      2  CA  ALA A   1      12.560  13.207   2.100  1.00 20.00           C
ATOM      3  C   ALA A   1      13.060  14.650   2.100  1.00 20.00           C
ATOM      4  O   ALA A   1      12.260  15.580   2.100  1.00 20.00           O
TER       5      ALA A   1
END
PDB

# Seed real Memory MCP ledger via Curator APIs
"$MEMORY_PY" - "$MEM_DIR" "$SRC_DIR" <<'PYSEED'
import hashlib, json, os, sys
from pathlib import Path
from bioharness_memory.curation import (
    CuratorDecision, CuratorEvidence, CuratorProposal, ThemeProposal,
    publish_reviewed, publish_theme,
)
from bioharness_memory.ledger import MemoryLedger
from bioharness_memory.sources.native_text import NativeLineSource
from bioharness_memory.themes import MemoryThemes

mem_dir, src_dir = Path(sys.argv[1]), Path(sys.argv[2])
src_file = src_dir / "ppgr_notes.md"
raw_bytes = b"PPGR_LINE_1: Use DESeq2 with Wald test and BH FDR < 0.05 on >= 3 biological replicates.\n"
src_file.write_bytes(raw_bytes)
src_file.chmod(0o600)
sha = hashlib.sha256(raw_bytes).hexdigest()
manifest = mem_dir / "source_manifest.json"
manifest.write_text(json.dumps({
    "scope_ref": "scope:ppgr-r35",
    "source_id": "notes",
    "source_count": 1,
    "sources": [{"snapshot": "ppgr_notes.md", "source_id": "notes", "bytes": len(raw_bytes), "sha256": sha}],
}), encoding="utf-8")
manifest.chmod(0o600)
inbox = mem_dir / "candidates.jsonl"
inbox.touch()
os.chmod(inbox, 0o600)

ledger = MemoryLedger(mem_dir / "memory.sqlite3", scope_ref="scope:ppgr-r35", create=True)
source = NativeLineSource(root=src_dir, source_id="notes", allowed_files=("ppgr_notes.md",), allow_text=True)
rec1 = source.resolve(relative_path="ppgr_notes.md", record_index=1)
prop = CuratorProposal(
    memory_id="mem:ppgr-deseq2", revision=1, scope_ref="scope:ppgr-r35",
    t1_core="Use DESeq2 Wald + BH FDR < 0.05 with >= 3 biological replicates",
    t2_detail={"method": "DESeq2 Wald + BH FDR", "threshold": "padj < 0.05"},
    required_conditions={"research_area": "plant_motif_evolution"},
    evidence=(CuratorEvidence(anchor=rec1.source_anchor, exact_excerpt=rec1.text.strip()),),
)
dec = CuratorDecision(proposal_sha256=prop.digest(), disposition="accept_as_reported",
                      reviewer_ref="reviewer:r35", rationale="Seeded for R3.5 joint acceptance.")
publish_reviewed(prop, dec, source=source, ledger=ledger, event_id="evt-r35-mem-1", expected_revision=0)
themes = MemoryThemes(ledger)
basis = themes.summary_basis("t1:rnaseq-de", scope_ref="scope:ppgr-r35", add_members=("mem:ppgr-deseq2",))
tp = ThemeProposal(t1_id="t1:rnaseq-de", base_revision=0, scope_ref="scope:ppgr-r35",
                   title="RNA-seq Differential Expression", scope="Plant RNA-seq statistics",
                   cues=("DESeq2", "replicates"), summary="Require >=3 biological replicates.",
                   summary_member_digest=basis, add_members=("mem:ppgr-deseq2",))
tdec = CuratorDecision(proposal_sha256=tp.digest(), disposition="accept_as_reported",
                       reviewer_ref="reviewer:r35", rationale="Seeded theme for R3.5.")
publish_theme(tp, tdec, themes=themes, ledger=ledger, event_id="evt-r35-theme-1")
PYSEED

MEM_WRAPPER="$MEM_DIR/run_memory_mcp.sh"
cat > "$MEM_WRAPPER" <<EOF
#!/bin/sh
set -eu
export BIOHARNESS_MEMORY_DB="$MEM_DIR/memory.sqlite3"
export BIOHARNESS_MEMORY_SOURCE_ROOT="$SRC_DIR"
export BIOHARNESS_MEMORY_MANIFEST="$MEM_DIR/source_manifest.json"
export BIOHARNESS_MEMORY_INBOX="$MEM_DIR/candidates.jsonl"
exec "$MEMORY_PY" -m bioharness_memory.mcp_server "\$@"
EOF
chmod 700 "$MEM_WRAPPER"

SERVER=""
PROVIDER=""
WATCHER=""
cleanup() {
  for pid in "$WATCHER" "$SERVER" "$PROVIDER"; do
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT INT TERM

# Start local scripted OpenAI-compatible provider
NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost" \
  "$REPO/.venv/bin/python" - "$WORK/provider_requests.jsonl" > "$WORK/provider.log" 2>&1 <<'PYPROV' &
import json, socket, sys, threading, time
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

log_path = sys.argv[1]
app = FastAPI()
PLAN = {
    "question_type": "ANALYZE",
    "objective": "Analyze PPGR differential expression and motif conservation.",
    "requirements": ["Inspect uploaded inputs", "Summarize group comparison"],
    "steps": [
        {"id": "inspect", "kind": "KNOWLEDGE", "objective": "Check inputs", "serves": ["R1"], "why": "Validate files", "deliverable": "check"},
        {"id": "analyze", "kind": "ANALYSIS", "objective": "Summarize results", "serves": ["R2"], "why": "Answer question", "depends_on": ["inspect"], "deliverable": "summary"},
    ],
}
def chunk(delta, finish=None, model="model-fast"):
    return "data: " + json.dumps({
        "id": "chatcmpl-r35", "object": "chat.completion.chunk", "created": 0, "model": model,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    }) + "\n\n"
@app.get("/v1/models")
async def models():
    return JSONResponse({"data": [{"id": "model-fast"}, {"id": "model-deep"}]})
@app.post("/v1/chat/completions")
async def completions(request: Request):
    body = await request.json()
    model = body.get("model", "model-fast")
    with open(log_path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps({"model": model}) + "\n")
    msgs = body.get("messages", [])
    tools_done = [m for m in msgs if m.get("role") == "tool"]
    if len(tools_done) == 0:
        decision = {"tool_calls": [{"name": "science_plan", "arguments": {"plan": PLAN}}]}
    elif len(tools_done) == 1:
        decision = {"tool_calls": [{"name": "science_submit", "arguments": {"step_id": "inspect", "status": "DONE", "summary": "Checked inputs.", "evidence": [{"text": "Input check ok", "source": "fixture"}]}}]}
    elif len(tools_done) == 2:
        decision = {"tool_calls": [{"name": "science_submit", "arguments": {"step_id": "analyze", "status": "DONE", "summary": "Completed analysis.", "evidence": [{"text": "Summary ok", "source": "fixture"}]}}]}
    elif len(tools_done) == 3:
        decision = {"tool_calls": [{"name": "science_deliver", "arguments": {"kind": "FINAL", "answer": "R3.5 verified assistant reply: analysis delivered.", "limitations": ["isolated acceptance fixture"]}}]}
    else:
        decision = {"text": f"R3.5 verified assistant reply using model={model}."}
    async def gen():
        if "tool_calls" in decision:
            for idx, tc in enumerate(decision["tool_calls"]):
                yield chunk({"role": "assistant", "tool_calls": [{"index": idx, "id": f"c_{idx}_{len(tools_done)}", "type": "function", "function": {"name": tc["name"], "arguments": json.dumps(tc["arguments"])}}]}, model=model)
            yield chunk({}, finish="tool_calls", model=model)
        else:
            yield chunk({"role": "assistant", "content": decision["text"]}, model=model)
            yield chunk({}, finish="stop", model=model)
        yield "data: [DONE]\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream")

sock = socket.socket()
sock.bind(("127.0.0.1", 0))
port = sock.getsockname()[1]
sock.close()
server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
t = threading.Thread(target=server.run, daemon=True)
t.start()
while not server.started:
    time.sleep(0.02)
print(f"http://127.0.0.1:{port}/v1", flush=True)
while True:
    time.sleep(1)
PYPROV
PROVIDER=$!
for _ in $(seq 1 50); do [ -s "$WORK/provider.log" ] && break; sleep 0.2; done
MODEL_URL="$(head -1 "$WORK/provider.log")"
[ -n "$MODEL_URL" ] || { echo "r3.5 provider failed"; exit 1; }

LEDGER="$WORK/ledger.sqlite3"
WORKSPACES_JSON=$(cat <<JSON
{"primary":{"path":"$WS","upload_root":"$WS/inputs"}}
JSON
)
MCP_JSON=$(cat <<JSON
{"bioharness-memory":["$MEM_WRAPPER"]}
JSON
)
cat > "$WORK/model_config.json" <<JSON
{
  "version": 1,
  "providers": [
    {
      "id": "env-default",
      "name": "测试网关",
      "protocol": "openai-compatible",
      "base_url": "$MODEL_URL",
      "api_key": "$API_KEY_SECRET",
      "models": ["model-fast", "model-deep"],
      "enabled": true,
      "timeout_seconds": 60.0,
      "source": "env"
    }
  ],
  "slots": {
    "chat": {"provider_id": "env-default", "model": "model-fast", "temperature": null, "max_tokens": null},
    "vision": {"provider_id": null, "model": "", "image_size": "1024x1024"},
    "speech": {"provider_id": null, "asr_model": "", "tts_model": "", "voice": "alloy"},
    "embedding": {"provider_id": null, "model": "", "dimensions": null}
  }
}
JSON

start_server() {
  NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost" \
  BIOHARNESS_WEB_WORKSPACES="$WORKSPACES_JSON" \
  BIOHARNESS_WEB_MCP_SERVERS="$MCP_JSON" \
  BIOHARNESS_WEB_ACCESS_TOKEN="$TOKEN" \
  BIOHARNESS_WEB_PORT="$PORT" \
  BIOHARNESS_WEB_POLL_INTERVAL_SECONDS=1 \
  BIOHARNESS_WEB_STATIC_DIR="$REPO/ui/client/dist" \
  BIOHARNESS_WEB_MODEL_BASE_URL="$MODEL_URL" \
  BIOHARNESS_WEB_MODEL_API_KEY="$API_KEY_SECRET" \
  BIOHARNESS_WEB_MODEL_NAME="model-fast" \
  BIOHARNESS_WEB_LEDGER="$LEDGER" \
    "$REPO/.venv/bin/python" -m bioharness_web >> "$WORK/server.log" 2>&1 &
  SERVER=$!
  echo "$SERVER" > "$WORK/server.pid"
  for _ in $(seq 1 40); do
    kill -0 "$SERVER" 2>/dev/null || return 1
    if env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u all_proxy -u ALL_PROXY \
        curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

start_server || { echo "r3.5 server failed to start"; cat "$WORK/server.log"; exit 1; }

# Background restart watcher for live restart recovery test
(
  while true; do
    if [ -f "$CTRL/restart.req" ]; then
      rm -f "$CTRL/restart.req"
      OLD_PID="$(cat "$WORK/server.pid" 2>/dev/null || true)"
      if [ -n "$OLD_PID" ]; then
        kill "$OLD_PID" 2>/dev/null || true
        for _ in $(seq 1 30); do kill -0 "$OLD_PID" 2>/dev/null || break; sleep 0.2; done
      fi
      start_server && touch "$CTRL/restart.done"
      break
    fi
    sleep 0.2
  done
) &
WATCHER=$!

cp "$REPO/tests/browser/ui_r3_5_check.cjs" "$WORK/check.cjs"
timeout 360 docker run --rm --network host --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e BASE="http://127.0.0.1:$PORT" -e TOKEN="$TOKEN" -e SECRET_API_KEY="$API_KEY_SECRET" \
  -e PLAYWRIGHT_MODULE="${PLAYWRIGHT_MODULE:-playwright}" \
  -v "$WORK":/qa --entrypoint node "$IMAGE" /qa/check.cjs
DOCKER_RC=$?
if [ -f "$WORK/server.pid" ]; then SERVER="$(cat "$WORK/server.pid")"; fi
cleanup; SERVER=""; PROVIDER=""; WATCHER=""

"$REPO/.venv/bin/python" - "$WORK" "$DOCKER_RC" <<'PYEOF'
import json, sys
from pathlib import Path
work, docker_rc = Path(sys.argv[1]), int(sys.argv[2])
try:
    rows = json.loads((work / "out/results.json").read_text(encoding="utf-8"))
except OSError:
    sys.exit(f"browser produced no results (docker exit={docker_rc})")
rows.append({"name": "browser container exited cleanly", "ok": docker_rc == 0, "detail": f"exit={docker_rc}"})
for row in rows:
    print("PASS" if row["ok"] else "FAIL", row["name"], "" if row["ok"] else "-- " + row["detail"][:300])
print("TOTAL", sum(row["ok"] for row in rows), "/", len(rows))
sys.exit(0 if all(row["ok"] for row in rows) else 1)
PYEOF
STATUS=$?
if [ "$STATUS" -eq 0 ] && [ "${KEEP_ARTIFACTS:-0}" != "1" ]; then
  rm -rf "$WORK"
else
  echo "artifacts: $WORK"
fi
exit $STATUS
