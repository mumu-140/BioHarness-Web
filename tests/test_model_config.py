"""Tests for R2-B atomic model & multimodal configuration API."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from bioharness_web.app import create_app
from bioharness_web.settings import ModelSettings, Settings, Workspace


def _make_app(tmp_path: Path):
    ws = tmp_path / "ws"
    ws.mkdir()
    ledger = tmp_path / "state" / "ledger.sqlite3"
    ledger.parent.mkdir()
    settings = Settings(
        service_id="test-web",
        workspaces={"main": Workspace(id="main", path=ws, evidence_roots=(ws,))},
        access_token="secret-token-for-testing-1234",
        model=ModelSettings(
            base_url="http://127.0.0.1:9999/v1/",
            api_key="sk-env-secret-9999",
            name="env/default-model",
        ),
        ledger_path=ledger,
    )
    app = create_app(settings)
    headers = {"Authorization": f"Bearer {settings.access_token}"}
    return app, TestClient(app), headers, ledger.parent / "model_config.json"


def test_model_config_masks_keys_and_hot_reloads_chat(tmp_path: Path):
    app, client, headers, cfg_path = _make_app(tmp_path)
    with client:
        res = client.get("/api/settings/models", headers=headers)
        assert res.status_code == 200
        body = res.json()
        assert body["editable"] is True
        assert body["active_chat_model"] == "env/default-model"
        assert body["providers"][0]["has_api_key"] is True
        assert "sk-env-secret-9999" not in res.text

        # Save new provider + bind chat, vision, speech, embedding slots
        put = client.put(
            "/api/settings/models",
            headers=headers,
            json={
                "providers": [
                    {
                        "id": "env-default",
                        "name": "默认网关",
                        "protocol": "openai-compatible",
                        "base_url": "http://127.0.0.1:9999/v1/",
                        "api_key": None,  # preserve existing key
                        "models": ["env/default-model", "auto/gpt-5"],
                        "enabled": True,
                        "timeout_seconds": 180.0,
                    },
                    {
                        "id": "ollama",
                        "name": "本地 Ollama",
                        "protocol": "openai-compatible",
                        "base_url": "http://127.0.0.1:11434/v1",
                        "api_key": "ollama-local-key",
                        "models": ["bge-m3"],
                        "enabled": True,
                        "timeout_seconds": 120.0,
                    },
                ],
                "slots": {
                    "chat": {
                        "provider_id": "env-default",
                        "model": "auto/gpt-5",
                        "temperature": 0.2,
                        "max_tokens": 4096,
                    },
                    "vision": {
                        "provider_id": "env-default",
                        "model": "auto/gpt-5",
                        "image_size": "1536x1024",
                    },
                    "speech": {
                        "provider_id": "env-default",
                        "asr_model": "whisper-1",
                        "tts_model": "tts-1",
                        "voice": "nova",
                    },
                    "embedding": {
                        "provider_id": "ollama",
                        "model": "bge-m3",
                        "dimensions": 1024,
                    },
                },
            },
        )
        assert put.status_code == 200
        updated = put.json()
        assert updated["applied_chat"] is True
        assert updated["active_chat_model"] == "auto/gpt-5"
        assert "sk-env-secret-9999" not in put.text
        assert "ollama-local-key" not in put.text
        assert cfg_path.is_file()
        assert (cfg_path.stat().st_mode & 0o777) == 0o600
        assert app.state.runtime.model.settings.name == "auto/gpt-5"
        assert app.state.runtime.model.settings.api_key == "sk-env-secret-9999"

        # /api/meta reflects hot-reloaded model immediately
        meta = client.get("/api/meta", headers=headers).json()
        assert meta["runtime"]["model"] == "auto/gpt-5"

        # Reset restores env default
        reset = client.post("/api/settings/models/reset", headers=headers)
        assert reset.status_code == 200
        assert reset.json()["active_chat_model"] == "env/default-model"
        assert not cfg_path.exists()


def test_fetch_models_uses_stored_credentials(tmp_path: Path):
    _, client, headers, _ = _make_app(tmp_path)
    with client, patch(
        "bioharness_web.model_config.fetch_remote_models",
        new=AsyncMock(return_value={"ok": True, "models": ["m-a", "m-b"], "latency_ms": 42, "error": None}),
    ) as mocked:
        res = client.post(
            "/api/settings/models/fetch-models",
            headers=headers,
            json={"provider_id": "env-default"},
        )
        assert res.status_code == 200
        assert res.json()["models"] == ["m-a", "m-b"]
        mocked.assert_awaited_once_with("http://127.0.0.1:9999/v1/", "sk-env-secret-9999")


def test_inflight_run_keeps_model_snapshot_across_reconfigure(tmp_path: Path):
    """Hot-reloading model settings mid-run must NOT mutate an in-flight multi-turn run;
    all turns of the active run stay pinned to its starting model snapshot, while the
    next run uses the newly configured model and provider."""
    import asyncio
    import json as _json
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    from bioharness_web.ledger import Ledger
    from bioharness_web.provider import ModelClient
    from bioharness_web.runtime import Runtime
    from bioharness_web.cli import CliRunner
    from bioharness_web.sources import Sources

    def start_fake_openai(label: str, turns: list[list[dict]]):
        seen_models: list[str] = []
        lock = threading.Lock()

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                return

            def do_POST(self):
                length = int(self.headers.get("Content-Length", "0"))
                body = _json.loads(self.rfile.read(length).decode("utf-8"))
                with lock:
                    seen_models.append(body.get("model", ""))
                    chunks = turns.pop(0)
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                for chunk in chunks:
                    payload = {"id": f"chatcmpl-{label}", "object": "chat.completion.chunk",
                               "created": 1, "model": body.get("model", label), **chunk}
                    self.wfile.write(f"data: {_json.dumps(payload)}\n\n".encode("utf-8"))
                    self.wfile.flush()
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()

        srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        t = threading.Thread(target=srv.serve_forever, daemon=True)
        t.start()
        return srv, f"http://127.0.0.1:{srv.server_address[1]}/v1", seen_models

    def tool_turn(call_id: str, name: str, args: dict):
        return [
            {"choices": [{"index": 0, "delta": {"role": "assistant", "tool_calls": [
                {"index": 0, "id": call_id, "type": "function",
                 "function": {"name": name, "arguments": _json.dumps(args)}}]}, "finish_reason": None}]},
            {"choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}]},
        ]

    def text_turn(text: str):
        return [
            {"choices": [{"index": 0, "delta": {"role": "assistant", "content": text}, "finish_reason": None}]},
            {"choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]},
        ]

    srv_a, url_a, seen_a = start_fake_openai("A", [
        tool_turn("call-1", "science_now", {"request_id": "req-1"}),
        text_turn("Run 1 finished on model-v1"),
    ])
    srv_b, url_b, seen_b = start_fake_openai("B", [
        text_turn("Run 2 finished on model-v2"),
    ])

    try:
        async def exercise():
            ws_dir = tmp_path / "ws"
            ws_dir.mkdir()
            settings = Settings(
                service_id="test-web",
                workspaces={"main": Workspace(id="main", path=ws_dir, evidence_roots=(ws_dir,))},
                access_token="secret-token-for-testing-1234",
                model=ModelSettings(base_url=url_a, api_key="sk-key-v1-secret", name="model-v1"),
                ledger_path=tmp_path / "ledger.sqlite",
            )
            ledger = Ledger(settings.ledger_path)
            model = ModelClient(settings.model)
            sources = Sources(settings, CliRunner())
            tool_entered = asyncio.Event()
            release_tool = asyncio.Event()

            class FakeCore:
                async def rules(self, _ws):
                    return "Test rules"

                async def tool_specs(self, _ws):
                    from bioharness_web.provider import ToolSpec
                    return [ToolSpec(name="science_now", description="Read state",
                                     schema={"type": "object", "properties": {"request_id": {"type": "string"}}})]

                async def call(self, _ws, tool: str, _args: dict):
                    if tool == "science_begin":
                        return {"ok": True, "request_id": "req-1", "phase": "EXECUTING", "must_not_stop": False}
                    if tool == "science_now":
                        if not tool_entered.is_set():
                            tool_entered.set()
                            await release_tool.wait()
                        return {"ok": True, "request_id": "req-1", "phase": "EXECUTING", "must_not_stop": False}
                    return {"ok": True}

                async def hook(self, _ws, _event: str, _payload: dict):
                    return {"decision": "allow"}

            rt = Runtime(settings, ledger, FakeCore(), model, sources)
            convo = rt.create("main")
            run1_id = rt.start_run("main", convo["id"], "Question on v1")

            # Wait until Run 1 is between Turn 1 and Turn 2, then hot-swap model to v2 on server B.
            await asyncio.wait_for(tool_entered.wait(), timeout=5.0)
            model.reconfigure(ModelSettings(base_url=url_b, api_key="sk-key-v2-secret", name="model-v2"))
            assert rt.model.settings.name == "model-v2"
            release_tool.set()

            await asyncio.wait_for(rt._tasks[run1_id], timeout=5.0)
            assert seen_a == ["model-v1", "model-v1"]
            assert seen_b == []

            # Run 2 on the same conversation now uses the newly configured model-v2 on server B.
            run2_id = rt.start_run("main", convo["id"], "Follow-up on v2")
            await asyncio.wait_for(rt._tasks[run2_id], timeout=5.0)
            assert seen_b == ["model-v2"]

            events = ledger.events(convo["id"])
            run1_model_ops = [e for e in events if e["run_id"] == run1_id and e["type"] in ("operation.started", "operation.finished") and e["data"].get("kind") == "model"]
            run2_model_ops = [e for e in events if e["run_id"] == run2_id and e["type"] in ("operation.started", "operation.finished") and e["data"].get("kind") == "model"]
            assert len(run1_model_ops) == 4  # 2 turns * (started + finished)
            assert all(e["data"]["name"] == "model-v1" for e in run1_model_ops)
            assert len(run2_model_ops) == 2
            assert all(e["data"]["name"] == "model-v2" for e in run2_model_ops)

            assistant_msgs = [e for e in events if e["type"] == "assistant.text"]
            assert [(m["data"]["model"], m["data"]["text"]) for m in assistant_msgs] == [
                ("model-v1", "Run 1 finished on model-v1"),
                ("model-v2", "Run 2 finished on model-v2"),
            ]

            await rt.close()
            ledger.close()

        asyncio.run(exercise())
    finally:
        srv_a.shutdown()
        srv_b.shutdown()
