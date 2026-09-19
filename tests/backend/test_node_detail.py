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


def test_memory_detail_only_exposes_candidates_referenced_by_task_context():
    task = task_payload()
    used_candidate = memory_candidate_payload(statement="Used by task")
    unrelated_candidate = memory_candidate_payload(statement="Unrelated project memory")
    used_ref = f"memory:{used_candidate['id']}"
    context = context_payload(memory_refs=(used_ref,))
    spec = run_spec_payload(task_id=task["id"])
    spec["context_snapshot_id"] = context["id"]
    record = TaskRecord(
        task=task,
        contexts=(context,),
        run_specs=(spec,),
        memory_candidates=(used_candidate, unrelated_candidate),
    )

    graph = project_task_graph(record)
    memory = next(node for node in graph.nodes if node.type == "MEMORY")
    detail = project_node_detail(record, memory.id)

    assert detail.summary["used_refs"] == [used_ref]
    assert [item["statement"] for item in detail.summary["available_candidates"]] == [
        "Used by task"
    ]
    assert detail.summary["available_candidates"][0]["used"] is True


def test_execution_detail_keeps_per_attempt_capabilities_and_runtime_context():
    task = task_payload(question="attempt drilldown")
    spec = run_spec_payload(task_id=task["id"])
    attempt = attempt_payload(
        run_spec_id=spec["id"],
        number=1,
        state="NEEDS_OPERATOR_RECONCILIATION",
    )
    attempt["capability_snapshot"] = {
        "mode": "synchronous_process",
        "logs": True,
        "trace": True,
        "poll": False,
        "cancellation": "unsupported",
        "reconcile_after_disconnect": "limited",
    }
    attempt["observed_runtime_environment"] = {
        "host": "fwq10ys",
        "executor": "genome-web-local",
    }
    attempt["observed_resource_allocation"] = {
        "cpu_count": 8,
        "memory_gb": 16,
    }
    attempt["binding"] = {
        "host": "fwq10ys",
        "pid": 4242,
        "process_start_token": "token",
        "external_execution_id": None,
        "metadata": {},
    }

    record = TaskRecord(task=task, run_specs=(spec,), attempts=(attempt,))
    graph = project_task_graph(record)
    execution = next(node for node in graph.nodes if node.type == "EXECUTION")
    detail = project_node_detail(record, execution.id)
    item = detail.summary["attempt_history"][0]

    assert item["capability_snapshot"]["logs"] is True
    assert item["capability_snapshot"]["trace"] is True
    assert item["observed_runtime_environment"]["host"] == "fwq10ys"
    assert item["observed_resource_allocation"]["cpu_count"] == 8
    assert item["binding"]["pid"] == 4242
