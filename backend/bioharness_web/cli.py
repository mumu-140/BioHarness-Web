"""Run one configured public CLI: fixed argv, JSON on stdin, JSON object on stdout.

No shell is involved and nothing from a browser or a model becomes a command.
Only read calls go through here: a timed-out call is killed, which is safe for a
read and would not be for a mutating Core call.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Sequence

log = logging.getLogger(__name__)

# The child gets only what it needs to start. It never sees this service's
# token or any provider credential, and no inherited BIOHARNESS_* override can
# redirect a call to another workspace, state directory or config.
_CHILD_ENV = ("PATH", "HOME", "USER", "LOGNAME", "LANG", "LANGUAGE", "TMPDIR", "TZ")
_REAP_SECONDS = 5.0


def _child_env() -> dict[str, str]:
    return {name: value for name, value in os.environ.items()
            if name in _CHILD_ENV or name.startswith("LC_")}


class ToolError(Exception):
    """The tool could not be run or did not answer with a JSON object."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


async def _read_bounded(stream: asyncio.StreamReader, limit: int, on_overflow) -> bytes | None:
    """The whole stream, or None once it exceeds the limit.

    It keeps reading (and discarding) to the end either way: an unread pipe
    would keep the transport open and the process could never be reaped.
    """
    chunks: list[bytes] = []
    total = 0
    while chunk := await stream.read(65536):
        if total > limit:
            continue
        total += len(chunk)
        if total > limit:
            chunks.clear()
            on_overflow()
        else:
            chunks.append(chunk)
    return None if total > limit else b"".join(chunks)


def _kill(process: asyncio.subprocess.Process) -> None:
    if process.returncode is None:
        try:
            process.kill()
        except ProcessLookupError:
            pass


async def _reap(process: asyncio.subprocess.Process, tool: str) -> None:
    """Kill a process whose exchange was abandoned and wait, bounded, for it to go."""
    _kill(process)

    async def discard(stream: asyncio.StreamReader | None) -> None:
        while stream is not None and await stream.read(65536):
            pass

    try:
        await asyncio.wait_for(
            asyncio.gather(discard(process.stdout), discard(process.stderr), process.wait()),
            _REAP_SECONDS,
        )
    except asyncio.TimeoutError:
        log.warning("%s did not exit within %ss of being killed", tool, _REAP_SECONDS)


class CliRunner:
    def __init__(
        self,
        *,
        timeout_seconds: float = 60.0,
        max_output_bytes: int = 16 * 1024 * 1024,
        concurrency: int = 4,
    ):
        self.timeout_seconds = timeout_seconds
        self.max_output_bytes = max_output_bytes
        self._slots = asyncio.Semaphore(concurrency)

    async def run_json(self, argv: Sequence[str], stdin: dict | None = None) -> dict:
        """The JSON object the tool printed, whatever its exit status.

        These tools report a refusal as a JSON object with ok=false and a
        non-zero exit, so the object is the answer and the exit code is not.
        """
        payload = b"" if stdin is None else json.dumps(stdin, ensure_ascii=False).encode()
        tool = os.path.basename(argv[0])
        async with self._slots:
            try:
                process = await asyncio.create_subprocess_exec(
                    *argv,
                    stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    env=_child_env(),
                )
            except (OSError, ValueError):
                raise ToolError("TOOL_UNAVAILABLE", f"{tool} could not be started") from None
            try:
                stdout, stderr = await asyncio.wait_for(
                    self._exchange(process, payload), self.timeout_seconds
                )
            except asyncio.TimeoutError:
                raise ToolError("TOOL_TIMEOUT", f"{tool} did not answer in time") from None
            finally:
                if process.returncode is None:
                    await asyncio.shield(_reap(process, tool))
        if stdout is None or stderr is None:
            raise ToolError("TOOL_OUTPUT_TOO_LARGE", f"{tool} output exceeded the size limit")
        try:
            answer = json.loads(stdout)
        except ValueError:
            answer = None
        if not isinstance(answer, dict):
            # stderr may hold server paths: it goes to the service log, not the browser.
            # The child has no credentials in its environment to print.
            log.warning(
                "%s exited %s without a JSON object; stderr tail: %s",
                tool, process.returncode, stderr[-500:].decode("utf-8", "replace"),
            )
            raise ToolError("TOOL_BAD_OUTPUT", f"{tool} did not return a JSON object")
        return answer

    async def _exchange(
        self, process: asyncio.subprocess.Process, payload: bytes
    ) -> tuple[bytes | None, bytes | None]:
        assert process.stdin and process.stdout and process.stderr
        try:
            process.stdin.write(payload)
            await process.stdin.drain()
        except (BrokenPipeError, ConnectionResetError):
            pass  # the tool exited before reading (e.g. rejected its arguments)
        finally:
            process.stdin.close()
        stdout, stderr = await asyncio.gather(
            _read_bounded(process.stdout, self.max_output_bytes, lambda: _kill(process)),
            _read_bounded(process.stderr, self.max_output_bytes, lambda: _kill(process)),
        )
        await process.wait()
        return stdout, stderr
