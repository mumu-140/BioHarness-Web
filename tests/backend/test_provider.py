"""The provider adapter against a local OpenAI-compatible endpoint (no provider account)."""
import json

import pytest

from bioharness_web.provider import ModelClient, ProviderError, ToolSpec
from bioharness_web.settings import ModelSettings

from support.fake_openai import FakeOpenAI

KEY = "sk-test-not-a-real-key"
TOOLS = [ToolSpec("science_plan", "Submit the plan.", {
    "type": "object", "required": ["plan"], "properties": {"plan": {"type": "object"}}})]


def client(server: FakeOpenAI, **extra) -> ModelClient:
    return ModelClient(ModelSettings(base_url=server.base_url, api_key=KEY, name="fake-model", **extra))


async def collect(model: ModelClient, history, instructions="Follow Core."):
    pieces: list[str] = []

    async def on_text(piece: str) -> None:
        pieces.append(piece)

    turn = await model.turn(instructions=instructions, history=history, tools=TOOLS, on_text=on_text)
    return turn, pieces


async def test_text_is_streamed_in_pieces_and_returned_whole():
    with FakeOpenAI(lambda messages, tools: {"text": "A count table lists counts per sample."}) as server:
        turn, pieces = await collect(client(server), [{"role": "user", "text": "What is a count table?"}])
    assert turn.text == "A count table lists counts per sample." == "".join(pieces)
    assert len(pieces) > 1 and turn.tool_calls == []
    assert turn.finish_reason == "stop" and turn.model == "fake-model"
    assert turn.usage == {"input_tokens": 11, "output_tokens": 7}


async def test_request_carries_instructions_history_tools_and_the_key_only_in_the_header():
    with FakeOpenAI(lambda messages, tools: {"text": "ok"}) as server:
        await collect(client(server), [
            {"role": "user", "text": "Question?"},
            {"role": "assistant", "text": "", "tool_calls": [
                {"id": "c1", "name": "science_plan", "arguments": {"plan": {"objective": "x"}}}]},
            {"role": "tool", "id": "c1", "name": "science_plan", "result": {"ok": True, "phase": "WORK"}},
            {"role": "host", "text": "Core still expects work."},
        ], instructions="HOST PREAMBLE")
        body = server.requests[0]
        assert server.authorization == [f"Bearer {KEY}"]
    assert KEY not in json.dumps(body)
    roles = [message["role"] for message in body["messages"]]
    assert roles == ["system", "user", "assistant", "tool", "user"]
    assert body["messages"][0]["content"] == "HOST PREAMBLE"
    assert body["messages"][2]["tool_calls"][0]["function"]["name"] == "science_plan"
    assert json.loads(body["messages"][3]["content"]) == {"ok": True, "phase": "WORK"}
    assert body["messages"][4]["content"].startswith("[Notice from the BioHarness host, not from the user]")
    assert body["tools"][0]["function"]["name"] == "science_plan"
    assert body["tools"][0]["function"]["parameters"]["required"] == ["plan"]
    assert body["stream"] is True


async def test_tool_calls_are_assembled_from_the_stream():
    arguments = {"plan": {"question_type": "EXPLAIN", "objective": "解释计数表", "steps": [{"id": "s"}]}}
    script = lambda messages, tools: {"text": "Planning.", "tool_calls": [
        {"name": "science_plan", "arguments": arguments}, {"name": "science_plan", "arguments": {"plan": {}}}]}
    with FakeOpenAI(script) as server:
        turn, _ = await collect(client(server), [{"role": "user", "text": "q"}])
    assert turn.text == "Planning." and turn.finish_reason == "tool_call"
    assert [call.name for call in turn.tool_calls] == ["science_plan", "science_plan"]
    assert turn.tool_calls[0].arguments == arguments
    assert turn.tool_calls[0].id != turn.tool_calls[1].id


async def test_arguments_that_are_not_a_json_object_are_reported_not_guessed():
    script = lambda messages, tools: {"tool_calls": [{"name": "science_plan", "arguments": '{"plan": '}]}
    with FakeOpenAI(script) as server:
        turn, _ = await collect(client(server), [{"role": "user", "text": "q"}])
    assert turn.tool_calls[0].arguments is None
    assert turn.tool_calls[0].raw_arguments == '{"plan": '


async def test_provider_failure_names_the_status_and_nothing_else():
    with FakeOpenAI(lambda messages, tools: {"status": 500}) as server:
        with pytest.raises(ProviderError) as caught:
            await collect(client(server), [{"role": "user", "text": "q"}])
    assert caught.value.code == "PROVIDER_HTTP_ERROR" and "500" in caught.value.message
    assert KEY not in caught.value.message and "scripted failure" not in caught.value.message


async def test_unreachable_provider():
    model = ModelClient(ModelSettings(base_url="http://127.0.0.1:9/v1", api_key=KEY, name="m",
                                      request_timeout_seconds=5))
    with pytest.raises(ProviderError) as caught:
        await collect(model, [{"role": "user", "text": "q"}])
    assert caught.value.code == "PROVIDER_UNREACHABLE" and KEY not in caught.value.message


async def test_provider_reasoning_is_neither_streamed_nor_returned():
    script = lambda messages, tools: {"reasoning": "PRIVATE-CHAIN-OF-THOUGHT", "text": "The answer."}
    with FakeOpenAI(script) as server:
        turn, pieces = await collect(client(server), [{"role": "user", "text": "q"}])
    assert turn.text == "The answer." == "".join(pieces)


async def test_in_stream_api_error_is_not_reported_as_an_unreachable_endpoint():
    answer = {"text": "Incomplete.", "tool_calls": [
        {"name": "science_plan", "arguments": {"plan": {"objective": "fixture"}}}],
        "stream_error": {"message": KEY + " private provider diagnostics", "type": "fixture_unknown"}}
    with FakeOpenAI(lambda messages, tools: answer) as server:
        with pytest.raises(ProviderError) as caught:
            await collect(client(server), [{"role": "user", "text": "q"}])
    assert caught.value.code == "PROVIDER_RESPONSE_ERROR"
    assert KEY not in caught.value.message and "private provider diagnostics" not in caught.value.message


@pytest.mark.parametrize("ending", [
    {"finish_reason": "length"}, {"finish_reason": "content_filter"},
    {"finish_reason": None}, {"disconnect_before_finish": True},
])
async def test_incomplete_turn_never_returns_even_a_complete_tool_call(ending):
    answer = {"text": "Unfinished response.", "tool_calls": [
        {"name": "science_plan", "arguments": {"plan": {"objective": "fixture"}}}], **ending}
    with FakeOpenAI(lambda messages, tools: answer) as server:
        with pytest.raises(ProviderError) as caught:
            await collect(client(server), [{"role": "user", "text": "q"}])
    assert caught.value.code == "PROVIDER_INCOMPLETE"
    assert KEY not in caught.value.message
