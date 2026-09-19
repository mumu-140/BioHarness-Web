from dataclasses import dataclass
import os


@dataclass(frozen=True)
class Settings:
    database_url: str
    host: str = "0.0.0.0"
    port: int = 8080
    poll_interval_seconds: float = 2.0
    app_name: str = "BioHarness Observatory"

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
        return cls(
            database_url=database_url,
            host=os.environ.get("BIOHARNESS_WEB_HOST", "0.0.0.0"),
            port=int(os.environ.get("BIOHARNESS_WEB_PORT", "8080")),
            poll_interval_seconds=poll,
        )
