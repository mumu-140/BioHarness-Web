#!/bin/bash
# Real-browser acceptance for §17.4 Step 3 (Native vertical slice) + C1-C4 closure.
#
#   PLAYWRIGHT_MODULE=/usr/src/app/node_modules/playwright #     tests/browser/ui_step3_run.sh firecrawl-playwright-service:latest
#
# Uses two real synthetic workspaces (via public bioharness-host/bioharness-governance CLIs),
# a local scripted OpenAI-compatible HTTP endpoint (step3_provider.py), a writable model config
# JSON, a real SQLite ledger (with one seeded OUTCOME_UNKNOWN conversation), and headless Chromium.
set -u
IMAGE="${1:?container image with Node and Playwright Chromium}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"; WS1="$WORK/ws1"; WS2="$WORK/ws2"; mkdir -p "$WORK/out"
TOKEN="step3-token-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
API_KEY_SECRET="sk-step3-secret-do-not-leak-9981"
PORT="${BHWEB_STEP3_PORT:-18734}"
[ -f "$REPO/ui/client/dist/index.html" ] || { echo "ui/client/dist is not built"; exit 1; }

SERVER=""
PROVIDER=""
cleanup() {
  for pid in "$SERVER" "$PROVIDER"; do
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT INT TERM

IDS1="$("$REPO/.venv/bin/python" "$REPO/tests/contract/synthetic_workspace.py" "$WS1")" || exit 1
"$REPO/.venv/bin/python" "$REPO/tests/contract/synthetic_workspace.py" "$WS2" > /dev/null || exit 1
OPEN_RID="$(printf '%s' "$IDS1" | "$REPO/.venv/bin/python" -c 'import json,sys; print(json.load(sys.stdin)["request_id"])')"
UNSCOPED_RID="$(printf '%s' "$IDS1" | "$REPO/.venv/bin/python" -c 'import json,sys; print(json.load(sys.stdin)["unscoped_id"])')"

# Seed one real OUTCOME_UNKNOWN conversation in the SQLite ledger matching UNSCOPED_RID's question.
LEDGER="$WORK/ledger.sqlite3"
UNKNOWN_CONVO_ID="$("$REPO/.venv/bin/python" - "$LEDGER" <<'PYSEED'
import sys
from pathlib import Path
from bioharness_web.ledger import Ledger
ledger = Ledger(Path(sys.argv[1]))
convo = ledger.create_conversation("fixture")
run_id = ledger.start_run(convo["id"])
op_id = ledger.start_operation(run_id, "core", "science_begin")
ledger.end_operation(op_id, "UNKNOWN")
ledger.append(convo["id"], run_id, "user.message", {"text": "Fixture unscoped question: what is a count table?"})
ledger.append(convo["id"], run_id, "operation.finished", {"kind": "core", "name": "science_begin", "state": "UNKNOWN", "output": {}})
ledger.end_run(run_id, "INTERRUPTED", "science_begin outcome unknown")
ledger.close()
print(convo["id"])
PYSEED
)" || exit 1

NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost" \
  "$REPO/.venv/bin/python" "$REPO/tests/browser/step3_provider.py" > "$WORK/provider.log" 2>&1 &
PROVIDER=$!
for _ in $(seq 1 50); do [ -s "$WORK/provider.log" ] && break; sleep 0.2; done
MODEL_URL="$(head -1 "$WORK/provider.log")"
[ -n "$MODEL_URL" ] || { echo "step3 provider failed to start"; cat "$WORK/provider.log"; exit 1; }

NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost" \
BIOHARNESS_WEB_WORKSPACES="{\"fixture\":\"$WS1\",\"second\":\"$WS2\"}" \
BIOHARNESS_WEB_ACCESS_TOKEN="$TOKEN" \
BIOHARNESS_WEB_PORT="$PORT" \
BIOHARNESS_WEB_POLL_INTERVAL_SECONDS=1 \
BIOHARNESS_WEB_STATIC_DIR="$REPO/ui/client/dist" \
BIOHARNESS_WEB_MODEL_BASE_URL="$MODEL_URL" \
BIOHARNESS_WEB_MODEL_API_KEY="$API_KEY_SECRET" \
BIOHARNESS_WEB_MODEL_NAME="scripted-fixture" \
BIOHARNESS_WEB_MODEL_CONFIG_PATH="$WORK/model_config.json" \
BIOHARNESS_WEB_LEDGER="$LEDGER" \
  "$REPO/.venv/bin/python" -m bioharness_web > "$WORK/server.log" 2>&1 &
SERVER=$!

READY=0
for _ in $(seq 1 40); do
  if env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY "$REPO/.venv/bin/python" -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:$PORT/api/health', timeout=1)" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.25
done
[ "$READY" -eq 1 ] || { echo "backend failed to start"; cat "$WORK/server.log"; exit 1; }

cp "$REPO/tests/browser/ui_step3_check.cjs" "$WORK/check.cjs"
timeout 300 docker run --rm --network host --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e BASE="http://127.0.0.1:$PORT" -e TOKEN="$TOKEN" \
  -e API_KEY_SECRET="$API_KEY_SECRET" \
  -e OPEN_RID="$OPEN_RID" \
  -e UNKNOWN_CONVO_ID="$UNKNOWN_CONVO_ID" \
  -e UNKNOWN_TARGET_RID="$UNSCOPED_RID" \
  -e PLAYWRIGHT_MODULE="${PLAYWRIGHT_MODULE:-playwright}" \
  -v "$WORK":/qa --entrypoint node "$IMAGE" /qa/check.cjs
DOCKER_RC=$?
cleanup; SERVER=""; PROVIDER=""

"$REPO/.venv/bin/python" - "$WORK" "$DOCKER_RC" <<'PYEOF'
import json, re, sys
work, docker_rc = sys.argv[1], int(sys.argv[2])
try:
    rows = json.load(open(work + "/out/results.json"))
except OSError:
    sys.exit(f"the browser produced no results (docker exit={docker_rc})")
rows.append({"name": "browser container exited cleanly", "ok": docker_rc == 0,
             "detail": f"exit code {docker_rc}"})
approved = [
    ("GET", re.compile(r"^/api/meta$")),
    ("GET", re.compile(r"^/api/health$")),
    ("POST", re.compile(r"^/api/session$")),
    ("GET", re.compile(r"^/api/settings/models$")),
    ("PUT", re.compile(r"^/api/settings/models$")),
    ("POST", re.compile(r"^/api/settings/models/fetch-models$")),
    ("POST", re.compile(r"^/api/settings/models/reset$")),
    ("GET", re.compile(r"^/api/workspaces/[^/]+/views/(open|now|tree)$")),
    ("GET", re.compile(r"^/api/workspaces/[^/]+/stream$")),
    ("GET", re.compile(r"^/api/workspaces/[^/]+/conversations$")),
    ("POST", re.compile(r"^/api/workspaces/[^/]+/conversations$")),
    ("GET", re.compile(r"^/api/workspaces/[^/]+/conversations/[^/]+$")),
    ("PUT", re.compile(r"^/api/workspaces/[^/]+/conversations/[^/]+/request$")),
    ("POST", re.compile(r"^/api/workspaces/[^/]+/conversations/[^/]+/runs$")),
    ("POST", re.compile(r"^/api/workspaces/[^/]+/conversations/[^/]+/runs/[^/]+/cancel$")),
    ("GET", re.compile(r"^/api/workspaces/[^/]+/conversations/[^/]+/events$")),
]
seen = set(re.findall(r'"(\w+) (/api(?:/[^ ?"]*)?)[^"]*" \d+', open(work + "/server.log").read()))
extra = sorted(item for item in seen if not any(m == item[0] and p.match(item[1]) for m, p in approved))
rows.append({"name": "server access log shows only approved Step 3 API paths", "ok": not extra and bool(seen),
             "detail": ", ".join(" ".join(item) for item in extra) or "no API request logged"})
for row in rows:
    print("PASS" if row["ok"] else "FAIL", row["name"], "" if row["ok"] else "-- " + row["detail"][:400])
print("TOTAL", sum(row["ok"] for row in rows), "/", len(rows))
try:
    print("network.json", json.dumps(json.load(open(work + "/out/network.json"))))
except OSError:
    pass
sys.exit(0 if all(row["ok"] for row in rows) else 1)
PYEOF
STATUS=$?
if [ "$STATUS" -eq 0 ] && [ "${KEEP_ARTIFACTS:-0}" != "1" ]; then
  rm -rf "$WORK"
else
  echo "artifacts: $WORK"
fi
exit $STATUS
