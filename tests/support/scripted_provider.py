"""A scripted OpenAI-compatible endpoint as its own process, for checks that run the
real service: it plans, submits text evidence and delivers one synthetic EXPLAIN
request. It prints its base URL and serves until it is stopped. Not a model.

    python tests/support/scripted_provider.py
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from support.fake_openai import FakeOpenAI  # noqa: E402

PLAN = {"question_type": "EXPLAIN", "objective": "Explain what a count table is.",
        "requirements": ["Explain a count table"],
        "steps": [{"id": "survey", "kind": "KNOWLEDGE", "objective": "Summarise what a count table is.",
                   "serves": ["R1"], "why": "answers R1", "deliverable": "summary"}]}
ANSWERS = [
    {"text": "Planning the work. ", "tool_calls": [{"name": "science_plan", "arguments": {"plan": PLAN}}]},
    {"tool_calls": [{"name": "science_submit", "arguments": {
        "step_id": "survey", "status": "DONE",
        "summary": "A count table holds counts per feature and sample (fixture).",
        "evidence": [{"text": "Synthetic fixture text about count tables.", "source": "fixture"}]}}]},
    {"tool_calls": [{"name": "science_deliver", "arguments": {
        "kind": "FINAL", "answer": "A count table lists counts per feature and sample (fixture answer).",
        "limitations": ["synthetic fixture"]}}]},
    {"text": "Delivered: a count table lists counts per feature and sample (fixture).", "delay": 0.05},
]


def script(messages, tools):
    return ANSWERS.pop(0) if ANSWERS else {"text": "Nothing further (fixture)."}


if __name__ == "__main__":
    with FakeOpenAI(script) as server:
        print(server.base_url, flush=True)
        while True:
            time.sleep(1)
