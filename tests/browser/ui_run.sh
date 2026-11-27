#!/bin/bash
# Real-browser check of the adopted frontend against the BioHarness backend.
#
#   tests/browser/ui_run.sh <container image with Node and Playwright Chromium>
#
# Needs: ui/client/dist built (see ui/README.md), the backend installed in .venv, the public
# bioharness-host and bioharness-governance CLIs, and docker. PLAYWRIGHT_MODULE names the
# module path inside the image if `require('playwright')` does not resolve there.
# Set KEEP_ARTIFACTS=1 to keep the temp directory even on PASS; it is always kept on FAIL.
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
READY=0
for _ in $(seq 1 40); do
  if env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY "$REPO/.venv/bin/python" -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:$PORT/api/health', timeout=1)" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.25
done
[ "$READY" -eq 1 ] || { echo "backend failed to become healthy on port $PORT"; cat "$WORK/server.log"; exit 1; }

cp "$REPO/tests/browser/ui_check.cjs" "$WORK/check.cjs"
timeout 240 docker run --rm --network host --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e BASE="http://127.0.0.1:$PORT" -e TOKEN="$TOKEN" \
  -e PLAYWRIGHT_MODULE="${PLAYWRIGHT_MODULE:-playwright}" \
  -v "$WORK":/qa --entrypoint node "$IMAGE" /qa/check.cjs
DOCKER_RC=$?
cleanup; SERVER=""

# The server's own access log is independent of what the browser tooling observed.
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
    ("GET", re.compile(r"^/api/workspaces/[^/]+/views/(open|now|tree)$")),
    ("GET", re.compile(r"^/api/workspaces/[^/]+/stream$")),
]
seen = set(re.findall(r'"(\w+) (/api(?:/[^ ?"]*)?)[^"]*" \d+', open(work + "/server.log").read()))
extra = sorted(item for item in seen if not any(m == item[0] and p.match(item[1]) for m, p in approved))
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
PYEOF
STATUS=$?
if [ "$STATUS" -eq 0 ] && [ "${KEEP_ARTIFACTS:-0}" != "1" ]; then
  rm -rf "$WORK"
else
  echo "artifacts: $WORK"
fi
exit $STATUS
