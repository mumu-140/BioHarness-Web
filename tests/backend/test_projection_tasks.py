from bioharness_web.projection import project_task_summaries, project_task_summary
from bioharness_web.repository import BioHarnessReadRepository, TaskRecord
from tests.contract.fixtures import attempt_payload, run_spec_payload, task_payload


def test_task_without_runs_still_projects():
    record = TaskRecord(task=task_payload())
    summary = project_task_summary(record)
    assert summary.status == "WAITING"
    assert summary.stage == "TASK"


def test_attention_sorts_before_running_then_recent_finished():
    attention = TaskRecord(task=task_payload(unresolved_fields=("species",)))

    running_task = task_payload(question="running")
    running_spec = run_spec_payload(task_id=running_task["id"])
    running = TaskRecord(
        task=running_task,
        run_specs=(running_spec,),
        attempts=(
            attempt_payload(
                run_spec_id=running_spec["id"],
                number=1,
                state="RUNNING",
                age_seconds=5,
            ),
        ),
    )

    finished_task = task_payload(question="finished")
    finished_spec = run_spec_payload(task_id=finished_task["id"])
    finished = TaskRecord(
        task=finished_task,
        run_specs=(finished_spec,),
        attempts=(
            attempt_payload(
                run_spec_id=finished_spec["id"],
                number=1,
                state="FINISHED",
                age_seconds=60,
            ),
        ),
    )

    summaries = project_task_summaries((finished, running, attention))
    assert [item.status for item in summaries] == [
        "ATTENTION",
        "RUNNING",
        "FINISHED",
    ]


def test_unknown_future_payload_fields_are_ignored():
    record = TaskRecord(task=task_payload(extra_payload={"future_field": {"x": 1}}))
    summary = project_task_summary(record)
    assert summary.title == "Genome-web TF reference"


def test_question_is_used_as_safe_title_when_no_explicit_title():
    record = TaskRecord(task=task_payload(question="How does X respond?"))
    summary = project_task_summary(record)
    assert summary.title == "How does X respond?"


def test_repository_exposes_no_mutation_api():
    forbidden = {"add", "save", "delete", "update", "commit"}
    assert forbidden.isdisjoint(set(dir(BioHarnessReadRepository)))
