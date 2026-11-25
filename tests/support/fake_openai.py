"""A local stand-in for an OpenAI-compatible chat-completions endpoint.

It streams whatever a script function decides for each request, so the real
provider adapter (HTTP, SSE, tool-call assembly) is exercised without a
provider account. Nothing here is a model: the script is plain test code.
"""
from __future__ import annotations

import json
import socket
import threading
import time
from typing import Callable

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

# script(messages, tools) -> {"text": str | None, "tool_calls": [{"name": str, "arguments": dict | str}]}
#                         or {"status": 500} to fail the request
Script = Callable[[list[dict], list[dict]], dict]


def _chunk(delta: dict, finish: str | None = None) -> str:
    body = {"id": "chatcmpl-fake", "object": "chat.completion.chunk", "created": 0, "model": "fake-model",
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}
    return "data: " + json.dumps(body) + "\n\n"


def _pieces(text: str, size: int = 7) -> list[str]:
    return [text[i:i + size] for i in range(0, len(text), size)] or [""]


class FakeOpenAI:
    def __init__(self, script: Script):
        self.script = script
        self.requests: list[dict] = []
        self.authorization: list[str | None] = []
        app = FastAPI()

        @app.post("/v1/chat/completions")
        async def completions(request: Request):
            body = await request.json()
            self.requests.append(body)
            self.authorization.append(request.headers.get("authorization"))
            answer = self.script(body.get("messages", []), body.get("tools", []))
            if "status" in answer:
                return JSONResponse({"error": {"message": "scripted failure", "type": "server_error"}},
                                    status_code=answer["status"])

            def stream():
                yield _chunk({"role": "assistant", "content": ""})
                if answer.get("reasoning"):  # what a reasoning-capable provider sends before its answer
                    yield _chunk({"reasoning_content": answer["reasoning"]})
                for piece in _pieces(answer.get("text") or "") if answer.get("text") else []:
                    yield _chunk({"content": piece})
                    time.sleep(answer.get("delay", 0))
                calls = answer.get("tool_calls") or []
                for index, call in enumerate(calls):
                    arguments = call["arguments"]
                    text = arguments if isinstance(arguments, str) else json.dumps(arguments, ensure_ascii=False)
                    yield _chunk({"tool_calls": [{"index": index, "id": f"call_{len(self.requests)}_{index}",
                                                  "type": "function",
                                                  "function": {"name": call["name"], "arguments": ""}}]})
                    for piece in _pieces(text, 40):
                        yield _chunk({"tool_calls": [{"index": index, "function": {"arguments": piece}}]})
                yield _chunk({}, "tool_calls" if calls else "stop")
                usage = {"prompt_tokens": 11, "completion_tokens": 7, "total_tokens": 18}
                yield "data: " + json.dumps({"id": "chatcmpl-fake", "object": "chat.completion.chunk", "created": 0,
                                             "model": "fake-model", "choices": [], "usage": usage}) + "\n\n"
                yield "data: [DONE]\n\n"

            return StreamingResponse(stream(), media_type="text/event-stream")

        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            self.port = probe.getsockname()[1]
        self._server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=self.port, log_level="error"))
        self._thread = threading.Thread(target=self._server.run, daemon=True)

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}/v1"

    def __enter__(self) -> "FakeOpenAI":
        self._thread.start()
        deadline = time.time() + 10
        while not self._server.started:
            if time.time() > deadline:
                raise RuntimeError("fake provider did not start")
            time.sleep(0.02)
        return self

    def __exit__(self, *exc) -> None:
        self._server.should_exit = True
        self._thread.join(timeout=10)
