import pytest

from bioharness_web.settings import Settings


def test_database_url_is_required(monkeypatch):
    monkeypatch.delenv("BIOHARNESS_WEB_DATABASE_URL", raising=False)
    with pytest.raises(ValueError, match="BIOHARNESS_WEB_DATABASE_URL"):
        Settings.from_env()


def test_non_postgresql_url_is_rejected(monkeypatch):
    monkeypatch.setenv("BIOHARNESS_WEB_DATABASE_URL", "sqlite:///tmp/x.db")
    with pytest.raises(ValueError, match="PostgreSQL"):
        Settings.from_env()


def test_poll_interval_has_safe_floor(monkeypatch):
    monkeypatch.setenv(
        "BIOHARNESS_WEB_DATABASE_URL",
        "postgresql+psycopg://web@db/bioharness",
    )
    monkeypatch.setenv("BIOHARNESS_WEB_POLL_INTERVAL_SECONDS", "0")
    with pytest.raises(ValueError, match="poll interval"):
        Settings.from_env()


def test_evidence_root_mapping_must_be_complete(monkeypatch):
    monkeypatch.setenv(
        "BIOHARNESS_WEB_DATABASE_URL",
        "postgresql+psycopg://web@db/bioharness",
    )
    monkeypatch.setenv(
        "BIOHARNESS_WEB_EVIDENCE_HOST_ROOT",
        "/home/yangs/software/BioHarness-P0-Acceptance",
    )
    monkeypatch.delenv("BIOHARNESS_WEB_EVIDENCE_MOUNT_ROOT", raising=False)

    with pytest.raises(ValueError, match="EVIDENCE"):
        Settings.from_env()


def test_evidence_roots_must_be_absolute(monkeypatch):
    monkeypatch.setenv(
        "BIOHARNESS_WEB_DATABASE_URL",
        "postgresql+psycopg://web@db/bioharness",
    )
    monkeypatch.setenv("BIOHARNESS_WEB_EVIDENCE_HOST_ROOT", "relative/host")
    monkeypatch.setenv("BIOHARNESS_WEB_EVIDENCE_MOUNT_ROOT", "/evidence/root")

    with pytest.raises(ValueError, match="absolute"):
        Settings.from_env()
