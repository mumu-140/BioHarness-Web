"""The host side of BioHarness Core's public interface.

Everything goes through the public `bioharness-host` command: the five calls,
the Agent-host hooks and the tool definitions it serves over MCP. This module
neither interprets Core's answers nor decides what happens next.
"""
from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import Any

from . import mcp_tools
from .cli import CliRunner, ToolError
from .provider import ToolSpec
from .settings import Settings, Workspace

MUTATING = ("science_begin", "science_plan", "science_submit", "science_deliver")
# What a model may call. science_begin is the host's call: it carries the user's own words.
MODEL_TOOLS = ("science_now", "science_plan", "science_submit", "science_deliver")


class CoreHost:
    def __init__(self, settings: Settings, runner: CliRunner):
        self.settings = settings
        self.runner = runner
        self._locks: dict[tuple[str, str], asyncio.Lock] = defaultdict(asyncio.Lock)
        self._specs: dict[str, list[ToolSpec]] = {}
        self._rules: dict[str, str] = {}

    async def call(self, workspace: Workspace, tool: str, arguments: dict[str, Any]) -> dict:
        """Core's answer to one call. Raises ToolError when there is no answer: for a
        mutating call that means the outcome is unknown, not that nothing happened."""
        argv = [self.settings.core_cli, "call", f"--workspace={workspace.path}", tool, "-"]
        if tool not in MUTATING:
            answer = await self.runner.run_json(
                argv, arguments, timeout=self.settings.core_read_timeout_seconds)
        else:
            # Mutations of one request from this host go one at a time; other hosts stay
            # independent and Core answers STATE_CHANGED when they got there first.
            key = (workspace.id, str(arguments.get("request_id") or ""))
            async with self._locks[key]:
                answer = await self.runner.run_json(
                    argv, arguments, timeout=self.settings.core_call_timeout_seconds)
        assert answer is not None
        return answer

    async def hook(self, workspace: Workspace, event: str, payload: dict[str, Any]) -> dict | None:
        """One Agent-host hook event. No --agent-host is passed: this host is not Claude
        Code, Codex or CodeArts and does not pose as one. A hook never reports failure, so
        its effect is always read back from science_now."""
        argv = [self.settings.core_cli, "hook", event, f"--workspace={workspace.path}"]
        # Core keeps one unlocked record per session: its hooks must not overlap.
        async with self._locks[(workspace.id, "session:" + str(payload.get("session_id")))]:
            return await self.runner.run_json(
                argv, payload, timeout=self.settings.core_read_timeout_seconds, empty_ok=True)

    async def rules(self, workspace: Workspace) -> str:
        if workspace.id not in self._rules:
            argv = [self.settings.core_cli, "rules", f"--workspace={workspace.path}"]
            self._rules[workspace.id] = await self.runner.run_text(argv)
        return self._rules[workspace.id]

    async def tool_specs(self, workspace: Workspace) -> list[ToolSpec]:
        """Core's own definitions of the calls a model may make, as served by its MCP interface."""
        if workspace.id not in self._specs:
            argv = [self.settings.core_cli, "mcp", f"--workspace={workspace.path}"]
            listed = await mcp_tools.list_tools(argv, env_passthrough=self.runner.env_passthrough)
            by_name = {spec.name: spec for spec in listed}
            missing = [name for name in MODEL_TOOLS if name not in by_name]
            if missing:
                raise ToolError("TOOL_BAD_OUTPUT", "Core did not list: " + ", ".join(missing))
            self._specs[workspace.id] = [by_name[name] for name in MODEL_TOOLS]
        return self._specs[workspace.id]
