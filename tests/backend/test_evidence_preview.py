from pathlib import Path
from uuid import UUID

import pytest

from bioharness_web.evidence import EvidencePreviewer
from bioharness_web.repository import TaskRecord


TASK_ID = UUID("00000000-0000-0000-0000-000000000101")


def record_with_evidence(host_path: str, role: str = "execution_log") -> TaskRecord:
    return TaskRecord(
        task={
            "id": str(TASK_ID),
            "question": "preview evidence",
            "analysis_class": "test",
            "created_at": "2026-09-19T02:00:00Z",
        },
        events=(
            {
                "id": "event-1",
                "run_attempt_id": "attempt-1",
                "sequence_no": 1,
                "event_type": "ReconciliationResolved",
                "payload": {
                    "executor_evidence": {
                        "active": False,
                        "terminal_outcome": "succeeded",
                        "exit_code": 0,
                        "evidence": [
                            {"role": role, "path": host_path},
                        ],
                    },
                },
                "occurred_at": "2026-09-19T02:01:00Z",
            },
        ),
    )


def test_preview_is_limited_to_persisted_evidence_and_mapped_root(tmp_path: Path):
    mount_root = tmp_path / "evidence"
    relative = Path("sessions/a/runs/attempts/x/nextflow.log")
    target = mount_root / relative
    target.parent.mkdir(parents=True)
    target.write_text("line 1\nline 2\n", encoding="utf-8")

    host_root = Path("/home/yangs/software/BioHarness-P0-Acceptance")
    record = record_with_evidence(str(host_root / relative))
    previewer = EvidencePreviewer(
        host_root=host_root,
        mount_root=mount_root,
        max_bytes=1024,
    )

    refs = previewer.references(record, TASK_ID)
    assert len(refs) == 1
    assert refs[0]["role"] == "execution_log"
    assert refs[0]["run_attempt_id"] == "attempt-1"
    assert refs[0]["name"] == "nextflow.log"
    assert refs[0]["preview_ref"].endswith(refs[0]["id"])

    preview = previewer.preview(record, refs[0]["id"])
    assert preview["content"] == "line 1\nline 2\n"
    assert preview["truncated"] is False

    with pytest.raises(KeyError):
        previewer.preview(record, "arbitrary-path-is-not-an-id")


def test_preview_rejects_persisted_paths_outside_allowed_host_root(tmp_path: Path):
    previewer = EvidencePreviewer(
        host_root=Path("/srv/allowed"),
        mount_root=tmp_path,
        max_bytes=1024,
    )
    record = record_with_evidence("/srv/allowed/../secret.txt")

    assert previewer.references(record, TASK_ID) == ()


def test_large_preview_keeps_head_and_tail(tmp_path: Path):
    mount_root = tmp_path / "evidence"
    relative = Path("sessions/a/stderr.log")
    target = mount_root / relative
    target.parent.mkdir(parents=True)
    target.write_text("HEAD\n" + ("x" * 2000) + "\nTAIL\n", encoding="utf-8")

    host_root = Path("/srv/bioharness")
    record = record_with_evidence(str(host_root / relative), role="wrapper_stderr")
    previewer = EvidencePreviewer(
        host_root=host_root,
        mount_root=mount_root,
        max_bytes=256,
    )

    ref = previewer.references(record, TASK_ID)[0]
    preview = previewer.preview(record, ref["id"])

    assert preview["truncated"] is True
    assert "HEAD" in preview["content"]
    assert "TAIL" in preview["content"]
    assert "中间内容已省略" in preview["content"]


def test_registered_artifact_is_previewable_for_its_attempt_without_event_evidence(
    tmp_path: Path,
):
    mount_root = tmp_path / "evidence"
    relative = Path("sessions/a/output/candidate/audit.tsv")
    target = mount_root / relative
    target.parent.mkdir(parents=True)
    target.write_text("gene\tstatus\nA\tPASS\n", encoding="utf-8")

    host_root = Path("/srv/bioharness")
    record = TaskRecord(
        task={
            "id": str(TASK_ID),
            "question": "artifact evidence",
            "analysis_class": "test",
            "created_at": "2026-09-19T02:00:00Z",
        },
        artifacts=(
            {
                "id": "artifact-1",
                "run_spec_id": "spec-1",
                "run_attempt_id": "attempt-2",
                "role": "audit_table",
                "uri": f"file://{host_root / relative}",
                "registered_at": "2026-09-19T02:02:00Z",
            },
        ),
    )
    previewer = EvidencePreviewer(
        host_root=host_root,
        mount_root=mount_root,
        max_bytes=1024,
    )

    refs = previewer.references(record, TASK_ID)

    assert len(refs) == 1
    assert refs[0]["role"] == "audit_table"
    assert refs[0]["run_attempt_id"] == "attempt-2"
    preview = previewer.preview(record, refs[0]["id"])
    assert "gene\tstatus" in preview["content"]
