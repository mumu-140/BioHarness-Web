import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import NodeDetailDrawer from "./NodeDetailDrawer";


const detail = {
  node: {
    id: "execution:2",
    type: "EXECUTION" as const,
    label: "bh-test-2",
    status: "ATTENTION" as const,
    started_at: "2026-09-19T02:00:00Z",
    detail_ref: "/detail",
  },
  summary: {
    current_attempt: {
      id: "attempt-2",
      attempt_number: 2,
      state: "NEEDS_OPERATOR_RECONCILIATION",
      provider_attempt_name: "bh-test-2",
      submitted_at: "2026-09-19T02:00:00Z",
      last_reconciled_at: "2026-09-19T02:04:00Z",
    },
    attempt_history: [
      {
        id: "attempt-1",
        attempt_number: 1,
        state: "FAILED",
        provider_attempt_name: "bh-test-1",
        submitted_at: "2026-09-19T01:50:00Z",
        last_reconciled_at: "2026-09-19T01:55:00Z",
      },
      {
        id: "attempt-2",
        attempt_number: 2,
        state: "NEEDS_OPERATOR_RECONCILIATION",
        provider_attempt_name: "bh-test-2",
        submitted_at: "2026-09-19T02:00:00Z",
        last_reconciled_at: "2026-09-19T02:04:00Z",
      },
    ],
    capability_snapshot: {
      logs: true,
      trace: true,
      cancellation: "unsupported",
    },
  },
  events: [
    {
      id: "event-1",
      run_attempt_id: "attempt-1",
      event_type: "ExecutionStarted",
      sequence_no: 1,
      occurred_at: "2026-09-19T01:50:01Z",
      payload: {},
    },
    {
      id: "event-2",
      run_attempt_id: "attempt-1",
      event_type: "ExecutionExited",
      sequence_no: 2,
      occurred_at: "2026-09-19T01:54:58Z",
      payload: {},
    },
    {
      id: "event-3",
      run_attempt_id: "attempt-2",
      event_type: "ReconciliationRequired",
      sequence_no: 3,
      occurred_at: "2026-09-19T02:04:00Z",
      payload: {},
    },
  ],
  evidence_refs: [],
  links: ["/api/tasks/a/events"],
};


describe("NodeDetailDrawer", () => {
  it("defaults to a Chinese human-readable view and offers raw JSON separately", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<NodeDetailDrawer detail={detail} onClose={onClose} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("节点详情");
    expect(dialog.textContent).toContain("执行");
    expect(dialog.textContent).toContain("需处理");
    expect(dialog.textContent).toContain("当前尝试");
    expect(dialog.textContent).toContain("外部执行名称");
    expect(dialog.textContent).toContain("bh-test-2");
    expect(screen.queryByText(/provider_attempt_name/)).toBeNull();

    await user.click(screen.getByRole("tab", { name: "原始 JSON" }));
    expect(screen.getByText(/"provider_attempt_name": "bh-test-2"/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "关闭详情" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders execution attempts as a readable timeline with retry and reconciliation context", () => {
    render(<NodeDetailDrawer detail={detail} onClose={() => {}} />);

    const timeline = screen.getByLabelText("执行历史");
    expect(timeline.textContent).toContain("尝试 1");
    expect(timeline.textContent).toContain("失败");
    expect(timeline.textContent).toContain("再次尝试");
    expect(timeline.textContent).toContain("尝试 2");
    expect(timeline.textContent).toContain("当前");
    expect(timeline.textContent).toContain("需要人工核验");
    expect(timeline.textContent).toContain("执行进程退出");
  });
});
