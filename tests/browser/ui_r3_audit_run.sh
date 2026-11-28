#!/bin/bash
# R3 Post-Audit Real-User-Path Chromium Acceptance Runner:
# Exercises two isolated workspaces (primary & secondary), real Core/Governance/Statistics CLIs,
# scripted OpenAI provider logging every request (verifying verbatim question + separate attachment
# delivery + interrupted-then-thorough-resumed completion), and real server restart recovery.
set -u
export PATH="/home/yangs/.local/bin:$PATH"
IMAGE="${1:?container image with Node and Playwright Chromium}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
WS1="$WORK/ws_primary"
WS2="$WORK/ws_secondary"
SAMPLES="$WORK/samples"
CTRL="$WORK/ctrl"
mkdir -p "$WS1/inputs" "$WS2/inputs" "$SAMPLES" "$CTRL" "$WORK/out"

TOKEN="r3audit-token-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
API_KEY_SECRET="sk-r3audit-secret-do-not-leak-9918"
PORT="${BHWEB_R3AUDIT_PORT:-$("$REPO/.venv/bin/python" -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')}"

[ -f "$REPO/ui/client/dist/index.html" ] || { echo "ui/client/dist is not built"; exit 1; }

# Seed real input files in samples & primary workspace (secondary stays cleanly separate)
printf 'gene,baseline,treatment\nG1,10.2,28.6\nG2,5.4,14.1\n' > "$SAMPLES/counts.csv"
cat > "$WS1/stats_bundle.json" <<'JSON'
{
  "records": [
    {
      "metric_id": "response_rate",
      "unit": "proportion",
      "value": 0.4,
      "numerator": 8,
      "denominator": 20,
      "event": {"outcome": "responder"},
      "given": {"arm": "treatment"},
      "population": "arm=treatment",
      "stratum": "outcome=responder",
      "method": "Exact binomial Wilson 95% CI",
      "display_decimals": 1
    }
  ],
  "tables": []
}
JSON
cat > "$WS1/answer.template.md" <<'MD'
Observed rate: {{stat:response_rate}}.
MD

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
  rm -rf "$WORK"
}
trap cleanup EXIT INT TERM

# Start local scripted OpenAI-compatible provider that logs full requests and supports
# normal runs AND INTERRUPT_THEN_RESUME multi-run recovery!
NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost" \
  "$REPO/.venv/bin/python" - "$WORK/provider_requests.jsonl" > "$WORK/provider.log" 2>&1 <<'PYPROV' &
import json, socket, sys, threading, time
import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

log_path = sys.argv[1]
app = FastAPI()
pause_counts = {}

PLAN = {
    "question_type": "EXPLAIN",
    "objective": "Explain and deliver grounded summary.",
    "requirements": ["Inspect inputs and deliver verified summary"],
    "steps": [
        {"id": "step1", "kind": "KNOWLEDGE", "objective": "Summarize inputs", "serves": ["R1"], "why": "Ground conclusions", "deliverable": "summary"},
    ],
}
SUBMIT_DONE = {
    "step_id": "step1",
    "status": "DONE",
    "summary": "Inspected attached input file cleanly.",
    "evidence": [{"text": "Verified attached workspace input file metadata.", "source": "fixture"}],
}
DELIVER_DONE = {
    "kind": "FINAL",
    "answer": "Audit verified reply grounded in workspace inputs.",
    "limitations": ["isolated acceptance fixture"],
}

def chunk(delta, finish=None, model="model-fast"):
    return "data: " + json.dumps({
        "id": "chatcmpl-audit", "object": "chat.completion.chunk", "created": 0, "model": model,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    }) + "\n\n"

@app.get("/v1/models")
async def models():
    return JSONResponse({"data": [{"id": "model-fast"}, {"id": "model-deep"}]})

@app.post("/v1/chat/completions")
async def completions(request: Request):
    body = await request.json()
    model = body.get("model", "model-fast")
    msgs = body.get("messages", [])
    with open(log_path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps({"model": model, "messages": msgs}, ensure_ascii=False) + "\n")

    all_text = json.dumps(msgs, ensure_ascii=False)
    tools_done = [m for m in msgs if m.get("role") == "tool"]

    if "INTERRUPT_THEN_RESUME" in all_text:
        # First run: plan -> 3 text-only pauses -> Core releases stop hook -> INTERRUPTED.
        # Second run (resumed): Core already has plan (system prompt shows NEEDS_STEP / step1) -> submit -> deliver -> finish!
        if "NEEDS_PLAN" in all_text and len(tools_done) == 0:
            decision = {"tool_calls": [{"name": "science_plan", "arguments": {"plan": PLAN}}]}
        elif "NEEDS_PLAN" in all_text and len(tools_done) >= 1:
            # Still inside run 1 after planning: pause 3 times to trigger INTERRUPTED
            decision = {"text": "Interim progress note without tool call."}
        elif len(tools_done) == 0:
            # Resumed run 2 starts with Core in NEEDS_STEP!
            decision = {"tool_calls": [{"name": "science_submit", "arguments": {**SUBMIT_DONE, "summary": "Completed resumed step with thorough budget."}}]}
        elif len(tools_done) == 1:
            decision = {"tool_calls": [{"name": "science_deliver", "arguments": {**DELIVER_DONE, "answer": "Resumed and delivered cleanly after interruption."}}]}
        else:
            decision = {"text": "Resumed and delivered cleanly."}
    else:
        if len(tools_done) == 0:
            decision = {"tool_calls": [{"name": "science_plan", "arguments": {"plan": PLAN}}]}
        elif len(tools_done) == 1:
            decision = {"tool_calls": [{"name": "science_submit", "arguments": SUBMIT_DONE}]}
        elif len(tools_done) == 2:
            decision = {"tool_calls": [{"name": "science_deliver", "arguments": DELIVER_DONE}]}
        else:
            decision = {"text": f"Audit verified reply using model={model}."}

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
[ -n "$MODEL_URL" ] || { echo "audit provider failed"; exit 1; }

LEDGER="$WORK/ledger.sqlite3"
WORKSPACES_JSON=$(cat <<JSON
{"primary":{"path":"$WS1","upload_root":"$WS1/inputs"},"secondary":{"path":"$WS2","upload_root":"$WS2/inputs"}}
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
  BIOHARNESS_WEB_ACCESS_TOKEN="$TOKEN" \
  BIOHARNESS_WEB_SERVICE_ID="qa-r3-audit" \
  BIOHARNESS_WEB_STATIC_DIR="$REPO/ui/client/dist" \
  BIOHARNESS_WEB_LEDGER="$LEDGER" \
  BIOHARNESS_WEB_MODEL_CONFIG="$WORK/model_config.json" \
  BIOHARNESS_WEB_MODEL_BASE_URL="$MODEL_URL" \
  BIOHARNESS_WEB_MODEL_API_KEY="$API_KEY_SECRET" \
  BIOHARNESS_WEB_MODEL_NAME="model-fast" \
  PYTHONPATH="$REPO/backend" \
    "$REPO/.venv/bin/uvicorn" bioharness_web.app:create_app --factory \
      --host 127.0.0.1 --port "$PORT" >> "$WORK/server.log" 2>&1 &
  SERVER=$!
  echo "$SERVER" > "$WORK/server.pid"
  for _ in $(seq 1 50); do
    curl -fsS --noproxy '*' "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1 && return 0
    sleep 0.2
  done
  return 1
}

start_server || { echo "server did not start"; cat "$WORK/server.log"; exit 1; }

(
  while true; do
    if [ -f "$CTRL/restart.req" ]; then
      rm -f "$CTRL/restart.req"
      OLD_PID="$(cat "$WORK/server.pid" 2>/dev/null || true)"
      if [ -n "$OLD_PID" ]; then
        kill "$OLD_PID" 2>/dev/null || true
        wait "$OLD_PID" 2>/dev/null || true
      fi
      sleep 0.4
      start_server && touch "$CTRL/restart.done"
    fi
    sleep 0.2
  done
) &
WATCHER=$!

docker run --rm --network host \
  --user "$(id -u):$(id -g)" \
  -e BASE="http://127.0.0.1:$PORT" \
  -e TOKEN="$TOKEN" \
  -e SECRET_API_KEY="$API_KEY_SECRET" \
  -e PLAYWRIGHT_MODULE=/usr/src/app/node_modules/playwright \
  -e NODE_PATH=/usr/src/app/node_modules \
  -v "$REPO/tests/browser:/qa/tests:ro" \
  -v "$SAMPLES:/qa/samples:ro" \
  -v "$WORK:/qa/work:ro" \
  -v "$CTRL:/qa/ctrl" \
  -v "$WORK/out:/qa/out" \
  "$IMAGE" node /qa/tests/ui_r3_audit_check.cjs
STATUS=$?

echo "=== R3 Post-Audit Real-User-Path Chromium Acceptance Results ==="
cat "$WORK/out/results.json" 2>/dev/null || true
if [ "$STATUS" -ne 0 ]; then
  echo "--- server log tail ---"
  tail -n 60 "$WORK/server.log" || true
fi
exit "$STATUS"
