"""One streamed request to the configured model provider.

A thin adapter over Pydantic AI's direct request API: it translates the
runtime's plain history into provider messages and the provider's stream into
text and tool calls. It runs no agent loop and makes no decisions.
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Sequence

from pydantic_ai.direct import model_request_stream
from pydantic_ai.exceptions import ModelAPIError, ModelConnectionError, ModelHTTPError
from pydantic_ai.messages import (
    ModelMessage, ModelRequest, ModelResponse, PartDeltaEvent, PartStartEvent, TextPart,
    TextPartDelta, ToolCallPart, ToolReturnPart, UserPromptPart,
)
from pydantic_ai.models import ModelRequestParameters
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.tools import ToolDefinition

from .settings import ModelSettings

HOST_NOTICE = "[Notice from the BioHarness host, not from the user]\n"


class ProviderError(Exception):
    """The provider could not be reached or refused the request."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    schema: dict[str, Any]


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any] | None  # None: the model's arguments were not a JSON object
    raw_arguments: str = ""


@dataclass
class Turn:
    text: str
    tool_calls: list[ToolCall]
    model: str
    finish_reason: str | None
    usage: dict[str, int] = field(default_factory=dict)
    seconds: float = 0.0


def _messages(history: Sequence[dict[str, Any]], instructions: str) -> list[ModelMessage]:
    """history items: {"role": "user"|"host", "text"} | {"role": "assistant", "text", "tool_calls"}
    | {"role": "tool", "id", "name", "result"}."""
    messages: list[ModelMessage] = []

    def request() -> ModelRequest:
        if not messages or not isinstance(messages[-1], ModelRequest):
            messages.append(ModelRequest(parts=[]))
        return messages[-1]  # type: ignore[return-value]

    for item in history:
        role = item["role"]
        if role == "user":
            request().parts.append(UserPromptPart(item["text"]))  # type: ignore[attr-defined]
        elif role == "host":
            request().parts.append(UserPromptPart(HOST_NOTICE + item["text"]))  # type: ignore[attr-defined]
        elif role == "tool":
            content = item["result"] if isinstance(item["result"], str) else json.dumps(
                item["result"], ensure_ascii=False)
            request().parts.append(  # type: ignore[attr-defined]
                ToolReturnPart(tool_name=item["name"], content=content, tool_call_id=item["id"]))
        else:
            parts: list[Any] = [TextPart(item["text"])] if item.get("text") else []
            parts += [ToolCallPart(tool_name=call["name"], args=call["arguments"], tool_call_id=call["id"])
                      for call in item.get("tool_calls", ())]
            messages.append(ModelResponse(parts=parts))
    request().instructions = instructions
    return messages


class ModelClient:
    def __init__(self, settings: ModelSettings, *, _model: OpenAIChatModel | None = None):
        self.settings = settings
        self._model = _model if _model is not None else OpenAIChatModel(
            settings.name,
            provider=OpenAIProvider(base_url=settings.base_url, api_key=settings.api_key),
        )

    def snapshot(self) -> ModelClient:
        """Return an isolated client pinned to the current settings and provider for one run."""
        return ModelClient(self.settings, _model=self._model)

    def reconfigure(self, settings: ModelSettings) -> None:
        """Hot-swap the active OpenAI-compatible chat model for subsequent runs."""
        self.settings = settings
        self._model = OpenAIChatModel(
            settings.name,
            provider=OpenAIProvider(base_url=settings.base_url, api_key=settings.api_key),
        )

    async def turn(
        self,
        *,
        instructions: str,
        history: Sequence[dict[str, Any]],
        tools: Sequence[ToolSpec],
        on_text: Callable[[str], Awaitable[None]],
    ) -> Turn:
        parameters = ModelRequestParameters(function_tools=[
            ToolDefinition(name=tool.name, description=tool.description,
                           parameters_json_schema=tool.schema)
            for tool in tools
        ])
        settings, model = self.settings, self._model
        started = time.monotonic()
        req_settings: dict[str, Any] = {"timeout": settings.request_timeout_seconds}
        if settings.temperature is not None:
            req_settings["temperature"] = settings.temperature
        if settings.max_tokens is not None:
            req_settings["max_tokens"] = settings.max_tokens
        try:
            async with model_request_stream(
                model, _messages(history, instructions),
                model_request_parameters=parameters,
                model_settings=req_settings,
            ) as stream:
                async for event in stream:
                    # Only answer text is forwarded; provider "thinking" parts are never shown or kept.
                    if isinstance(event, PartStartEvent) and isinstance(event.part, TextPart):
                        if event.part.content:
                            await on_text(event.part.content)
                    elif isinstance(event, PartDeltaEvent) and isinstance(event.delta, TextPartDelta):
                        if event.delta.content_delta:
                            await on_text(event.delta.content_delta)
                response = stream.get()
                usage = stream.usage  # a property in this SDK version
                finish_reason = stream.finish_reason
        except ModelHTTPError as error:
            raise ProviderError("PROVIDER_HTTP_ERROR", f"provider answered HTTP {error.status_code}") from None
        except ModelConnectionError as error:
            raise ProviderError("PROVIDER_UNREACHABLE", f"provider connection failed ({type(error).__name__})") from None
        except ModelAPIError:
            # A failed response/stream is not proof that the endpoint was unreachable.
            # Provider diagnostics may contain credentials or raw content; do not forward them.
            raise ProviderError("PROVIDER_RESPONSE_ERROR", "provider returned an invalid or failed response") from None
        except Exception as error:  # connection, timeout, malformed stream: the type says enough
            raise ProviderError("PROVIDER_UNREACHABLE", f"provider request failed ({type(error).__name__})") from None

        # The SDK can infer "stop"/"tool_call" after a quiet EOF. Its public
        # provider_details retains whether the provider actually supplied a reason.
        raw_finish_reason = (response.provider_details or {}).get("finish_reason")
        if not raw_finish_reason or finish_reason not in ("stop", "tool_call"):
            # Valid JSON in an early call does not make a truncated/filtered turn complete.
            # In particular, a quiet HTTP EOF is not confirmation to execute its calls.
            raise ProviderError("PROVIDER_INCOMPLETE",
                                "provider response did not finish normally; no tool calls were executed")

        text = "".join(part.content for part in response.parts if isinstance(part, TextPart))
        calls: list[ToolCall] = []
        for part in response.parts:
            if not isinstance(part, ToolCallPart):
                continue
            raw = part.args if isinstance(part.args, str) else json.dumps(part.args or {}, ensure_ascii=False)
            try:
                arguments = json.loads(raw) if raw.strip() else {}
            except ValueError:
                arguments = None
            calls.append(ToolCall(id=part.tool_call_id, name=part.tool_name, raw_arguments=raw[:2000],
                                  arguments=arguments if isinstance(arguments, dict) else None))
        return Turn(
            text=text, tool_calls=calls, model=response.model_name or settings.name,
            finish_reason=finish_reason,
            usage={"input_tokens": usage.input_tokens or 0, "output_tokens": usage.output_tokens or 0},
            seconds=round(time.monotonic() - started, 3),
        )
