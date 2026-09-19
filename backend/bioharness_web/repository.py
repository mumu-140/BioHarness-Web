from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import text

from .db import ReadOnlyDatabase


Payload = dict[str, Any]


@dataclass(frozen=True)
class TaskRecord:
    task: Payload
    run_specs: tuple[Payload, ...] = ()
    attempts: tuple[Payload, ...] = ()
    data_refs: tuple[Payload, ...] = ()
    assessments: tuple[Payload, ...] = ()
    configurations: tuple[Payload, ...] = ()
    contexts: tuple[Payload, ...] = ()
    policy_decisions: tuple[Payload, ...] = ()
    events: tuple[Payload, ...] = ()
    artifacts: tuple[Payload, ...] = ()
    validation_reports: tuple[Payload, ...] = ()
    validation_evaluations: tuple[Payload, ...] = ()
    memory_candidates: tuple[Payload, ...] = ()


class BioHarnessReadRepository:
    def __init__(self, database: ReadOnlyDatabase):
        self._database = database

    @staticmethod
    def _payloads(connection, statement: str, **params) -> tuple[Payload, ...]:
        rows = connection.execute(text(statement), params).mappings().all()
        return tuple(dict(row["payload"]) for row in rows)

    def list_task_records(self) -> tuple[TaskRecord, ...]:
        with self._database.connection() as connection:
            task_rows = connection.execute(
                text(
                    "SELECT payload FROM scientific_task_specs "
                    "ORDER BY created_at DESC"
                )
            ).mappings().all()
            return tuple(
                self._load_task_record(connection, dict(row["payload"]))
                for row in task_rows
            )

    def get_task_record(self, task_id: UUID) -> TaskRecord | None:
        with self._database.connection() as connection:
            row = connection.execute(
                text(
                    "SELECT payload FROM scientific_task_specs "
                    "WHERE id = :task_id"
                ),
                {"task_id": task_id},
            ).mappings().one_or_none()
            if row is None:
                return None
            return self._load_task_record(connection, dict(row["payload"]))

    def _load_task_record(self, connection, task: Payload) -> TaskRecord:
        task_id = task["id"]
        run_specs = self._payloads(
            connection,
            "SELECT payload FROM run_specs "
            "WHERE task_spec_id = :task_id ORDER BY created_at",
            task_id=task_id,
        )
        attempts = self._payloads(
            connection,
            "SELECT ra.payload FROM run_attempts ra "
            "JOIN run_specs rs ON rs.id = ra.run_spec_id "
            "WHERE rs.task_spec_id = :task_id "
            "ORDER BY ra.attempt_number",
            task_id=task_id,
        )
        assessments = self._payloads(
            connection,
            "SELECT payload FROM scientific_assessments "
            "WHERE task_spec_id = :task_id ORDER BY assessed_at",
            task_id=task_id,
        )
        configurations = self._payloads(
            connection,
            "SELECT payload FROM resolved_configurations "
            "WHERE task_spec_id = :task_id ORDER BY created_at",
            task_id=task_id,
        )
        events = self._payloads(
            connection,
            "SELECT re.payload FROM run_events re "
            "JOIN run_attempts ra ON ra.id = re.run_attempt_id "
            "JOIN run_specs rs ON rs.id = ra.run_spec_id "
            "WHERE rs.task_spec_id = :task_id "
            "ORDER BY re.occurred_at, re.sequence_no",
            task_id=task_id,
        )
        artifacts = self._payloads(
            connection,
            "SELECT a.payload FROM artifacts a "
            "JOIN run_specs rs ON rs.id = a.run_spec_id "
            "WHERE rs.task_spec_id = :task_id ORDER BY a.registered_at",
            task_id=task_id,
        )

        data_ref_ids = {
            ref_id
            for spec in run_specs
            for ref_id in spec.get("resolved_data_ref_ids", ())
        }
        data_refs = tuple(
            payload
            for ref_id in data_ref_ids
            for payload in self._payloads(
                connection,
                "SELECT payload FROM resolved_data_refs WHERE id = :value_id",
                value_id=ref_id,
            )
        )

        context_ids = {
            spec.get("context_snapshot_id")
            for spec in run_specs
            if spec.get("context_snapshot_id")
        }
        contexts = tuple(
            payload
            for context_id in context_ids
            for payload in self._payloads(
                connection,
                "SELECT payload FROM context_snapshots WHERE id = :value_id",
                value_id=context_id,
            )
        )

        attempt_ids = {str(item["id"]) for item in attempts if item.get("id")}
        validation_reports = tuple(
            payload
            for attempt_id in attempt_ids
            for payload in self._payloads(
                connection,
                "SELECT payload FROM validation_reports "
                "WHERE subject_type = 'run_attempt' AND subject_id = :subject_id "
                "ORDER BY created_at",
                subject_id=attempt_id,
            )
        )

        evaluation_rows = self._payloads(
            connection,
            "SELECT payload FROM validation_evaluations ORDER BY evaluated_at",
        )
        report_ids = {
            str(report["id"])
            for report in validation_reports
            if report.get("id")
        }
        validation_evaluations = tuple(
            evaluation
            for evaluation in evaluation_rows
            if report_ids.intersection(
                str(value) for value in evaluation.get("report_ids", ())
            )
        )

        policy_ids = {
            event.get("payload", {}).get("policy_decision_id")
            for event in events
            if event.get("payload", {}).get("policy_decision_id")
        }
        policy_decisions = tuple(
            payload
            for policy_id in policy_ids
            for payload in self._payloads(
                connection,
                "SELECT payload FROM policy_decisions WHERE id = :value_id",
                value_id=policy_id,
            )
        )

        memory_candidates = self._payloads(
            connection,
            "SELECT payload FROM memory_candidates ORDER BY created_at",
        )

        return TaskRecord(
            task=task,
            run_specs=run_specs,
            attempts=attempts,
            data_refs=data_refs,
            assessments=assessments,
            configurations=configurations,
            contexts=contexts,
            policy_decisions=policy_decisions,
            events=events,
            artifacts=artifacts,
            validation_reports=validation_reports,
            validation_evaluations=validation_evaluations,
            memory_candidates=memory_candidates,
        )
