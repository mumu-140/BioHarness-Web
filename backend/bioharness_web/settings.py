from dataclasses import dataclass
import os


@dataclass(frozen=True)
class Settings:
    database_url: str
    host: str = "0.0.0.0"
    port: int = 8080
    poll_interval_seconds: float = 2.0
    app_name: str = "BioHarness Observatory"
    evidence_host_root: str | None = None
    evidence_mount_root: str | None = None
    evidence_preview_max_bytes: int = 131072

    @classmethod
    def from_env(cls) -> "Settings":
        database_url = os.environ.get("BIOHARNESS_WEB_DATABASE_URL", "").strip()
        if not database_url:
            raise ValueError("BIOHARNESS_WEB_DATABASE_URL is required")
        if not database_url.startswith(("postgresql://", "postgresql+psycopg://")):
            raise ValueError("BioHarness Web requires PostgreSQL")
        poll = float(os.environ.get("BIOHARNESS_WEB_POLL_INTERVAL_SECONDS", "2"))
        if poll < 0.5:
            raise ValueError("poll interval must be >= 0.5 seconds")

        evidence_host_root = os.environ.get(
            "BIOHARNESS_WEB_EVIDENCE_HOST_ROOT", ""
        ).strip()
        evidence_mount_root = os.environ.get(
            "BIOHARNESS_WEB_EVIDENCE_MOUNT_ROOT", ""
        ).strip()
        if bool(evidence_host_root) != bool(evidence_mount_root):
            raise ValueError(
                "BIOHARNESS_WEB_EVIDENCE_HOST_ROOT and "
                "BIOHARNESS_WEB_EVIDENCE_MOUNT_ROOT must be configured together"
            )
        preview_max_bytes = int(
            os.environ.get("BIOHARNESS_WEB_EVIDENCE_PREVIEW_MAX_BYTES", "131072")
        )
        if preview_max_bytes < 4096:
            raise ValueError("evidence preview max bytes must be >= 4096")

        return cls(
            database_url=database_url,
            host=os.environ.get("BIOHARNESS_WEB_HOST", "0.0.0.0"),
            port=int(os.environ.get("BIOHARNESS_WEB_PORT", "8080")),
            poll_interval_seconds=poll,
            evidence_host_root=evidence_host_root or None,
            evidence_mount_root=evidence_mount_root or None,
            evidence_preview_max_bytes=preview_max_bytes,
        )
