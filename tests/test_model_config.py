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
