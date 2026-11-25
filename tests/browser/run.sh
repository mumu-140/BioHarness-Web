#!/bin/bash
# Real-browser check of the built service against a fresh synthetic workspace.
#
#   tests/browser/run.sh <container image with Node and Playwright Chromium>
#
# Covers the read side and one conversation conducted through the native runtime with a
# scripted model endpoint.
# Needs: the frontend built (frontend/dist), the backend installed in .venv,
# the public bioharness-host and bioharness-governance CLIs, and docker.
# PLAYWRIGHT_MODULE names the module path inside the image if `require('playwright')`
# does not resolve there. Screenshots and results.json are left in the printed directory.
set -u
IMAGE="${1:?container image with Node and Playwright Chromium}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"; WS="$WORK/ws"; mkdir -p "$WORK/out"
TOKEN="browser-check-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
PORT="${BHWEB_CHECK_PORT:-18732}"

IDS="$("$REPO/.venv/bin/python" "$REPO/tests/contract/synthetic_workspace.py" "$WS")" || exit 1
RID="$(printf '%s' "$IDS" | "$REPO/.venv/bin/python" -c 'import json,sys; print(json.load(sys.stdin)["request_id"])')"

# The model is a scripted local endpoint: everything else in the conversation check is real.
"$REPO/.venv/bin/python" "$REPO/tests/support/scripted_provider.py" > "$WORK/provider.log" 2>&1 &
PROVIDER=$!
for _ in $(seq 1 50); do [ -s "$WORK/provider.log" ] && break; sleep 0.2; done
MODEL_URL="$(head -1 "$WORK/provider.log")"

BIOHARNESS_WEB_WORKSPACES="{\"fixture\":\"$WS\"}" BIOHARNESS_WEB_ACCESS_TOKEN="$TOKEN" \
BIOHARNESS_WEB_PORT="$PORT" BIOHARNESS_WEB_POLL_INTERVAL_SECONDS=1 \
BIOHARNESS_WEB_STATIC_DIR="$REPO/frontend/dist" \
BIOHARNESS_WEB_MODEL_BASE_URL="$MODEL_URL" BIOHARNESS_WEB_MODEL_API_KEY="sk-browser-check-not-real" \
BIOHARNESS_WEB_MODEL_NAME="scripted-fixture" BIOHARNESS_WEB_LEDGER="$WORK/ledger.sqlite3" \
  "$REPO/.venv/bin/python" -m bioharness_web > "$WORK/server.log" 2>&1 &
SERVER=$!
sleep 4

# Another host changes Core through its public CLI while the page stays open.
(
  for _ in $(seq 1 150); do [ -f "$WORK/out/ready" ] && break; sleep 1; done
  [ -f "$WORK/out/ready" ] || exit 0
  "$REPO/.venv/bin/python" "$REPO/tests/contract/synthetic_workspace.py" submit-compare "$WS" "$RID"
) &
WRITER=$!

cp "$REPO/tests/browser/check.cjs" "$WORK/check.cjs"
timeout 200 docker run --rm --network host --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e BASE="http://127.0.0.1:$PORT" -e TOKEN="$TOKEN" -e RID="$RID" -e WORKSPACE_DIR="$WS" \
  -e PLAYWRIGHT_MODULE="${PLAYWRIGHT_MODULE:-playwright}" \
  -v "$WORK":/qa --entrypoint node "$IMAGE" /qa/check.cjs
kill "$SERVER" "$WRITER" "$PROVIDER" 2>/dev/null; wait 2>/dev/null

"$REPO/.venv/bin/python" - "$WORK/out/results.json" <<'PY'
import json, sys
try:
    rows = json.load(open(sys.argv[1]))
except OSError:
    sys.exit("the browser produced no results")
for row in rows:
    print("PASS" if row["ok"] else "FAIL", row["name"], "" if row["ok"] else "-- " + row["detail"][:400])
print("TOTAL", sum(row["ok"] for row in rows), "/", len(rows))
sys.exit(0 if all(row["ok"] for row in rows) else 1)
PY
STATUS=$?
echo "artifacts: $WORK"
exit $STATUS
