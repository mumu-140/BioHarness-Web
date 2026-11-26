"""Tools of explicitly configured stdio MCP servers.

Each list or call starts the configured server command, talks MCP to it and
lets it exit. Nothing a model writes can choose the command: the model only
names a listed tool and supplies its arguments.
"""
from __future__ import annotations

import asyncio
from typing import Any, Sequence

from mcp.client import Client
from mcp.client.stdio import StdioServerParameters

from .cli import ToolError, _child_env
from .ledger import bounded
from .provider import ToolSpec

MAX_RESULT_CHARS = 60_000


def _parameters(argv: Sequence[str], env_passthrough: Sequence[str], cwd: str | None) -> StdioServerParameters:
    return StdioServerParameters(command=argv[0], args=list(argv[1:]), env=_child_env(env_passthrough), cwd=cwd)


async def list_tools(argv: Sequence[str], *, timeout: float = 30.0,
                     env_passthrough: Sequence[str] = (), cwd: str | None = None) -> list[ToolSpec]:
    async def ask() -> list[ToolSpec]:
        async with Client(_parameters(argv, env_passthrough, cwd)) as client:
            listed = await client.list_tools()
            return [ToolSpec(tool.name, tool.description or "",
                             dict(tool.input_schema or {"type": "object", "properties": {}}))
                    for tool in listed.tools]
    try:
        return await asyncio.wait_for(ask(), timeout)
    except asyncio.TimeoutError:
        raise ToolError("TOOL_TIMEOUT", f"{argv[0].rsplit('/', 1)[-1]} did not list its tools in time") from None
    except Exception as error:
        raise ToolError("TOOL_UNAVAILABLE",
                        f"{argv[0].rsplit('/', 1)[-1]} could not be asked for its tools "
                        f"({type(error).__name__})") from None


async def call_tool(argv: Sequence[str], name: str, arguments: dict[str, Any], *, timeout: float,
                    env_passthrough: Sequence[str] = (), cwd: str | None = None) -> dict[str, Any]:
    """{"is_error": bool, "text": str, ...} as the server returned it, text bounded.
    The server runs in `cwd`, so a relative path it is given means the same as for this host."""
    async def ask() -> dict[str, Any]:
        async with Client(_parameters(argv, env_passthrough, cwd)) as client:
            result = await client.call_tool(name, arguments)
            texts = [item.text for item in result.content if getattr(item, "type", "") == "text"]
            other = [getattr(item, "type", "unknown") for item in result.content
                     if getattr(item, "type", "") != "text"]
            text = "\n".join(texts)
            answer: dict[str, Any] = {"is_error": bool(result.is_error), "text": text[:MAX_RESULT_CHARS]}
            if len(text) > MAX_RESULT_CHARS:
                answer["truncated_characters"] = len(text) - MAX_RESULT_CHARS
            if other:
                answer["non_text_content_not_shown"] = other
            if result.structured_content is not None:
                # Keep the owner's shape, including errors/evidence, not a Web verdict.
                answer["structured_content"] = bounded(result.structured_content)
            return answer
    try:
        return await asyncio.wait_for(ask(), timeout)
    except asyncio.TimeoutError:
        raise ToolError("TOOL_TIMEOUT", f"{name} did not answer in time") from None
    except Exception as error:
        raise ToolError("TOOL_FAILED", f"{name} could not be called ({type(error).__name__})") from None
