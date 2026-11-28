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


def test_open_verified_content_serves_verified_pdf_and_refuses_drift(workspace, workspace_dir):
    pdf_bytes = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n"
    path = workspace_dir / "report.pdf"
    path.write_bytes(pdf_bytes)
    data, meta = evidence.read_verified_content(workspace, item(path, pdf_bytes))
    assert meta["media_type"] == "application/pdf"
    assert meta["current_file_identity"] == "MATCHES_RECORD"
    assert meta["size_bytes"] == len(pdf_bytes)
    assert data == pdf_bytes
    # A writer modifying the source after capture cannot change returned bytes.
    path.write_bytes(b"changed in place")
    assert data == pdf_bytes
    assert hashlib.sha256(data).hexdigest() == meta["sha256"]

    # Drift detection: modifying file after recording refuses serving bytes as recorded version.
    path.write_bytes(pdf_bytes + b"tampered")
    with pytest.raises(evidence.EvidenceContentError) as exc:
        evidence.read_verified_content(workspace, item(path, pdf_bytes))
    assert exc.value.status == 409
    assert exc.value.code == "EVIDENCE_CONTENT_DRIFT"


def test_open_verified_content_refuses_unsupported_and_oversized_and_html_runs_as_text(workspace, workspace_dir, monkeypatch):
    bam = workspace_dir / "reads.bam"
    bam.write_bytes(b"\x00\x01\x02")
    with pytest.raises(evidence.EvidenceContentError) as exc:
        evidence.read_verified_content(workspace, item(bam, b"\x00\x01\x02"))
    assert exc.value.status == 415
    assert exc.value.code == "UNSUPPORTED_MEDIA_FORMAT"

    html = workspace_dir / "plot.html"
    html_bytes = b"<html><script>alert(1)</script></html>"
    html.write_bytes(html_bytes)
    data, meta = evidence.read_verified_content(workspace, item(html, html_bytes))
    assert data == html_bytes
    assert meta["media_type"] == "text/plain; charset=utf-8"

    big = workspace_dir / "big.pdf"
    big.write_bytes(b"%PDF-1.4\n" + b"0" * 100)
    monkeypatch.setattr(evidence, "HASH_LIMIT_BYTES", 32)
    with pytest.raises(evidence.EvidenceContentError) as exc2:
        evidence.read_verified_content(workspace, item(big, big.read_bytes()))
    assert exc2.value.status == 409
    assert exc2.value.code == "EVIDENCE_EXCEEDS_HASH_BUDGET"


def test_parse_byte_range_bounds_and_rejects_malformed():
    assert evidence.parse_byte_range(None, 100) == (0, 99, False)
    assert evidence.parse_byte_range("bytes=0-9", 100) == (0, 9, True)
    assert evidence.parse_byte_range("bytes=90-", 100) == (90, 99, True)
    assert evidence.parse_byte_range("bytes=-10", 100) == (90, 99, True)
    assert evidence.parse_byte_range("bytes=0-999", 100, max_chunk=20) == (0, 19, True)
    for bad in ("bytes=100-110", "bytes=10-5", "bytes=0-1,2-3", "items=0-5", "bytes=-0"):
        with pytest.raises(evidence.EvidenceContentError) as exc:
            evidence.parse_byte_range(bad, 100)
        assert exc.value.status == 416


def test_table_page_paginates_honestly_and_never_infers_truncated_totals(workspace, workspace_dir):
    tsv_text = "gene\tlog2fc\tpadj\nG1\t1.5\t0.001\nG2\t-2.0\t0.01\nG3\t0.4\t0.5\n"
    data = tsv_text.encode("utf-8")
    path = workspace_dir / "deg.tsv"
    path.write_bytes(data)

    page1 = evidence.table_page(workspace, item(path, data), offset=0, limit=2)
    assert page1["content_available"] is True
    assert page1["current_file_identity"] == "MATCHES_RECORD"
    assert [c["name"] for c in page1["columns"]] == ["gene", "log2fc", "padj"]
    assert page1["returned_rows"] == 2
    assert page1["has_more"] is True
    assert page1["total_rows"] == 3
    assert page1["total_rows_known"] is True
    assert page1["truncated"] is False
    assert page1["sort_scope"] == "loaded_rows_only"
    assert page1["rows"][0]["c0"] == "G1"

    page2 = evidence.table_page(workspace, item(path, data), offset=2, limit=2)
    assert page2["returned_rows"] == 1
    assert page2["has_more"] is False
    assert page2["rows"][0]["c0"] == "G3"

    # Truncated parse cap: total_rows MUST be None and total_rows_known False!
    trunc = evidence.table_page(workspace, item(path, data), offset=0, limit=2, parse_limit_bytes=35)
    assert trunc["content_available"] is True
    assert trunc["truncated"] is True
    assert trunc["total_rows"] is None
    assert trunc["total_rows_known"] is False
    assert trunc["has_more"] is False
    assert trunc["preview_rows"] == trunc["returned_rows"]

    # Drift refuses serving table rows as recorded version
    path.write_bytes(data + b"G4\t9\t0\n")
    drifted = evidence.table_page(workspace, item(path, data), offset=0, limit=10)
    assert drifted["content_available"] is False
    assert drifted["current_file_identity"] == "DIFFERS_FROM_RECORD"
    assert drifted["unavailable_reason"] == "CONTENT_DIFFERS_FROM_RECORD"

def test_verified_table_never_parses_post_hash_mutation(workspace, workspace_dir, monkeypatch):
    path = workspace_dir / "table.csv"
    original = b"gene,value\nA,1\n"
    path.write_bytes(original)
    capture = evidence._capture_verified_bytes
    def mutate_after_capture(handle, expected_sha):
        data, digest = capture(handle, expected_sha)
        path.write_bytes(b"gene,value\nB,9\n")
        return data, digest
    monkeypatch.setattr(evidence, "_capture_verified_bytes", mutate_after_capture)
    table = evidence.table_page(workspace, item(path, original))
    assert table["rows"] == [{"__row_index": 1, "c0": "A", "c1": "1"}]


def test_multiline_csv_truncation_stops_at_complete_record(workspace, workspace_dir):
    path = workspace_dir / "multiline.csv"
    complete = b'gene,value\nA,1\nB,2\n'
    data = complete + b'C,"first line\nsecond line"\nD,4\n'
    path.write_bytes(data)
    cap = len(complete + b'C,"first line\n')
    page = evidence.table_page(workspace, item(path, data), offset=0, limit=1, parse_limit_bytes=cap)
    assert page["truncated"] and page["total_rows"] is None
    assert page["preview_rows"] == 2 and page["has_more"]
    end = evidence.table_page(workspace, item(path, data), offset=1, limit=1, parse_limit_bytes=cap)
    assert end["rows"][0]["c0"] == "B"
    assert not end["has_more"]
    empty = evidence.table_page(workspace, item(path, data), offset=2, limit=1, parse_limit_bytes=cap)
    assert empty["rows"] == [] and not empty["has_more"]
    full = evidence.table_page(workspace, item(path, data))
    assert full["rows"][2]["c1"] == "first line\nsecond line"
    assert full["total_rows"] == 4


def test_csv_malformed_record_explicitly_unavailable(workspace, workspace_dir):
    path = workspace_dir / "malformed.csv"
    data = b'gene,value\nA,"unterminated\n'
    path.write_bytes(data)
    page = evidence.table_page(workspace, item(path, data))
    assert not page["content_available"] and page["unavailable_reason"] == "TABLE_PARSE_ERROR"
