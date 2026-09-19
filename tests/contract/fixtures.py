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
