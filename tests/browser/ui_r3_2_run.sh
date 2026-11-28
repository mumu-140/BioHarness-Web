#!/bin/bash
# R3.2 real-browser acceptance: project/sub-project creation, restricted CSV/FASTA/PDF uploads,
# everyday model override, execution budget strategy, zh-Hans localization, and 390/320px layout.
set -u
IMAGE="${1:?container image with Node and Playwright Chromium}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
WS1="$WORK/ws_rw"
WS2="$WORK/ws_ro"
SAMPLES="$WORK/samples"
mkdir -p "$WS1/inputs" "$WS2" "$SAMPLES" "$WORK/out"

TOKEN="r32-token-$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
API_KEY_SECRET="sk-r32-secret-do-not-leak-8821"
PORT="${BHWEB_R32_PORT:-18741}"
[ -f "$REPO/ui/client/dist/index.html" ] || { echo "ui/client/dist is not built"; exit 1; }

printf 'gene,tpm\nAtGRF1,42.5\n' > "$SAMPLES/counts.csv"
printf '>AtGRF1\nATGCGTACGTAGCTAG\n' > "$SAMPLES/seqs.fasta"
printf '%%PDF-1.4\n%%synthetic R3.2 fixture\n' > "$SAMPLES/paper.pdf"

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

# Start local scripted OpenAI-compatible provider recording requested model names
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
    "objective": "Analyze PPGR expression and replicate grouping.",
    "requirements": ["Inspect uploaded inputs", "Summarize group comparison"],
    "steps": [
        {
            "id": "inspect",
            "kind": "KNOWLEDGE",
            "objective": "Inspect attached research inputs",
            "serves": ["R1"],
            "why": "Verify inputs before analysis",
            "deliverable": "input check",
        },
        {
            "id": "summarize",
            "kind": "ANALYSIS",
            "objective": "Summarize PPGR differential signal",
            "serves": ["R2"],
            "why": "Answer the research question",
            "depends_on": ["inspect"],
            "deliverable": "summary",
        },
    ],
}

def chunk(delta, finish=None, model="model-fast"):
    return "data: " + json.dumps({
        "id": "chatcmpl-r32",
        "object": "chat.completion.chunk",
        "created": 0,
        "model": model,
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
        decision = {
            "tool_calls": [{
                "name": "science_submit",
                "arguments": {
                    "step_id": "inspect",
                    "status": "DONE",
                    "summary": "Inputs checked (R3.2 fixture).",
                    "evidence": [{"text": "Fixture input inspection note", "source": "fixture"}],
                },
            }]
        }
    elif len(tools_done) == 2:
        decision = {
            "tool_calls": [{
                "name": "science_submit",
                "arguments": {
                    "step_id": "summarize",
                    "status": "DONE",
                    "summary": "Summary finished (R3.2 fixture).",
                    "evidence": [{"text": "Fixture differential summary", "source": "fixture"}],
                },
            }]
        }
    elif len(tools_done) == 3:
        decision = {
            "tool_calls": [{
                "name": "science_deliver",
                "arguments": {
                    "kind": "FINAL",
                    "answer": "R3.2 verified assistant reply: PPGR analysis delivered.",
                    "limitations": ["synthetic fixture"],
                },
            }]
        }
    else:
        decision = {"text": f"R3.2 verified assistant reply using model={model}."}

    async def gen():
        if "tool_calls" in decision:
            for idx, tc in enumerate(decision["tool_calls"]):
                yield chunk({
                    "role": "assistant",
                    "tool_calls": [{
                        "index": idx,
                        "id": f"call_{idx}_{len(tools_done)}",
                        "type": "function",
                        "function": {"name": tc["name"], "arguments": json.dumps(tc["arguments"])},
                    }],
                }, model=model)
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
[ -n "$MODEL_URL" ] || { echo "r3.2 provider failed to start"; cat "$WORK/provider.log"; exit 1; }

WORKSPACES_JSON=$(cat <<JSON
{"primary":{"path":"$WS1","upload_root":"$WS1/inputs"},"readonly":"$WS2"}
JSON
)
LEDGER="$WORK/ledger.sqlite3"
MODEL_CFG="$WORK/model_config.json"
cat > "$MODEL_CFG" <<JSON
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

NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost" \
BIOHARNESS_WEB_WORKSPACES="$WORKSPACES_JSON" \
BIOHARNESS_WEB_ACCESS_TOKEN="$TOKEN" \
BIOHARNESS_WEB_PORT="$PORT" \
BIOHARNESS_WEB_POLL_INTERVAL_SECONDS=1 \
BIOHARNESS_WEB_STATIC_DIR="$REPO/ui/client/dist" \
BIOHARNESS_WEB_MODEL_BASE_URL="$MODEL_URL" \
BIOHARNESS_WEB_MODEL_API_KEY="$API_KEY_SECRET" \
BIOHARNESS_WEB_MODEL_NAME="model-fast" \
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

cp "$REPO/tests/browser/ui_r3_2_check.cjs" "$WORK/check.cjs"
timeout 300 docker run --rm --network host --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e BASE="http://127.0.0.1:$PORT" -e TOKEN="$TOKEN" -e WORK_DIR="$WORK" \
  -e PLAYWRIGHT_MODULE="${PLAYWRIGHT_MODULE:-playwright}" \
  -v "$WORK":/qa --entrypoint node "$IMAGE" /qa/check.cjs
DOCKER_RC=$?
cleanup; SERVER=""; PROVIDER=""

"$REPO/.venv/bin/python" - "$WORK" "$DOCKER_RC" <<'PYEOF'
import json, sys
from pathlib import Path

work, docker_rc = Path(sys.argv[1]), int(sys.argv[2])
try:
    rows = json.loads((work / "out/results.json").read_text(encoding="utf-8"))
except OSError:
    sys.exit(f"browser produced no results (docker exit={docker_rc})")

rows.append({"name": "browser container exited cleanly", "ok": docker_rc == 0, "detail": f"exit={docker_rc}"})

prov_models = []
if (work / "provider_requests.jsonl").is_file():
    for line in (work / "provider_requests.jsonl").read_text(encoding="utf-8").splitlines():
        if line.strip():
            prov_models.append(json.loads(line)["model"])
rows.append({
    "name": "provider actually received per-run overridden model-deep",
    "ok": "model-deep" in prov_models,
    "detail": f"models={sorted(set(prov_models))}",
})

uploaded = sorted(p.name for p in (work / "ws_rw/inputs").rglob("*") if p.is_file())
rows.append({
    "name": "uploaded CSV/FASTA/PDF stored cleanly under authorized upload_root",
    "ok": {"counts.csv", "seqs.fasta", "paper.pdf"}.issubset(set(uploaded)),
    "detail": f"uploaded={uploaded}",
})

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
