import asyncio
import sys

import pytest

from bioharness_web.cli import CliRunner, ToolError

PY = sys.executable


async def test_returns_the_json_object_even_on_a_nonzero_exit():
    code = ("import sys, json; d = json.load(sys.stdin); "
            "print(json.dumps({'ok': False, 'error': {'code': 'X', 'echo': d}})); sys.exit(1)")
    answer = await CliRunner().run_json([PY, "-c", code], {"request_id": "r1"})
    assert answer == {"ok": False, "error": {"code": "X", "echo": {"request_id": "r1"}}}


async def test_arguments_are_never_interpreted_by_a_shell(tmp_path):
    marker = tmp_path / "created"
    code = "import sys, json; print(json.dumps({'argv': sys.argv[1:]}))"
    hostile = f"x; touch {marker}"
    answer = await CliRunner().run_json([PY, "-c", code, hostile])
    assert answer == {"argv": [hostile]}
    assert not marker.exists()


async def test_non_json_output_is_a_tool_error_without_leaking_stderr():
    code = "import sys; sys.stderr.write('/secret/server/path'); print('not json')"
    with pytest.raises(ToolError) as caught:
        await CliRunner().run_json([PY, "-c", code])
    assert caught.value.code == "TOOL_BAD_OUTPUT"
    assert "/secret" not in caught.value.message


async def test_a_json_array_is_not_an_answer():
    with pytest.raises(ToolError) as caught:
        await CliRunner().run_json([PY, "-c", "print('[1]')"])
    assert caught.value.code == "TOOL_BAD_OUTPUT"


async def test_missing_executable():
    with pytest.raises(ToolError) as caught:
        await CliRunner().run_json(["/nonexistent/bioharness-tool"])
    assert caught.value.code == "TOOL_UNAVAILABLE"


async def test_timeout_kills_the_process():
    runner = CliRunner(timeout_seconds=0.3)
    with pytest.raises(ToolError) as caught:
        await runner.run_json([PY, "-c", "import time; time.sleep(30)"])
    assert caught.value.code == "TOOL_TIMEOUT"


async def test_oversized_output_is_refused():
    runner = CliRunner(max_output_bytes=1000)
    with pytest.raises(ToolError) as caught:
        await runner.run_json([PY, "-c", "print('x' * 100000)"])
    assert caught.value.code == "TOOL_OUTPUT_TOO_LARGE"


async def test_endless_output_is_cut_off_and_the_runner_stays_usable():
    """A tool that never stops writing must not wedge the call or keep its slot."""
    runner = CliRunner(max_output_bytes=1000, concurrency=1)
    flood = "import sys\nwhile True: sys.stdout.write('x' * 65536)"
    with pytest.raises(ToolError) as caught:
        await asyncio.wait_for(runner.run_json([PY, "-c", flood]), 20)
    assert caught.value.code == "TOOL_OUTPUT_TOO_LARGE"
    answer = await asyncio.wait_for(runner.run_json([PY, "-c", "print('{}')"]), 20)
    assert answer == {}


async def test_a_timed_out_tool_that_already_wrote_a_lot_is_still_reaped():
    runner = CliRunner(timeout_seconds=0.5, concurrency=1)
    code = "import sys, time\nsys.stdout.write('x' * 2000000); sys.stdout.flush(); time.sleep(30)"
    with pytest.raises(ToolError) as caught:
        await asyncio.wait_for(runner.run_json([PY, "-c", code]), 20)
    assert caught.value.code == "TOOL_TIMEOUT"
    assert await asyncio.wait_for(runner.run_json([PY, "-c", "print('{}')"]), 20) == {}


async def test_the_child_sees_no_service_secret_and_no_inherited_override(monkeypatch):
    for name in ("BIOHARNESS_WEB_ACCESS_TOKEN", "OPENAI_API_KEY", "BIOHARNESS_STATE",
                 "BIOHARNESS_WORKSPACE", "BIOHARNESS_CONFIG", "CLAUDE_PROJECT_DIR"):
        monkeypatch.setenv(name, "secret-or-override")
    code = "import os, json; print(json.dumps(dict(os.environ)))"
    seen = await CliRunner().run_json([PY, "-c", code])
    assert "secret-or-override" not in seen.values()
    assert "PATH" in seen  # the installed CLIs still need to be found and run


async def test_concurrency_bound_serialises_calls(tmp_path):
    log_file = tmp_path / "order.log"
    code = ("import sys, time\n"
            "open(sys.argv[1], 'a').write('start\\n'); time.sleep(0.3)\n"
            "open(sys.argv[1], 'a').write('end\\n'); print('{}')")
    runner = CliRunner(concurrency=1)
    await asyncio.gather(*(runner.run_json([PY, "-c", code, str(log_file)]) for _ in range(3)))
    assert log_file.read_text().split() == ["start", "end"] * 3
