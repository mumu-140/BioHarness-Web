import sys
from pathlib import Path

import pytest

from bioharness_web.settings import Settings, Workspace

sys.path.insert(0, str(Path(__file__).parent / "contract"))  # synthetic_workspace

TOKEN = "test-access-token-0123456789"


@pytest.fixture
def workspace_dir(tmp_path: Path) -> Path:
    path = (tmp_path / "ws").resolve()
    for name in ("requests", "evidence", "sessions"):  # what Core itself creates
        (path / ".bioharness" / name).mkdir(parents=True)
    return path


@pytest.fixture
def settings(workspace_dir: Path) -> Settings:
    workspace = Workspace(id="pilot", path=workspace_dir, evidence_roots=(workspace_dir,))
    return Settings(service_id="test-service", workspaces={"pilot": workspace},
                    access_token=TOKEN, poll_interval_seconds=1.0)


class FakeRunner:
    """Stands in for the public CLIs: answers by (tool, view-or-call) and records argv."""

    def __init__(self, answers=None):
        self.answers = dict(answers or {})
        self.calls: list[tuple[list[str], dict | None]] = []

    async def run_json(self, argv, stdin=None):
        argv = list(argv)
        self.calls.append((argv, stdin))
        key = "now" if "science_now" in argv else next(
            a for a in argv[1:] if not a.startswith("--"))
        answer = self.answers[key]
        if isinstance(answer, Exception):
            raise answer
        return answer(argv, stdin) if callable(answer) else answer


@pytest.fixture
def fake_runner() -> FakeRunner:
    return FakeRunner()
