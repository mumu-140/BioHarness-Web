#!/bin/bash
# R3.4 real-browser acceptance: Literature artifact/pagination, real Statistics report_binding
# render & drift verify, Scientific Review honest gap disclosure, real Protein Methods
# structure-inventory CLI, Execution inspector domain card, and 390/320px responsiveness.
set -u
export PATH="/home/yangs/.local/bin:$PATH"
IMAGE="${1:?container image with Node and Playwright Chromium}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
WS="$WORK/ws"
mkdir -p "$WS" "$WORK/out"

TOKEN="r34-token-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
PORT="${BHWEB_R34_PORT:-$("$REPO/.venv/bin/python" -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')}"
[ -f "$REPO/ui/client/dist/index.html" ] || { echo "ui/client/dist is not built"; exit 1; }

# 1. Generate a genuine 12-paper search.json via real bioharness-literature CLI + contract stub
FAKE_PS="$WORK/paperseek_stub"
cat > "$FAKE_PS" <<'PYPS'
#!/usr/bin/env python3
import json
ranked = [
    {
        "rank": i,
        "title": f"Plant GRF-GIF Regulatory Paper #{i}",
        "authors": ["Kim JH", "Li Y"],
        "year": 2020 + (i % 6),
        "venue": "Molecular Plant",
        "doi": f"10.1016/j.molp.2024.01.{i:03d}" if i < 12 else "",
        "abstract": f"Empirical motif conservation study #{i} in angiosperms.",
        "url": f"https://doi.org/10.1016/j.molp.2024.01.{i:03d}",
    }
    for i in range(1, 13)
]
print(json.dumps({"source": "openalex", "query": "GRF motif", "total_results": 42, "ranked": ranked}))
PYPS
chmod 700 "$FAKE_PS"
bioharness-literature search "GRF motif" --output "$WORK/lit_out" --paperseek "$FAKE_PS" >/dev/null
cp "$WORK/lit_out/search.json" "$WS/search.json"

# 2. Seed real Statistics report_binding bundle, template, and drifted report
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
      "status": "significant"
    }
  ],
  "tables": []
}
JSON
cat > "$WS/answer.template.md" <<'MD'
Rate: {{stat:mut_rate}}. Model effect: {{stat:de_or}}.
MD
cat > "$WS/answer_drifted.txt" <<'TXT'
Rate: P(alteration=ESR1_mut | cohort=HRpos_post_tx) = 19.0%(6/40). Model effect: 2.45.
TXT

# 3. Seed real PDB for bioharness-protein-methods structure-inventory
cat > "$WS/helix.pdb" <<'PDB'
ATOM      1  N   ALA A   1      11.104  13.207   2.100  1.00 20.00           N
ATOM      2  CA  ALA A   1      12.560  13.207   2.100  1.00 20.00           C
ATOM      3  C   ALA A   1      13.060  14.650   2.100  1.00 20.00           C
ATOM      4  O   ALA A   1      12.260  15.580   2.100  1.00 20.00           O
TER       5      ALA A   1
END
PDB

# 4. Seed Web ledger with a real observed protein-methods output for Execution Inspector test
PM_OUT="$(bioharness-protein-methods structure-inventory "$WS/helix.pdb")"
LEDGER="$WORK/ledger.sqlite3"
"$REPO/.venv/bin/python" - "$LEDGER" "$PM_OUT" <<'PYLEDGER'
import json, sys
from pathlib import Path
from bioharness_web.ledger import Ledger
l = Ledger(Path(sys.argv[1]))
c = l.create_conversation("primary")
r = l.start_run(c["id"])
op = l.start_operation(r, "tool", "structure-inventory")
l.append(c["id"], r, "operation.started", {"operation_id": op, "kind": "tool", "name": "structure-inventory", "server": "protein-methods", "input": {"input": "helix.pdb"}})
l.end_operation(op, "SUCCEEDED")
l.append(c["id"], r, "operation.finished", {"operation_id": op, "kind": "tool", "name": "structure-inventory", "server": "protein-methods", "state": "SUCCEEDED", "output": json.loads(sys.argv[2])})
l.end_run(r, "COMPLETED")
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
{"primary":{"path":"$WS"}}
JSON
)

NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost" \
BIOHARNESS_WEB_WORKSPACES="$WORKSPACES_JSON" \
BIOHARNESS_WEB_ACCESS_TOKEN="$TOKEN" \
BIOHARNESS_WEB_PORT="$PORT" \
BIOHARNESS_WEB_POLL_INTERVAL_SECONDS=1 \
BIOHARNESS_WEB_STATIC_DIR="$REPO/ui/client/dist" \
BIOHARNESS_WEB_MODEL_BASE_URL="http://127.0.0.1:9/v1" \
BIOHARNESS_WEB_MODEL_API_KEY="sk-r34-secret-0000" \
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
[ "$READY" -eq 1 ] || { echo "r3.4 server failed to start"; cat "$WORK/server.log"; exit 1; }

cp "$REPO/tests/browser/ui_r3_4_check.cjs" "$WORK/check.cjs"
timeout 300 docker run --rm --network host --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e BASE="http://127.0.0.1:$PORT" -e TOKEN="$TOKEN" \
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
