import asyncio
import dataclasses

from bioharness_web.core import MODEL_TOOLS, CoreHost


class Recorder:
    env_passthrough = ()

    def __init__(self):
        self.calls, self.active, self.overlap = [], 0, False

    async def run_json(self, argv, stdin=None, *, timeout=None, empty_ok=False):
        self.calls.append({"argv": list(argv), "stdin": stdin, "timeout": timeout, "empty_ok": empty_ok})
        self.active += 1
        self.overlap = self.overlap or self.active > 1
        await asyncio.sleep(0.02)
        self.active -= 1
        return {"ok": True}

    async def run_text(self, argv, *, timeout=None):
        self.calls.append({"argv": list(argv)})
        return "RULES"


def host(settings):
    runner = Recorder()
    configured = dataclasses.replace(settings, core_call_timeout_seconds=1234.0, core_read_timeout_seconds=77.0)
    return CoreHost(configured, runner), runner, configured.workspaces["pilot"]


def test_the_model_is_never_offered_science_begin():
    assert "science_begin" not in MODEL_TOOLS
    assert set(MODEL_TOOLS) == {"science_now", "science_plan", "science_submit", "science_deliver"}


async def test_calls_use_fixed_argv_json_stdin_and_the_bound_for_their_kind(settings, workspace_dir):
    core, runner, workspace = host(settings)
    await core.call(workspace, "science_now", {"request_id": "r1"})
    await core.call(workspace, "science_submit", {"request_id": "r1", "summary": "x; rm -rf /"})
    assert runner.calls[0] == {"argv": ["bioharness-host", "call", f"--workspace={workspace_dir}", "science_now", "-"],
                               "stdin": {"request_id": "r1"}, "timeout": 77.0, "empty_ok": False}
    assert runner.calls[1]["argv"][3:] == ["science_submit", "-"] and runner.calls[1]["timeout"] == 1234.0
    assert runner.calls[1]["stdin"]["summary"] == "x; rm -rf /"  # data, never part of a command


async def test_hooks_are_sent_as_this_host_and_never_in_the_name_of_an_agent_product(settings, workspace_dir):
    core, runner, workspace = host(settings)
    await core.hook(workspace, "prompt", {"session_id": "web-1", "prompt": "确认主线 A1"})
    call = runner.calls[0]
    assert call["argv"] == ["bioharness-host", "hook", "prompt", f"--workspace={workspace_dir}"]
    assert not any("agent-host" in part for part in call["argv"]) and "agent_host" not in call["stdin"]
    assert call["stdin"] == {"session_id": "web-1", "prompt": "确认主线 A1"} and call["empty_ok"] is True


async def test_mutations_of_one_request_and_hooks_of_one_session_do_not_overlap(settings):
    core, runner, workspace = host(settings)
    await asyncio.gather(*(core.call(workspace, "science_submit", {"request_id": "r1"}) for _ in range(4)))
    assert runner.overlap is False
    await asyncio.gather(*(core.hook(workspace, "post-tool", {"session_id": "web-1"}) for _ in range(4)))
    assert runner.overlap is False
    # two begins have no request yet: they are serialised too, so one question is not begun twice at once
    await asyncio.gather(*(core.call(workspace, "science_begin", {"question": "q"}) for _ in range(3)))
    assert runner.overlap is False
    # different requests are independent
    await asyncio.gather(core.call(workspace, "science_submit", {"request_id": "r1"}),
                         core.call(workspace, "science_submit", {"request_id": "r2"}))
    assert runner.overlap is True


async def test_rules_are_read_once_per_workspace(settings):
    core, runner, workspace = host(settings)
    assert await core.rules(workspace) == "RULES" == await core.rules(workspace)
    assert len(runner.calls) == 1 and runner.calls[0]["argv"][1] == "rules"
