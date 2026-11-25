import json

from bioharness_web import stream as stream_module
from bioharness_web.cli import ToolError
from bioharness_web.sources import Sources
from bioharness_web.stream import version_stream


def parse(chunk: str):
    lines = dict(line.split(": ", 1) for line in chunk.strip().split("\n"))
    return lines["event"], json.loads(lines["data"])


async def collect(generator, cycles: int, monkeypatch, between=None):
    """Events from `cycles` polling rounds, with the sleep between rounds replaced."""
    events, rounds = [], 0

    async def no_sleep(_seconds):
        nonlocal rounds
        rounds += 1
        if between:
            between(rounds)

    monkeypatch.setattr(stream_module.asyncio, "sleep", no_sleep)
    async for chunk in generator:
        if chunk.startswith(":"):
            if rounds + 1 >= cycles:
                break
            continue
        events.append(parse(chunk))
    await generator.aclose()
    return events


async def test_announces_each_watched_view_once_then_only_changes(settings, fake_runner, monkeypatch):
    fake_runner.answers["tree"] = {"ok": True, "nodes": []}
    sources = Sources(settings, fake_runner)

    def change(round_number):
        if round_number == 2:
            fake_runner.answers["tree"] = {"ok": True, "nodes": [{"scope_id": "s"}]}

    generator = version_stream(sources, "pilot", [("tree", {})], interval=0.0)
    events = await collect(generator, 4, monkeypatch, change)
    assert [name for name, _ in events] == ["version", "version"]
    first, second = events[0][1], events[1][1]
    assert first["view"] == "tree" and first["workspace"] == "pilot"
    assert first["content_sha256"] != second["content_sha256"]


async def test_unreachable_source_is_reported_once_and_recovery_is_announced(settings, fake_runner, monkeypatch):
    answer = {"ok": True, "nodes": []}
    fake_runner.answers["tree"] = answer
    sources = Sources(settings, fake_runner)

    def change(round_number):
        fake_runner.answers["tree"] = (ToolError("TOOL_TIMEOUT", "slow")
                                       if round_number in (1, 2) else answer)

    generator = version_stream(sources, "pilot", [("tree", {})], interval=0.0)
    events = await collect(generator, 5, monkeypatch, change)
    assert [name for name, _ in events] == ["version", "source.stale", "version"]
    assert events[1][1]["code"] == "TOOL_TIMEOUT"
    # same content as before the outage, announced again so the browser clears "stale"
    assert events[0][1]["content_sha256"] == events[2][1]["content_sha256"]


async def test_core_views_are_polled_less_often_than_governance(settings, fake_runner, monkeypatch):
    fake_runner.answers["tree"] = {"ok": True, "nodes": []}
    fake_runner.answers["now"] = {"ok": True, "request_id": "r1", "phase": "WORK"}
    sources = Sources(settings, fake_runner)
    generator = version_stream(sources, "pilot",
                               [("tree", {}), ("now", {"request_id": "r1"})], interval=0.0)
    await collect(generator, 6, monkeypatch)
    core = sum("science_now" in argv for argv, _ in fake_runner.calls)
    governance = sum("tree" in argv for argv, _ in fake_runner.calls)
    assert governance == 6 and core == 2


async def test_an_unexpected_failure_is_reported_as_stale_and_the_stream_goes_on(settings, fake_runner, monkeypatch):
    answer = {"ok": True, "nodes": []}
    fake_runner.answers["tree"] = RuntimeError("boom: /secret/path")
    sources = Sources(settings, fake_runner)

    def change(round_number):
        if round_number == 1:
            fake_runner.answers["tree"] = answer

    generator = version_stream(sources, "pilot", [("tree", {})], interval=0.0)
    events = await collect(generator, 3, monkeypatch, change)
    assert [name for name, _ in events] == ["source.stale", "version"]
    assert events[0][1]["code"] == "INTERNAL_ERROR" and "secret" not in str(events[0][1])
