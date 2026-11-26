"""Atomic, server-side model provider and multimodal capability slot configuration.

Secrets (API keys) stay strictly on the server (mode 0600) and are never echoed
back to the browser in plaintext. Changes to the active `chat` slot hot-reload
the native runtime's ModelClient for subsequent turns.
"""
from __future__ import annotations

import json
import os
import re
import tempfile
import time
from pathlib import Path
from typing import Any, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field

from .runtime import Runtime
from .settings import ModelSettings, Settings

_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$")

PROVIDER_PRESETS: list[dict[str, str]] = [
    {
        "id": "magpie",
        "name": "Magpie 统一网关",
        "protocol": "openai-compatible",
        "base_url": "http://127.0.0.1:3425/v1/",
        "hint": "兼容 OpenAI /models 与 Chat Completions",
    },
    {
        "id": "openai",
        "name": "OpenAI Official",
        "protocol": "openai-compatible",
        "base_url": "https://api.openai.com/v1",
        "hint": "GPT-4o / o3 / whisper / text-embedding-3",
    },
    {
        "id": "deepseek",
        "name": "DeepSeek API",
        "protocol": "openai-compatible",
        "base_url": "https://api.deepseek.com/v1",
        "hint": "deepseek-chat / deepseek-reasoner",
    },
    {
        "id": "ollama",
        "name": "本地 Ollama",
        "protocol": "openai-compatible",
        "base_url": "http://127.0.0.1:11434/v1",
        "hint": "本地私有模型（无需真实密钥，填 ollama 即可）",
    },
]


def _no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"


def mask_api_key(key: str) -> str:
    raw = (key or "").strip()
    if not raw:
        return ""
    if len(raw) <= 8:
        return "*" * len(raw)
    return f"{raw[:4]}••••{raw[-4:]}"


class ProviderPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=120)
    protocol: Literal["openai-compatible", "anthropic", "gemini"] = "openai-compatible"
    base_url: str = Field(min_length=1, max_length=500)
    api_key: str | None = Field(default=None, max_length=1000)
    clear_api_key: bool = False
    models: list[str] = Field(default_factory=list, max_length=500)
    enabled: bool = True
    timeout_seconds: float = Field(default=300.0, ge=5.0, le=3600.0)


class ChatSlotPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider_id: str | None = Field(default=None, max_length=64)
    model: str = Field(default="", max_length=200)
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    max_tokens: int | None = Field(default=None, ge=64, le=200_000)


class VisionSlotPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider_id: str | None = Field(default=None, max_length=64)
    model: str = Field(default="", max_length=200)
    image_size: str = Field(default="1024x1024", max_length=40)


class SpeechSlotPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider_id: str | None = Field(default=None, max_length=64)
    asr_model: str = Field(default="", max_length=200)
    tts_model: str = Field(default="", max_length=200)
    voice: str = Field(default="alloy", max_length=64)


class EmbeddingSlotPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider_id: str | None = Field(default=None, max_length=64)
    model: str = Field(default="", max_length=200)
    dimensions: int | None = Field(default=None, ge=64, le=8192)


class SlotsPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    chat: ChatSlotPayload = Field(default_factory=ChatSlotPayload)
    vision: VisionSlotPayload = Field(default_factory=VisionSlotPayload)
    speech: SpeechSlotPayload = Field(default_factory=SpeechSlotPayload)
    embedding: EmbeddingSlotPayload = Field(default_factory=EmbeddingSlotPayload)


class UpdateModelConfigBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    providers: list[ProviderPayload] = Field(default_factory=list, max_length=50)
    slots: SlotsPayload = Field(default_factory=SlotsPayload)


class FetchModelsBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider_id: str | None = Field(default=None, max_length=64)
    base_url: str | None = Field(default=None, max_length=500)
    api_key: str | None = Field(default=None, max_length=1000)


class ModelConfigStore:
    """Persists model providers and capability slots next to the Web ledger."""

    def __init__(self, settings: Settings):
        self._settings = settings
        self._path: Path | None = (
            settings.ledger_path.parent / "model_config.json"
            if settings.ledger_path is not None
            else None
        )
        self._state: dict[str, Any] = self._load_or_seed()

    @property
    def editable(self) -> bool:
        return self._path is not None

    def _default_state(self) -> dict[str, Any]:
        providers: list[dict[str, Any]] = []
        chat_slot: dict[str, Any] = {
            "provider_id": None,
            "model": "",
            "temperature": None,
            "max_tokens": None,
        }
        if self._settings.model is not None:
            m = self._settings.model
            providers.append(
                {
                    "id": "env-default",
                    "name": "环境变量默认服务商",
                    "protocol": "openai-compatible",
                    "base_url": m.base_url,
                    "api_key": m.api_key,
                    "models": [m.name],
                    "enabled": True,
                    "timeout_seconds": m.request_timeout_seconds,
                    "source": "env",
                }
            )
            chat_slot["provider_id"] = "env-default"
            chat_slot["model"] = m.name
        return {
            "version": 1,
            "providers": providers,
            "slots": {
                "chat": chat_slot,
                "vision": {"provider_id": None, "model": "", "image_size": "1024x1024"},
                "speech": {"provider_id": None, "asr_model": "", "tts_model": "", "voice": "alloy"},
                "embedding": {"provider_id": None, "model": "", "dimensions": None},
            },
        }

    def _load_or_seed(self) -> dict[str, Any]:
        base = self._default_state()
        if self._path is None or not self._path.is_file():
            return base
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
            if isinstance(raw, dict) and isinstance(raw.get("providers"), list) and isinstance(raw.get("slots"), dict):
                return raw
        except (OSError, ValueError):
            pass
        return base

    def _atomic_write(self, data: dict[str, Any]) -> None:
        if self._path is None:
            raise HTTPException(
                409,
                {
                    "origin": "web",
                    "code": "CONFIG_READ_ONLY",
                    "message": "当前工作台处于只读模式（未配置持久化状态目录），无法保存模型配置。",
                },
            )
        self._path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=".model_config-", suffix=".json", dir=str(self._path.parent))
        try:
            os.fchmod(fd, 0o600)
            payload = (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
            with os.fdopen(fd, "wb") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp, self._path)
        except Exception:
            if os.path.exists(tmp):
                os.unlink(tmp)
            raise

    def public_view(self, active_chat_model: str | None) -> dict[str, Any]:
        providers_out = []
        for p in self._state.get("providers", []):
            key = str(p.get("api_key") or "")
            providers_out.append(
                {
                    "id": p["id"],
                    "name": p["name"],
                    "protocol": p.get("protocol", "openai-compatible"),
                    "base_url": p["base_url"],
                    "has_api_key": bool(key.strip()),
                    "api_key_masked": mask_api_key(key),
                    "models": list(p.get("models") or []),
                    "enabled": bool(p.get("enabled", True)),
                    "timeout_seconds": float(p.get("timeout_seconds", 300.0)),
                    "source": p.get("source", "user"),
                }
            )
        return {
            "editable": self.editable,
            "runtime_enabled": self._settings.runtime_enabled,
            "active_chat_model": active_chat_model,
            "providers": providers_out,
            "slots": self._state.get("slots", {}),
            "presets": PROVIDER_PRESETS,
        }

    def resolve_chat_settings(self) -> ModelSettings | None:
        chat = (self._state.get("slots") or {}).get("chat") or {}
        pid = chat.get("provider_id")
        model_name = str(chat.get("model") or "").strip()
        if not pid or not model_name:
            return None
        provider = next(
            (p for p in self._state.get("providers", []) if p.get("id") == pid and p.get("enabled", True)),
            None,
        )
        if not provider:
            return None
        base_url = str(provider.get("base_url") or "").strip()
        api_key = str(provider.get("api_key") or "").strip()
        if not base_url or not api_key:
            return None
        return ModelSettings(
            base_url=base_url,
            api_key=api_key,
            name=model_name,
            request_timeout_seconds=float(provider.get("timeout_seconds", 300.0)),
            temperature=chat.get("temperature"),
            max_tokens=chat.get("max_tokens"),
        )

    def resolve_provider_credentials(
        self, provider_id: str | None, base_url: str | None, api_key: str | None
    ) -> tuple[str, str]:
        existing = (
            next((p for p in self._state.get("providers", []) if p.get("id") == provider_id), None)
            if provider_id
            else None
        )
        resolved_url = (base_url or (existing or {}).get("base_url") or "").strip()
        resolved_key = (
            api_key.strip()
            if api_key is not None and api_key.strip()
            else str((existing or {}).get("api_key") or "").strip()
        )
        return resolved_url, resolved_key

    def update(self, body: UpdateModelConfigBody) -> None:
        existing_by_id = {p["id"]: p for p in self._state.get("providers", [])}
        seen_ids: set[str] = set()
        next_providers: list[dict[str, Any]] = []
        for item in body.providers:
            if not _ID_RE.fullmatch(item.id):
                raise HTTPException(
                    422,
                    {"origin": "web", "code": "INVALID_PROVIDER_ID", "message": f"无效的服务商 ID: {item.id}"},
                )
            if item.id in seen_ids:
                raise HTTPException(
                    422,
                    {"origin": "web", "code": "DUPLICATE_PROVIDER_ID", "message": f"服务商 ID 重复: {item.id}"},
                )
            seen_ids.add(item.id)
            prev = existing_by_id.get(item.id)
            if item.clear_api_key:
                key = ""
            elif item.api_key is not None and item.api_key.strip():
                key = item.api_key.strip()
            else:
                key = str((prev or {}).get("api_key") or "")
            models = list(dict.fromkeys(m.strip() for m in item.models if m.strip()))
            next_providers.append(
                {
                    "id": item.id,
                    "name": item.name.strip(),
                    "protocol": item.protocol,
                    "base_url": item.base_url.strip(),
                    "api_key": key,
                    "models": models,
                    "enabled": item.enabled,
                    "timeout_seconds": item.timeout_seconds,
                    "source": (prev or {}).get("source", "user"),
                }
            )
        next_state = {
            "version": 1,
            "providers": next_providers,
            "slots": body.slots.model_dump(),
        }
        self._atomic_write(next_state)
        self._state = next_state

    def reset(self) -> None:
        if self._path is not None and self._path.exists():
            self._path.unlink()
        self._state = self._default_state()


async def fetch_remote_models(base_url: str, api_key: str) -> dict[str, Any]:
    url = base_url.strip().rstrip("/")
    if not (url.startswith("http://") or url.startswith("https://")):
        return {"ok": False, "models": [], "latency_ms": 0, "error": "Base URL 必须以 http:// 或 https:// 开头"}
    target = f"{url}/models"
    headers = {"Accept": "application/json"}
    if api_key.strip():
        headers["Authorization"] = f"Bearer {api_key.strip()}"
    started = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(target, headers=headers)
        latency_ms = int((time.monotonic() - started) * 1000)
        if resp.status_code >= 400:
            return {
                "ok": False,
                "models": [],
                "latency_ms": latency_ms,
                "error": f"远端返回 HTTP {resp.status_code}",
            }
        data = resp.json()
        raw_items = data.get("data") if isinstance(data, dict) else data
        models: list[str] = []
        if isinstance(raw_items, list):
            for entry in raw_items:
                if isinstance(entry, dict) and isinstance(entry.get("id"), str):
                    models.append(entry["id"])
                elif isinstance(entry, str):
                    models.append(entry)
        models = sorted(dict.fromkeys(models))
        return {"ok": True, "models": models, "latency_ms": latency_ms, "error": None}
    except Exception as exc:
        latency_ms = int((time.monotonic() - started) * 1000)
        return {
            "ok": False,
            "models": [],
            "latency_ms": latency_ms,
            "error": f"连接失败（{type(exc).__name__}）",
        }


def create_model_settings_router(store: ModelConfigStore, runtime: Runtime | None) -> APIRouter:
    router = APIRouter(prefix="/api/settings/models", dependencies=[Depends(_no_store)])

    def active_model_name() -> str | None:
        if runtime is not None:
            return runtime.model.settings.name
        return None

    @router.get("")
    def get_model_config():
        return store.public_view(active_model_name())

    @router.put("")
    def save_model_config(body: UpdateModelConfigBody):
        store.update(body)
        applied_chat = False
        if runtime is not None:
            resolved = store.resolve_chat_settings()
            if resolved is not None:
                runtime.model.reconfigure(resolved)
                applied_chat = True
        view = store.public_view(active_model_name())
        view["applied_chat"] = applied_chat
        return view

    @router.post("/fetch-models")
    async def fetch_models(body: FetchModelsBody):
        url, key = store.resolve_provider_credentials(body.provider_id, body.base_url, body.api_key)
        if not url:
            raise HTTPException(
                422, {"origin": "web", "code": "BASE_URL_REQUIRED", "message": "请先填写 Base URL"}
            )
        return await fetch_remote_models(url, key)

    @router.post("/reset")
    def reset_model_config():
        store.reset()
        if runtime is not None:
            resolved = store.resolve_chat_settings()
            if resolved is not None:
                runtime.model.reconfigure(resolved)
        return store.public_view(active_model_name())

    return router
