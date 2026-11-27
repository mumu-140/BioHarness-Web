#!/bin/bash
# Real-browser check of the adopted frontend against the unchanged backend.
#
#   tests/browser/ui_run.sh <container image with Node and Playwright Chromium>
#
# Needs: ui/client/dist built (see ui/README.md), the backend installed in .venv, the public
# bioharness-host and bioharness-governance CLIs, and docker. PLAYWRIGHT_MODULE names the
# module path inside the image if `require('playwright')` does not resolve there.
# No model endpoint is configured: this step has no conversation to conduct.
set -u
IMAGE="${1:?container image with Node and Playwright Chromium}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"; WS="$WORK/ws"; mkdir -p "$WORK/out"
TOKEN="ui-check-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
PORT="${BHWEB_CHECK_PORT:-18733}"
[ -f "$REPO/ui/client/dist/index.html" ] || { echo "ui/client/dist is not built"; exit 1; }

SERVER=""
cleanup() {
  if [ -n "$SERVER" ]; then
    kill "$SERVER" 2>/dev/null || true
    wait "$SERVER" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

"$REPO/.venv/bin/python" "$REPO/tests/contract/synthetic_workspace.py" "$WS" > /dev/null || exit 1
NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost" \
BIOHARNESS_WEB_WORKSPACES="{\"fixture\":\"$WS\"}" BIOHARNESS_WEB_ACCESS_TOKEN="$TOKEN" \
BIOHARNESS_WEB_PORT="$PORT" BIOHARNESS_WEB_STATIC_DIR="$REPO/ui/client/dist" \
  "$REPO/.venv/bin/python" -m bioharness_web > "$WORK/server.log" 2>&1 &
SERVER=$!
for _ in $(seq 1 40); do
  if "$REPO/.venv/bin/python" -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:$PORT/api/health', timeout=1)" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

cp "$REPO/tests/browser/ui_check.cjs" "$WORK/check.cjs"
timeout 240 docker run --rm --network host --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e BASE="http://127.0.0.1:$PORT" -e TOKEN="$TOKEN" \
  -e PLAYWRIGHT_MODULE="${PLAYWRIGHT_MODULE:-playwright}" \
  -v "$WORK":/qa --entrypoint node "$IMAGE" /qa/check.cjs
cleanup; SERVER=""

# The server's own access log is independent of what the browser tooling observed.
"$REPO/.venv/bin/python" - "$WORK" <<'PY'
import json, re, sys
work = sys.argv[1]
try:
    rows = json.load(open(work + "/out/results.json"))
except OSError:
    sys.exit("the browser produced no results")
approved = {("GET", "/api/meta"), ("GET", "/api/health"), ("POST", "/api/session")}
seen = set(re.findall(r'"(\w+) (/api/[^ ?"]*)[^"]*" \d+', open(work + "/server.log").read()))
extra = sorted(seen - approved)
rows.append({"name": "server access log shows only approved API paths", "ok": not extra and bool(seen),
             "detail": ", ".join(" ".join(item) for item in extra) or "no API request logged"})
for row in rows:
    print("PASS" if row["ok"] else "FAIL", row["name"], "" if row["ok"] else "-- " + row["detail"][:400])
print("TOTAL", sum(row["ok"] for row in rows), "/", len(rows))
for name in ("network.json", "refusals.json", "deep-link.json"):
    try:
        print(name, json.dumps(json.load(open(work + "/out/" + name))))
    except OSError:
        pass
sys.exit(0 if all(row["ok"] for row in rows) else 1)
PY
STATUS=$?
echo "artifacts: $WORK"
exit $STATUS
