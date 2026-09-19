import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import NodeDetailDrawer from "./NodeDetailDrawer";


const detail = {
  node: {
    id: "execution:1",
    type: "EXECUTION" as const,
    label: "bh-test-2",
    status: "ACTIVE" as const,
    started_at: "2026-09-19T02:00:00Z",
    detail_ref: "/detail",
  },
  summary: {
    current_attempt: {
      attempt_number: 2,
      state: "RUNNING",
      provider_attempt_name: "bh-test-2",
      submitted_at: "2026-09-19T02:00:00Z",
    },
    attempt_history: [
      { attempt_number: 1, state: "FAILED" },
      { attempt_number: 2, state: "RUNNING" },
    ],
    capability_snapshot: {
      logs: true,
      trace: true,
      cancellation: "unsupported",
    },
  },
  events: [
    {
      event_type: "ExecutionStarted",
      sequence_no: 5,
      occurred_at: "2026-09-19T02:00:01Z",
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
    expect(dialog.textContent).toContain("运行中");
    expect(dialog.textContent).toContain("当前尝试");
    expect(dialog.textContent).toContain("外部执行名称");
    expect(dialog.textContent).toContain("bh-test-2");
    expect(screen.queryByText(/provider_attempt_name/)).toBeNull();

    await user.click(screen.getByRole("tab", { name: "原始 JSON" }));
    expect(screen.getByText(/"provider_attempt_name": "bh-test-2"/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "关闭详情" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
