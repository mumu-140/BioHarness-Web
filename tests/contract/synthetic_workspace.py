"""Build a small synthetic research workspace through the public Core CLI only.

Used by the contract tests and by the browser check. Everything in it is fake
and says so; no real research data is involved.

    python tests/contract/synthetic_workspace.py <empty-directory>
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

QUESTION = ("Fixture question: which of two toy normalisation methods gives lower "
            "variance on a synthetic 6-sample count table?")
TABLE = "sample\tcount\ns1\t3\ns2\t5\ns3\t4\n"
PLAN = {
    "question_type": "ANALYZE",
    "objective": "Decide which toy normalisation method has lower variance on the synthetic table.",
    "requirements": ["Compare the two toy methods", "Report which has lower variance"],
    "steps": [
        {"id": "inputs", "kind": "KNOWLEDGE", "objective": "Confirm the synthetic input table.",
         "serves": ["R1"], "why": "The comparison needs a defined input.",
         "deliverable": "input summary"},
        {"id": "compare", "kind": "ANALYSIS", "objective": "Compute variance under both methods.",
         "serves": ["R1", "R2"], "why": "Answers the comparison.", "depends_on": ["inputs"],
         "method": "toy variance script", "parameters": {"samples": 6},
         "deliverable": "variance table", "check": "both methods use the same 6 samples"},
        {"id": "report", "kind": "KNOWLEDGE", "objective": "Summarise which method has lower variance.",
         "serves": ["R2"], "why": "States the answer.", "depends_on": ["compare"],
         "deliverable": "short summary"},
    ],
}
COMPARE_SUBMISSION = {
    "step_id": "compare", "status": "DONE",
    "summary": "Synthetic variance comparison finished (fake data).",
    "method_used": "toy variance script v0 (fixture)", "parameters_used": {"samples": 6},
    "evidence": [{"text": "method A variance 1.0, method B variance 2.0 (synthetic)",
                  "source": "fixture"}],
}


def core(workspace: Path, tool: str, arguments: dict, command: str = "bioharness-host") -> dict:
    done = subprocess.run([command, "call", f"--workspace={workspace}", tool, "-"],
                          input=json.dumps(arguments), capture_output=True, text=True, timeout=120)
    answer = json.loads(done.stdout)
    if answer.get("ok") is not True:
        raise RuntimeError(f"{tool} was refused: {answer}")
    return answer


def build(workspace: Path) -> dict:
    """A project scope with one planned request and one submission, a branch scope
    with a related request, and one unscoped request. All three stay open."""
    workspace = workspace.resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    first = core(workspace, "science_begin",
                 {"question": QUESTION, "scope": {"id": "fixture-project", "create": True}})
    request_id = first["request_id"]
    core(workspace, "science_plan", {"request_id": request_id, "plan": PLAN})
    table = workspace / "inputs.tsv"
    table.write_text(TABLE, encoding="utf-8")
    core(workspace, "science_submit", {
        "request_id": request_id, "step_id": "inputs", "status": "DONE",
        "summary": "The synthetic table has 3 rows (fake data).",
        "evidence": [{"path": str(table)}]})
    branch = core(workspace, "science_begin", {
        "question": "Fixture branch question: does a third toy method change the ranking?",
        "scope": {"id": "fixture-branch", "create": True, "parent_id": "fixture-project",
                  "related_request_ids": [request_id]}})
    unscoped = core(workspace, "science_begin",
                    {"question": "Fixture unscoped question: what is a count table?"})
    return {"workspace": str(workspace), "request_id": request_id,
            "branch_id": branch["request_id"], "unscoped_id": unscoped["request_id"]}


if __name__ == "__main__":
    if len(sys.argv) == 4 and sys.argv[1] == "submit-compare":
        core(Path(sys.argv[2]), "science_submit", {"request_id": sys.argv[3], **COMPARE_SUBMISSION})
    elif len(sys.argv) == 2:
        print(json.dumps(build(Path(sys.argv[1]))))
    else:
        raise SystemExit(__doc__)
