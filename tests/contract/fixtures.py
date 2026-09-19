from datetime import datetime, timedelta, timezone
from uuid import uuid4


NOW = datetime(2026, 9, 19, 2, 0, tzinfo=timezone.utc)


def task_payload(
    *,
    question: str = "Genome-web TF reference",
    unresolved_fields=(),
    extra_payload=None,
):
    payload = {
        "id": str(uuid4()),
        "revision": 1,
        "question": question,
        "requested_inference": "reference TF family tree",
        "analysis_class": "tf_family_phylogeny_reference",
        "biological_scope": {},
        "output_intent": "candidate",
        "unresolved_fields": list(unresolved_fields),
        "created_at": NOW.isoformat(),
    }
    payload.update(extra_payload or {})
    return payload


def attempt_payload(*, run_spec_id: str, number: int, state: str, age_seconds: int = 0):
    return {
        "id": str(uuid4()),
        "run_spec_id": run_spec_id,
        "attempt_number": number,
        "executor_namespace": "genome-web-local",
        "capability_snapshot": {},
        "submission_key": str(uuid4()),
        "provider_attempt_name": f"bh-test-{number}",
        "state": state,
        "submitted_at": (NOW - timedelta(seconds=age_seconds)).isoformat(),
        "last_reconciled_at": None,
    }


def run_spec_payload(*, task_id: str):
    return {
        "id": str(uuid4()),
        "task_spec_id": task_id,
        "assessment_id": str(uuid4()),
        "configuration_id": str(uuid4()),
        "context_snapshot_id": str(uuid4()),
        "resolved_data_ref_ids": [],
        "analysis_hash": "a" * 64,
        "run_spec_hash": "b" * 64,
        "validation_profile_id": "candidate",
        "validation_profile_revision": "1",
        "expected_outputs": [],
        "executable": True,
        "created_at": NOW.isoformat(),
    }


def data_ref_payload(*, uid: str = "00902"):
    return {
        "id": str(uuid4()),
        "provider": "genome-web",
        "provider_revision": "05072cbb",
        "resource_type": "registered_genome",
        "logical_uri": f"genomeweb:registered-genome:Beta:{uid}",
        "manifest_sha256": "c" * 64,
        "member_manifest_sha256": "d" * 64,
        "biological_identity": {"uid": uid},
        "metadata": {},
        "resolved_at": NOW.isoformat(),
    }


def assessment_payload(*, task_id: str, status: str = "ANALYSIS_SUPPORTED"):
    return {
        "id": str(uuid4()),
        "task_spec_id": task_id,
        "task_spec_revision": 1,
        "resolved_data_ref_ids": [],
        "scientific_contract_id": "tf-reference",
        "scientific_contract_revision": "1",
        "dependency_fingerprint": "e" * 64,
        "status": status,
        "assessed_at": NOW.isoformat(),
    }


def configuration_payload(*, task_id: str, assessment_id: str):
    return {
        "id": str(uuid4()),
        "task_spec_id": task_id,
        "assessment_id": assessment_id,
        "provider_workflow_identity": {"provider": "genome-web"},
        "result_affecting_parameters": {},
        "environment_contract": {},
        "reproducibility_contract": {},
        "validation_profile_id": "candidate",
        "validation_profile_revision": "1",
        "assumption_constraints": {},
        "planned_resource_controls": {},
        "created_at": NOW.isoformat(),
    }


def context_payload(*, memory_refs=()):
    return {
        "id": str(uuid4()),
        "policy_decision_ids": [],
        "memory_refs": list(memory_refs),
        "metadata": {},
        "created_at": NOW.isoformat(),
    }


def policy_payload(*, outcome: str = "ALLOW", action: str = "launch"):
    return {
        "id": str(uuid4()),
        "actor": "acceptance",
        "action": action,
        "resource": "runspec:test",
        "policy_revision": "v1",
        "outcome": outcome,
        "decided_at": NOW.isoformat(),
    }


def event_payload(*, attempt_id: str, sequence_no: int, event_type: str):
    return {
        "id": str(uuid4()),
        "run_attempt_id": attempt_id,
        "sequence_no": sequence_no,
        "event_type": event_type,
        "payload": {},
        "occurred_at": NOW.isoformat(),
    }


def artifact_payload(*, run_spec_id: str, attempt_id: str, role: str = "candidate_manifest"):
    return {
        "id": str(uuid4()),
        "run_spec_id": run_spec_id,
        "run_attempt_id": attempt_id,
        "role": role,
        "content_sha256": "f" * 64,
        "size_bytes": 123,
        "uri": f"file:///tmp/{role}",
        "metadata": {},
        "registered_at": NOW.isoformat(),
    }


def validation_report_payload(*, attempt_id: str, outcome: str = "PASS"):
    return {
        "id": str(uuid4()),
        "kind": "provider_contract",
        "subject_type": "run_attempt",
        "subject_id": attempt_id,
        "validator": "genome-web",
        "validator_revision": "1",
        "outcome": outcome,
        "limitations": [],
        "evidence_refs": ["file:///tmp/candidate_manifest"],
        "created_at": NOW.isoformat(),
    }


def validation_evaluation_payload(*, report_id: str, outcome: str = "PASS"):
    return {
        "id": str(uuid4()),
        "profile_id": "candidate",
        "profile_revision": "1",
        "report_ids": [report_id],
        "outcome": outcome,
        "evaluated_at": NOW.isoformat(),
    }


def memory_candidate_payload(*, statement: str = "Use the validated TF procedure"):
    return {
        "id": str(uuid4()),
        "scope": "project:test",
        "kind": "procedure",
        "statement": statement,
        "tags": ["tf"],
        "applicability": {"provider": "genome-web"},
        "evidence_refs": ["validation:test"],
        "status": "candidate",
        "created_at": NOW.isoformat(),
    }
