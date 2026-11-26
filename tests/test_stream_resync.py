import asyncio
import json
from types import SimpleNamespace

import pytest

from bioharness_web.stream import conversation_stream


@pytest.mark.asyncio
@pytest.mark.parametrize("after, reset", [(0, False), (100, True)])
async def test_replay_explicitly_resets_an_ahead_cursor(after, reset):
    queue = asyncio.Queue()
    removed = []
    event = {"seq": 3, "type": "assistant.text", "data": {"text": "restored"}}
    runtime = SimpleNamespace(
        subscribe=lambda cid: queue,
        unsubscribe=lambda cid, q: removed.append((cid, q)),
        ledger=SimpleNamespace(last_seq=lambda cid: 3, events=lambda cid, cursor: [event]),
    )
    stream = conversation_stream(runtime, "conv-1", after)
    try:
        first = await anext(stream)
        if reset:
            assert first.startswith("id: 0\nevent: stream.reset\n")
            assert json.loads(first.split("data: ", 1)[1])["conversation_id"] == "conv-1"
            first = await anext(stream)
        assert first.startswith("id: 3\nevent: assistant.text\n")
    finally:
        await stream.aclose()
    assert removed == [("conv-1", queue)]
