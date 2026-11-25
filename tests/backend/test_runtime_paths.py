"""Which proposed paths the runtime refuses to hand on."""
import pytest

from bioharness_web.runtime import Runtime


@pytest.fixture
def workspace(settings, workspace_dir, tmp_path):
    (workspace_dir / "notes.txt").write_text("x")
    (workspace_dir / "sub").mkdir()
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    (outside / "secret.txt").write_text("secret")
    (workspace_dir / "link").symlink_to(outside)
    return settings.workspaces["pilot"]


def refused(workspace, tool, arguments):
    return Runtime._path_outside(workspace, tool, arguments)


@pytest.mark.parametrize("evidence", [
    [{"path": ".bioharness/requests/r.json"}],
    [{"file": ".bioharness/requests/r.json"}],      # Core reads this key too
    [".bioharness/requests/r.json"],                # and a bare string
    {"file": "../outside.txt"},                     # a single item instead of a list
    [{"path": "~/secret.txt"}],                     # Core expands ~
    [{"path": "link/secret.txt"}],
    [{"text": "ok", "source": "doi"}, {"path": "/etc/passwd"}],
])
def test_submission_evidence_outside_the_configured_directories_is_refused(workspace, evidence):
    assert refused(workspace, "science_submit", {"summary": "s", "evidence": evidence}) is not None


def test_submission_evidence_inside_the_workspace_and_text_evidence_pass(workspace, workspace_dir):
    arguments = {"summary": "mentions /etc/passwd and ../x in prose",
                 "evidence": [{"path": "notes.txt"}, {"file": str(workspace_dir / "notes.txt")},
                              {"text": "a finding", "source": "/not/a/path/just/a/label"}]}
    assert refused(workspace, "science_submit", arguments) is None


def test_other_core_calls_carry_no_paths_to_check(workspace):
    assert refused(workspace, "science_plan", {"plan": {"objective": "/etc/passwd"}}) is None


@pytest.mark.parametrize("value", [
    "/etc/passwd", "~/secret.txt", "../outside.txt", "sub/../../outside.txt",
    ".bioharness/requests/r.json", "new/.bioharness/x",  # Core state, existing or not
    "link/secret.txt", "link",                           # reaches outside through a link
])
def test_a_module_tool_argument_that_is_a_path_outside_is_refused(workspace, value):
    assert refused(workspace, "any_module_tool", {"options": {"inputs": ["notes.txt", value]}}) == value


@pytest.mark.parametrize("value", [
    "notes.txt", "sub", "sub/new-output.tsv", "results/not-yet-there.tsv",
    "arabidopsis count table normalisation", "TP53 / BRCA1 interaction", "https://doi.org/10.1/x",
    "two lines\n/etc/passwd is only mentioned", "x" * 2000, "", "3.14",
])
def test_ordinary_arguments_of_a_module_tool_pass(workspace, value):
    assert refused(workspace, "any_module_tool", {"query": value, "limit": 5, "flag": True}) is None
