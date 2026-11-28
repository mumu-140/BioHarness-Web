#!/bin/bash
# R3.3 real-browser acceptance: live bioharness-memory-mcp, Core doctor/resources,
# workspace SKILL.md, Governance project documents, Settings IA tabs & Diagnostics export.
set -u
export PATH="/home/yangs/.local/bin:$PATH"
IMAGE="${1:?container image with Node and Playwright Chromium}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
WS="$WORK/ws"
MEM_DIR="$WORK/memory"
SRC_DIR="$MEM_DIR/sources"
mkdir -p "$WS/.claude/skills/rna-qc" "$WS/inputs" "$SRC_DIR" "$WORK/out"
chmod 700 "$MEM_DIR" "$SRC_DIR"

TOKEN="r33-token-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
API_KEY_SECRET="sk-r33-secret-do-not-leak-9914"
PORT="${BHWEB_R33_PORT:-$("$REPO/.venv/bin/python" -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')}"
MEMORY_PY="/home/yangs/.local/share/bioharness-modules/memory/current/venv/bin/python"
HOST_CLI="${BIOHARNESS_HOST_CLI:-$(command -v bioharness-host || echo /home/yangs/.local/bin/bioharness-host)}"
[ -f "$REPO/ui/client/dist/index.html" ] || { echo "ui/client/dist is not built"; exit 1; }
[ -x "$MEMORY_PY" ] || { echo "bioharness-module-memory python missing: $MEMORY_PY"; exit 1; }
[ -x "$HOST_CLI" ] || { echo "bioharness-host missing: $HOST_CLI"; exit 1; }

# Seed real workspace SKILL.md + project documents + Core state
cat > "$WS/.claude/skills/rna-qc/SKILL.md" <<'EOF'
---
name: rna-qc
description: Validate FASTQ metrics and biological replicate independence
---
# RNA QC Skill
EOF
cat > "$WS/STATUS.md" <<'EOF'
# Project Status
All PPGR samples QC passed and differential design checked.
EOF
cat > "$WS/CONTRACT.md" <<'EOF'
# PPGR Study Contract
Primary endpoint: Wald BH FDR < 0.05 across >=3 biological replicates.
EOF

"$HOST_CLI" call "--workspace=$WS" science_begin - >/dev/null <<'JSON'
{"question":"Audit R3.3 PPGR capabilities and memory","scope":{"id":"PPGR","create":true}}
JSON
[ -d "$WS/.bioharness" ] || { echo "science_begin failed to initialize .bioharness"; exit 1; }
cat > "$WS/.bioharness/config.toml" <<'EOF'
[[resources]]
id = "echo-mod"
kind = "workflow"
title = "Echo scientific module"
how_to_use = "Invoke structured echo tool"
EOF
chmod 600 "$WS/.bioharness/config.toml"

# Seed isolated real Memory SQLite ledger using real Curator APIs
"$MEMORY_PY" - "$MEM_DIR" "$SRC_DIR" <<'PYSEED'
import hashlib, json, os, sys
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

mem_dir, src_dir = Path(sys.argv[1]), Path(sys.argv[2])
src_file = src_dir / "ppgr_notes.md"
raw_bytes = (
    "PPGR_LINE_1: Use DESeq2 with Wald test and BH FDR < 0.05 on >= 3 biological replicates.\n"
    "PPGR_LINE_2: Never pool technical replicates as independent biological replicates.\n"
).encode("utf-8")
src_file.write_bytes(raw_bytes)
src_file.chmod(0o600)
sha = hashlib.sha256(raw_bytes).hexdigest()
manifest = mem_dir / "source_manifest.json"
manifest.write_text(json.dumps({
    "scope_ref": "scope:ppgr-r33-ui",
    "source_id": "notes",
    "source_count": 1,
    "sources": [{"snapshot": "ppgr_notes.md", "source_id": "notes", "bytes": len(raw_bytes), "sha256": sha}],
}), encoding="utf-8")
manifest.chmod(0o600)
inbox = mem_dir / "candidates.jsonl"
inbox.touch()
os.chmod(inbox, 0o600)

db_path = mem_dir / "memory.sqlite3"
ledger = MemoryLedger(db_path, scope_ref="scope:ppgr-r33-ui", create=True)
source = NativeLineSource(root=src_dir, source_id="notes", allowed_files=("ppgr_notes.md",), allow_text=True)
rec1 = source.resolve(relative_path="ppgr_notes.md", record_index=1)
prop = CuratorProposal(
    memory_id="mem:ppgr-deseq2",
    revision=1,
    scope_ref="scope:ppgr-r33-ui",
    t1_core="Use DESeq2 Wald + BH FDR < 0.05 with >= 3 biological replicates",
    t2_detail={"method": "DESeq2 Wald + BH FDR", "threshold": "padj < 0.05", "min_replicates": 3},
    required_conditions={"research_area": "plant_motif_evolution"},
    evidence=(CuratorEvidence(anchor=rec1.source_anchor, exact_excerpt=rec1.text.strip()),),
)
dec = CuratorDecision(
    proposal_sha256=prop.digest(),
    disposition="accept_as_reported",
    reviewer_ref="reviewer:r33-ui",
    rationale="Verified source line anchor for R3.3 browser acceptance.",
)
publish_reviewed(prop, dec, source=source, ledger=ledger, event_id="evt-ui-mem-1", expected_revision=0)
themes = MemoryThemes(ledger)
basis = themes.summary_basis("t1:rnaseq-de", scope_ref="scope:ppgr-r33-ui", add_members=("mem:ppgr-deseq2",))
tp = ThemeProposal(
    t1_id="t1:rnaseq-de",
    base_revision=0,
    scope_ref="scope:ppgr-r33-ui",
    title="RNA-seq Differential Expression",
    scope="Statistical best practices for plant RNA-seq studies",
    cues=("DESeq2", "replicates", "FDR"),
    summary="Require >=3 biological replicates and BH FDR control.",
    summary_member_digest=basis,
    add_members=("mem:ppgr-deseq2",),
)
tdec = CuratorDecision(
    proposal_sha256=tp.digest(),
    disposition="accept_as_reported",
    reviewer_ref="reviewer:r33-ui",
    rationale="Verified theme for R3.3 browser acceptance.",
)
publish_theme(tp, tdec, themes=themes, ledger=ledger, event_id="evt-ui-theme-1")
PYSEED
[ $? -eq 0 ] || { echo "Memory fixture seed failed"; rm -rf "$WORK"; exit 1; }

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

LEDGER="$WORK/ledger.sqlite3"
"$REPO/.venv/bin/python" - "$LEDGER" <<'PYLEDGER'
import sys
from pathlib import Path
from bioharness_web.ledger import Ledger
l = Ledger(Path(sys.argv[1]))
c = l.create_conversation("primary")
r = l.start_run(c["id"])
op = l.start_operation(r, "tool", "structured")
l.end_operation(op, "SUCCEEDED")
l.append(c["id"], r, "tool.started", {"server": "echo-mod", "name": "structured"})
l.close()
PYLEDGER

SERVER=""
cleanup() {
  if [ -n "$SERVER" ]; then
    kill "$SERVER" 2>/dev/null || true
    wait "$SERVER" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

WORKSPACES_JSON=$(cat <<JSON
{"primary":{"path":"$WS","upload_root":"$WS/inputs"}}
JSON
)
MCP_JSON=$(cat <<JSON
{"bioharness-memory":["$MEM_WRAPPER"],"echo-mod":["$REPO/.venv/bin/python","$REPO/tests/support/echo_mcp.py"]}
JSON
)

NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost" \
BIOHARNESS_WEB_WORKSPACES="$WORKSPACES_JSON" \
BIOHARNESS_WEB_MCP_SERVERS="$MCP_JSON" \
BIOHARNESS_WEB_ACCESS_TOKEN="$TOKEN" \
BIOHARNESS_WEB_PORT="$PORT" \
BIOHARNESS_WEB_POLL_INTERVAL_SECONDS=1 \
BIOHARNESS_WEB_STATIC_DIR="$REPO/ui/client/dist" \
BIOHARNESS_WEB_MODEL_BASE_URL="http://127.0.0.1:9/v1" \
BIOHARNESS_WEB_MODEL_API_KEY="$API_KEY_SECRET" \
BIOHARNESS_WEB_MODEL_NAME="model-fast" \
BIOHARNESS_WEB_LEDGER="$LEDGER" \
  "$REPO/.venv/bin/python" -m bioharness_web > "$WORK/server.log" 2>&1 &
SERVER=$!

READY=0
for _ in $(seq 1 40); do
  kill -0 "$SERVER" 2>/dev/null || break
  if env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u all_proxy -u ALL_PROXY \
      curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.25
done
[ "$READY" -eq 1 ] || { echo "r3.3 server failed to start"; cat "$WORK/server.log"; exit 1; }

cp "$REPO/tests/browser/ui_r3_3_check.cjs" "$WORK/check.cjs"
timeout 300 docker run --rm --network host --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e BASE="http://127.0.0.1:$PORT" -e TOKEN="$TOKEN" -e SECRET_API_KEY="$API_KEY_SECRET" \
  -e PLAYWRIGHT_MODULE="${PLAYWRIGHT_MODULE:-playwright}" \
  -v "$WORK":/qa --entrypoint node "$IMAGE" /qa/check.cjs
DOCKER_RC=$?
cleanup; SERVER=""

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
