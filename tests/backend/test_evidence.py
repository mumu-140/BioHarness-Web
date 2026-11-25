import hashlib
import os

import pytest

from bioharness_web import evidence
from bioharness_web.settings import Workspace


@pytest.fixture
def workspace(workspace_dir):
    return Workspace(id="pilot", path=workspace_dir, evidence_roots=(workspace_dir,))


def item(path, data: bytes, **extra):
    return {"id": "e1", "kind": "file", "source": str(path),
            "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), **extra}


def test_previews_a_recorded_file_inside_the_workspace(workspace, workspace_dir):
    data = b"gene\tcount\nA\t3\n"
    path = workspace_dir / "table.tsv"
    path.write_bytes(data)
    result = evidence.preview(workspace, item(path, data), 4096)
    assert result["content_available"] is True
    assert result["content"] == data.decode()
    assert result["name"] == "table.tsv"  # the file name, never the server path
    assert result["format"] == "table" and result["truncated"] is False
    assert result["current_file_identity"] == "MATCHES_RECORD"


def test_a_file_changed_after_submission_is_shown_as_different(workspace, workspace_dir):
    path = workspace_dir / "notes.txt"
    path.write_bytes(b"new content")
    result = evidence.preview(workspace, item(path, b"old content"), 4096)
    assert result["content_available"] is True
    assert result["current_file_identity"] == "DIFFERS_FROM_RECORD"


def test_long_files_keep_head_and_tail(workspace, workspace_dir):
    data = b"H" * 5000 + b"M" * 20000 + b"T" * 5000
    path = workspace_dir / "long.txt"
    path.write_bytes(data)
    result = evidence.preview(workspace, item(path, data), 4096)
    assert result["truncated"] is True and result["size_bytes"] == len(data)
    assert result["content"].startswith("H" * 2048) and result["content"].endswith("T" * 2048)
    assert "中间内容已省略" in result["content"] and "M" not in result["content"]


def test_binary_is_not_previewed(workspace, workspace_dir):
    data = b"\x00\x01\x02binary"
    path = workspace_dir / "reads.bam"
    path.write_bytes(data)
    result = evidence.preview(workspace, item(path, data), 4096)
    assert result["content_available"] is False
    assert result["unavailable_reason"] == "BINARY_PREVIEW_NOT_SUPPORTED"
    assert "content" not in result


def test_a_recorded_path_outside_the_configured_roots_is_not_opened(workspace, tmp_path):
    outside = tmp_path / "outside.txt"
    outside.write_bytes(b"secret")
    result = evidence.preview(workspace, item(outside, b"secret"), 4096)
    assert result["content_available"] is False
    assert result["unavailable_reason"] == "NOT_AVAILABLE_IN_CONFIGURED_ROOTS"
    assert result["current_file_identity"] == "NOT_CHECKED"


def test_a_symlink_leaving_the_root_is_not_followed(workspace, workspace_dir, tmp_path):
    outside = tmp_path / "outside.txt"
    outside.write_bytes(b"secret")
    link = workspace_dir / "link.txt"
    os.symlink(outside, link)
    result = evidence.preview(workspace, item(link, b"secret"), 4096)
    assert result["content_available"] is False
    assert result["unavailable_reason"] == "NOT_AVAILABLE_IN_CONFIGURED_ROOTS"


def test_the_final_component_is_never_followed_as_a_symlink(workspace, workspace_dir, tmp_path, monkeypatch):
    """Even if the path check were bypassed, the open itself refuses a symlink."""
    outside = tmp_path / "outside.txt"
    outside.write_bytes(b"secret")
    link = workspace_dir / "link.txt"
    os.symlink(outside, link)
    monkeypatch.setattr(evidence, "_allowed_file", lambda _workspace, _source: link)
    monkeypatch.setattr(evidence, "_permitted", lambda _workspace, _path: True)
    assert evidence.preview(workspace, item(link, b"secret"), 4096)["content_available"] is False


def test_what_was_opened_is_checked_again(workspace, workspace_dir, tmp_path, monkeypatch):
    """A directory swapped for a symlink after the path check must not leak a file."""
    outside = tmp_path / "outside.txt"
    outside.write_bytes(b"secret")
    inside = workspace_dir / "table.tsv"
    inside.write_bytes(b"ok")
    # the path check approved a path that, by the time it is opened, leads outside
    monkeypatch.setattr(evidence, "_allowed_file", lambda _workspace, _source: outside)
    result = evidence.preview(workspace, item(inside, b"ok"), 4096)
    assert result["content_available"] is False and "content" not in result


def test_a_fifo_does_not_block_and_is_not_read(workspace, workspace_dir):
    fifo = workspace_dir / "pipe"
    os.mkfifo(fifo)
    result = evidence.preview(workspace, item(fifo, b""), 4096)
    assert result["content_available"] is False
    assert result["unavailable_reason"] == "NOT_AVAILABLE_IN_CONFIGURED_ROOTS"


def test_a_malformed_recorded_path_is_unavailable_not_an_error(workspace, workspace_dir):
    result = evidence.preview(workspace, item(f"{workspace_dir}/a\x00b", b""), 4096)
    assert result["content_available"] is False


def test_core_state_of_another_workspace_under_a_root_is_never_previewed(tmp_path):
    parent = (tmp_path / "projects").resolve()
    mine, other = parent / "mine", parent / "other"
    (mine / ".bioharness" / "requests").mkdir(parents=True)
    (other / ".bioharness" / "requests").mkdir(parents=True)
    record = other / ".bioharness" / "requests" / "sci-secret.json"
    record.write_bytes(b'{"question": "private"}')
    workspace = Workspace(id="mine", path=mine, evidence_roots=(mine, parent))
    result = evidence.preview(workspace, item(record, record.read_bytes()), 4096)
    assert result["content_available"] is False and "content" not in result


def test_core_state_reached_through_a_symlink_is_never_previewed(tmp_path):
    root = (tmp_path / "ws").resolve()
    real = root / "state-elsewhere"
    (real / "evidence").mkdir(parents=True)
    os.symlink(real, root / ".bioharness")
    snapshot = real / "evidence" / ("a" * 64)
    snapshot.write_bytes(b"snapshot")
    workspace = Workspace(id="pilot", path=root, evidence_roots=(root,))
    assert evidence.preview(workspace, item(snapshot, b"snapshot"), 4096)["content_available"] is False


def test_pretty_printed_json_stays_within_the_bound(workspace, workspace_dir):
    data = ("[" + ",".join(["[1]"] * 1500) + "]").encode()  # indentation would triple it
    path = workspace_dir / "dense.json"
    path.write_bytes(data)
    result = evidence.preview(workspace, item(path, data), 8192)
    assert result["truncated"] is False
    assert len(result["content"].encode()) <= 8192 and result["content"] == data.decode()


@pytest.mark.parametrize("name,expected", [
    ("a.fa", "fasta"), ("a.fasta", "fasta"), ("a.faa", "fasta"), ("a.fna", "fasta"),
    ("a.tree", "newick"), ("a.treefile", "newick"), ("a.nwk", "newick"), ("a.newick", "newick"),
    ("a.csv", "table"), ("a.TSV", "table"), ("a.log", "text"), ("noext", "text"),
])
def test_format_follows_the_file_name(workspace, workspace_dir, name, expected):
    path = workspace_dir / name
    path.write_bytes(b"x")
    assert evidence.preview(workspace, item(path, b"x"), 4096)["format"] == expected


def test_traversal_in_a_recorded_path_is_resolved_before_the_check(workspace, workspace_dir, tmp_path):
    (tmp_path / "outside.txt").write_bytes(b"secret")
    sneaky = f"{workspace_dir}/../outside.txt"
    result = evidence.preview(workspace, item(sneaky, b"secret"), 4096)
    assert result["content_available"] is False


def test_core_state_files_are_never_previewed(workspace, workspace_dir):
    record = workspace_dir / ".bioharness" / "requests" / "sci-1.json"
    record.write_bytes(b"{}")
    result = evidence.preview(workspace, item(record, b"{}"), 4096)
    assert result["content_available"] is False


def test_relative_and_missing_paths(workspace, workspace_dir):
    assert evidence.preview(workspace, item("table.tsv", b""), 4096)["content_available"] is False
    missing = workspace_dir / "gone.txt"
    assert evidence.preview(workspace, item(missing, b""), 4096)["content_available"] is False


def test_text_evidence_content_is_reported_as_not_exposed(workspace):
    result = evidence.preview(workspace, {"id": "e2", "kind": "text", "source": "doi:10.1/x",
                                          "sha256": "a" * 64, "bytes": 10}, 4096)
    assert result["content_available"] is False
    assert result["unavailable_reason"] == "CONTENT_NOT_EXPOSED_BY_PUBLIC_INTERFACE"
    assert result["name"] == "doi:10.1/x"


def test_an_extra_configured_root_is_allowed(workspace_dir, tmp_path):
    extra = (tmp_path / "results").resolve()
    extra.mkdir()
    path = extra / "out.json"
    path.write_bytes(b'{"a":1}')
    workspace = Workspace(id="pilot", path=workspace_dir, evidence_roots=(workspace_dir, extra))
    result = evidence.preview(workspace, item(path, b'{"a":1}'), 4096)
    assert result["content_available"] is True
    assert result["format"] == "json" and result["content"] == '{\n  "a": 1\n}'
