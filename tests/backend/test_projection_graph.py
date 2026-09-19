from bioharness_web.projection import project_task_graph
from bioharness_web.repository import TaskRecord
from tests.contract.fixtures import (
    artifact_payload,
    assessment_payload,
    attempt_payload,
    configuration_payload,
    context_payload,
    data_ref_payload,
    event_payload,
    memory_candidate_payload,
    policy_payload,
    run_spec_payload,
    task_payload,
    validation_evaluation_payload,
    validation_report_payload,
)


def successful_record():
    task = task_payload()
    assessment = assessment_payload(task_id=task["id"])
    configuration = configuration_payload(
        task_id=task["id"], assessment_id=assessment["id"]
    )
    context = context_payload()
    spec = run_spec_payload(task_id=task["id"])
    spec["assessment_id"] = assessment["id"]
    spec["configuration_id"] = configuration["id"]
    spec["context_snapshot_id"] = context["id"]
    attempt = attempt_payload(
        run_spec_id=spec["id"], number=1, state="FINISHED"
    )
    events = (
        event_payload(
            attempt_id=attempt["id"],
            sequence_no=1,
            event_type="AttemptCreated",
        ),
        event_payload(
            attempt_id=attempt["id"],
            sequence_no=2,
            event_type="SubmissionIntentRecorded",
        ),
        event_payload(
            attempt_id=attempt["id"],
            sequence_no=3,
            event_type="ExternalProcessBound",
        ),
    )
    artifact = artifact_payload(
        run_spec_id=spec["id"], attempt_id=attempt["id"]
    )
    report = validation_report_payload(attempt_id=attempt["id"])
    evaluation = validation_evaluation_payload(report_id=report["id"])
    return TaskRecord(
        task=task,
        data_refs=(data_ref_payload(),),
        assessments=(assessment,),
        configurations=(configuration,),
        contexts=(context,),
        run_specs=(spec,),
        attempts=(attempt,),
        policy_decisions=(policy_payload(),),
        events=events,
        artifacts=(artifact,),
        validation_reports=(report,),
        validation_evaluations=(evaluation,),
    )


def test_successful_tf_task_builds_stage_graph():
    graph = project_task_graph(successful_record())
    assert [node.type for node in graph.nodes] == [
        "TASK",
        "DATA",
        "ASSESSMENT",
        "PLANNING",
        "POLICY",
        "EXECUTION",
        "COLLECTION",
        "VALIDATION",
    ]
    assert graph.nodes[-1].status == "COMPLETED"


def test_low_level_run_events_are_not_graph_nodes():
    graph = project_task_graph(successful_record())
    node_types = {node.type for node in graph.nodes}
    assert "SubmissionIntentRecorded" not in node_types
    assert "ExternalProcessBound" not in node_types


def test_memory_candidate_without_context_ref_does_not_create_used_memory_node():
    record = successful_record()
    record = TaskRecord(
        **{
            **record.__dict__,
            "memory_candidates": (memory_candidate_payload(),),
        }
    )
    graph = project_task_graph(record)
    assert "MEMORY" not in {node.type for node in graph.nodes}


def test_context_memory_refs_create_memory_node():
    record = successful_record()
    context = context_payload(memory_refs=("memory:validated-tf",))
    spec = dict(record.run_specs[0])
    spec["context_snapshot_id"] = context["id"]
    record = TaskRecord(
        **{
            **record.__dict__,
            "contexts": (context,),
            "run_specs": (spec,),
        }
    )
    graph = project_task_graph(record)
    assert "MEMORY" in {node.type for node in graph.nodes}
