from bioharness_web.projection import project_node_detail, project_task_graph
from bioharness_web.repository import TaskRecord
from tests.contract.fixtures import (
    attempt_payload,
    context_payload,
    memory_candidate_payload,
    run_spec_payload,
    task_payload,
)


def test_latest_attempt_is_primary_and_history_is_in_detail():
    task = task_payload()
    spec = run_spec_payload(task_id=task["id"])
    attempts = (
        attempt_payload(
            run_spec_id=spec["id"],
            number=1,
            state="FAILED",
            age_seconds=120,
        ),
        attempt_payload(
            run_spec_id=spec["id"],
            number=2,
            state="RUNNING",
            age_seconds=5,
        ),
    )
    record = TaskRecord(task=task, run_specs=(spec,), attempts=attempts)

    graph = project_task_graph(record)
    execution = next(node for node in graph.nodes if node.type == "EXECUTION")
    assert execution.status == "ACTIVE"

    detail = project_node_detail(record, execution.id)
    assert [item["attempt_number"] for item in detail.summary["attempt_history"]] == [1, 2]
    assert detail.summary["current_attempt"]["attempt_number"] == 2


def test_memory_detail_distinguishes_used_refs_from_available_candidates():
    task = task_payload()
    context = context_payload(memory_refs=("memory:used",))
    spec = run_spec_payload(task_id=task["id"])
    spec["context_snapshot_id"] = context["id"]
    record = TaskRecord(
        task=task,
        contexts=(context,),
        run_specs=(spec,),
        memory_candidates=(memory_candidate_payload(statement="Available only"),),
    )

    graph = project_task_graph(record)
    memory = next(node for node in graph.nodes if node.type == "MEMORY")
    detail = project_node_detail(record, memory.id)

    assert detail.summary["used_refs"] == ["memory:used"]
    assert detail.summary["available_candidates"][0]["statement"] == "Available only"
    assert detail.summary["available_candidates"][0]["used"] is False
