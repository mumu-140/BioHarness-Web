import json

import pytest

from bioharness_web.settings import Settings

TOKEN = "0123456789abcdef0123"


def env(tmp_path, **extra):
    return {"BIOHARNESS_WEB_WORKSPACES": json.dumps({"pilot": str(tmp_path)}),
            "BIOHARNESS_WEB_ACCESS_TOKEN": TOKEN, **extra}


def test_defaults_bind_loopback_and_use_the_workspace_as_evidence_root(tmp_path):
    settings = Settings.from_env(env(tmp_path))
    assert settings.host == "127.0.0.1"
    workspace = settings.workspaces["pilot"]
    assert workspace.path == tmp_path.resolve()
    assert workspace.evidence_roots == (tmp_path.resolve(),)


def test_extra_evidence_roots_are_explicit(tmp_path):
    extra = tmp_path / "results"
    extra.mkdir()
    raw = json.dumps({"pilot": {"path": str(tmp_path), "evidence_roots": [str(extra)]}})
    settings = Settings.from_env(env(tmp_path, BIOHARNESS_WEB_WORKSPACES=raw))
    assert settings.workspaces["pilot"].evidence_roots == (tmp_path.resolve(), extra.resolve())


@pytest.mark.parametrize("token", ["", "short"])
def test_an_access_token_is_required(tmp_path, token):
    with pytest.raises(ValueError, match="ACCESS_TOKEN"):
        Settings.from_env(env(tmp_path, BIOHARNESS_WEB_ACCESS_TOKEN=token))


@pytest.mark.parametrize("raw", [
    "", "not json", "[]", "{}",
    '{"pilot": "relative/path"}',
    '{"pilot": "/definitely/not/an/existing/dir"}',
    '{"bad id!": "/tmp"}',
    '{"pilot": {"path": "/tmp", "unknown": 1}}',
    '{"pilot": {"path": "/tmp", "evidence_roots": "/tmp"}}',
])
def test_workspace_configuration_is_validated(tmp_path, raw):
    with pytest.raises(ValueError):
        Settings.from_env(env(tmp_path, BIOHARNESS_WEB_WORKSPACES=raw))


def test_settings_built_in_code_also_need_a_real_token(tmp_path):
    with pytest.raises(ValueError, match="ACCESS_TOKEN"):
        Settings(service_id="s", workspaces={}, access_token="")


def test_the_filesystem_root_is_not_a_workspace(tmp_path):
    with pytest.raises(ValueError, match="project directory"):
        Settings.from_env(env(tmp_path, BIOHARNESS_WEB_WORKSPACES='{"pilot": "/"}'))


def test_preview_size_has_a_floor(tmp_path):
    with pytest.raises(ValueError, match="preview"):
        Settings.from_env(env(tmp_path, BIOHARNESS_WEB_EVIDENCE_PREVIEW_MAX_BYTES="100"))


def test_poll_interval_has_a_floor(tmp_path):
    with pytest.raises(ValueError, match="poll interval"):
        Settings.from_env(env(tmp_path, BIOHARNESS_WEB_POLL_INTERVAL_SECONDS="0.2"))
