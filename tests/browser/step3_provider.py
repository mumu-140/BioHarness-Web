"""Scripted OpenAI-compatible HTTP endpoint for Step 3 real-browser acceptance.

Serves both `GET /v1/models` (for R2 model-discovery verification) and `POST /v1/chat/completions`
covering four deterministic scenarios driven by prompt markers:
  1. Default: science_plan -> science_submit -> science_deliver -> Markdown+KaTeX answer.
  2. `[amendment]`: science_plan -> mainline_amendment proposal (A1) -> waits for user's own
     `确认主线 A1` native-user submission before acknowledging v2.
  3. `[slow-cancel]`: streams slow chunks so browser can navigate away, reload, and cancel.
  4. `[provider-502]`: returns HTTP 502 to test provider-error handling.
Not a real model; plain local fixture server.
"""
from __future__ import annotations

import json
import socket
import sys
import threading
import time

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

PLAN = {
    "question_type": "EXPLAIN",
    "objective": "Explain what a count table is.",
    "requirements": ["Explain a count table"],
    "steps": [
        {
            "id": "survey",
            "kind": "KNOWLEDGE",
            "objective": "Summarise what a count table is.",
            "serves": ["R1"],
            "why": "answers R1",
            "deliverable": "summary",
        }
    ],
}

AMENDMENT = {
    "objective": "Explain what a count table is and how it is normalised.",
    "reason": "Step 3 fixture mainline amendment",
}


def _chunk(delta: dict, finish: str | None = None, model: str = "scripted-fixture") -> str:
    body = {
        "id": "chatcmpl-step3",
        "object": "chat.completion.chunk",
        "created": 0,
        "model": model,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    }
    return "data: " + json.dumps(body) + "\n\n"


def _pieces(text: str, size: int = 12) -> list[str]:
    return [text[i : i + size] for i in range(0, len(text), size)] or [""]


def _all_user_text(messages: list[dict]) -> str:
    return "\n".join(str(m.get("content") or "") for m in messages if m.get("role") == "user")


def _tool_results(messages: list[dict]) -> list[dict]:
    out = []
    for m in messages:
        if m.get("role") == "tool":
            try:
                out.append(json.loads(str(m.get("content") or "{}")))
            except Exception:
                out.append({})
    return out


def decide(messages: list[dict]) -> dict:
    user_text = _all_user_text(messages)
    tools_done = _tool_results(messages)

    if "[provider-502]" in user_text:
        return {"status": 502}

    if "[slow-cancel]" in user_text:
        return {
            "text": " ".join(f"chunk-{i}" for i in range(1, 55)),
            "delay": 0.12,
        }

    if "[amendment]" in user_text:
        if "确认主线 A1" in user_text:
            return {"text": "Confirmed amendment A1 applied on Core mainline v2 (fixture)."}
        if len(tools_done) == 0:
            return {"tool_calls": [{"name": "science_plan", "arguments": {"plan": PLAN}}]}
        if len(tools_done) == 1:
            return {
                "tool_calls": [
                    {"name": "science_plan", "arguments": {"plan": PLAN, "mainline_amendment": AMENDMENT}}
                ]
            }
        # Model writing the phrase itself never confirms an amendment.
        return {"text": "Proposed amendment A1. (Model text 确认主线 A1 does not confirm.)"}

    # Default full Core loop: plan -> submit -> deliver -> Markdown answer with GFM table + KaTeX
    if len(tools_done) == 0:
        return {
            "text": "Planning the work. ",
            "tool_calls": [{"name": "science_plan", "arguments": {"plan": PLAN}}],
        }
    if len(tools_done) == 1:
        return {
            "tool_calls": [
                {
                    "name": "science_submit",
                    "arguments": {
                        "step_id": "survey",
                        "status": "DONE",
                        "summary": "A count table holds counts per feature and sample (fixture).",
                        "evidence": [{"text": "Synthetic count-table definition.", "source": "fixture"}],
                    },
                }
            ]
        }
    if len(tools_done) == 2:
        return {
            "tool_calls": [
                {
                    "name": "science_deliver",
                    "arguments": {
                        "kind": "FINAL",
                        "answer": "A count table lists counts per feature and sample (fixture answer).",
                        "limitations": ["synthetic fixture"],
                    },
                }
            ]
        }
    return {
        "text": (
            "Delivered: a **count table** stores integer counts per gene and sample.\n\n"
            "| Sample | Count |\n|---|---:|\n| s1 | 3 |\n| s2 | 5 |\n\n"
            "Summary statistic: $R^2 = 0.99$."
        ),
        "delay": 0.02,
    }


def main() -> None:
    app = FastAPI()

    @app.get("/v1/models")
    async def list_models():
        return {
            "object": "list",
            "data": [
                {"id": "scripted-fixture", "object": "model"},
                {"id": "scripted-v2", "object": "model"},
            ],
        }

    @app.post("/v1/chat/completions")
    async def completions(request: Request):
        body = await request.json()
        model = str(body.get("model") or "scripted-fixture")
        answer = decide(body.get("messages", []))
        if "status" in answer:
            return JSONResponse(
                {"error": {"message": "scripted upstream 502 failure", "type": "server_error"}},
                status_code=int(answer["status"]),
            )

        def stream():
            yield _chunk({"role": "assistant", "content": ""}, model=model)
            for piece in _pieces(answer.get("text") or "") if answer.get("text") else []:
                yield _chunk({"content": piece}, model=model)
                if answer.get("delay"):
                    time.sleep(answer["delay"])
            calls = answer.get("tool_calls") or []
            for idx, call in enumerate(calls):
                args = call["arguments"]
                text = args if isinstance(args, str) else json.dumps(args, ensure_ascii=False)
                yield _chunk(
                    {
                        "tool_calls": [
                            {
                                "index": idx,
                                "id": f"call_step3_{idx}",
                                "type": "function",
                                "function": {"name": call["name"], "arguments": ""},
                            }
                        ]
                    },
                    model=model,
                )
                for piece in _pieces(text, 40):
                    yield _chunk(
                        {"tool_calls": [{"index": idx, "function": {"arguments": piece}}]},
                        model=model,
                    )
            yield _chunk({}, "tool_calls" if calls else "stop", model=model)
            yield "data: [DONE]\n\n"

        return StreamingResponse(stream(), media_type="text/event-stream")

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 10
    while not server.started:
        if time.time() > deadline:
            raise RuntimeError("step3 provider did not start")
        time.sleep(0.02)
    print(f"http://127.0.0.1:{port}/v1", flush=True)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        server.should_exit = True


if __name__ == "__main__":
    main()
