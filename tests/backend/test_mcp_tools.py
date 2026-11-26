import sys
from pathlib import Path

from bioharness_web.mcp_tools import call_tool
from bioharness_web.ledger import MAX_EVENT_CHARS

SERVER = (sys.executable, str(Path(__file__).resolve().parents[1] / "support" / "echo_mcp.py"))


async def test_structured_module_result_is_retained_without_interpretation(tmp_path):
    result = await call_tool(SERVER, "structured", {}, timeout=10, cwd=str(tmp_path))
    assert result["is_error"] is False
    assert result["text"] == "Fixture summary, not a scientific verdict."
    assert result["structured_content"] == {
        "candidate": {"id": "m1", "tier": "T2"},
        "use": "not recorded", "execution_verified": False,
        "evidence": [{"source": "fixture", "text": "synthetic only"}]}


async def test_large_structured_output_is_explicitly_omitted(tmp_path):
    result = await call_tool(SERVER, "big_structured", {}, timeout=10, cwd=str(tmp_path))
    assert result["structured_content"]["omitted"] is True
    assert result["structured_content"]["characters"] > MAX_EVENT_CHARS
    assert len(result["structured_content"]["head"]) <= 2000


async def test_module_error_keeps_its_actual_structured_answer(tmp_path):
    result = await call_tool(SERVER, "structured_error", {}, timeout=10, cwd=str(tmp_path))
    assert result["is_error"] is True
    assert result["structured_content"] == {"error": "fixture failure"}
