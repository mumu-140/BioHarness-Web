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
        capability_snapshot: {
          logs: true,
          trace: true,
          poll: false,
          cancellation: "unsupported",
          reconcile_after_disconnect: "limited",
        },
        observed_runtime_environment: {
          host: "fwq10ys",
        },
        observed_resource_allocation: {
          cpu_count: 8,
        },
      },
      {
        id: "attempt-2",
        attempt_number: 2,
        state: "NEEDS_OPERATOR_RECONCILIATION",
        provider_attempt_name: "bh-test-2",
        submitted_at: "2026-09-19T02:00:00Z",
        last_reconciled_at: "2026-09-19T02:04:00Z",
        capability_snapshot: {
          logs: true,
          trace: true,
          poll: true,
          cancellation: "unsupported",
          reconcile_after_disconnect: "limited",
        },
        observed_runtime_environment: {
          host: "fwq10ys",
          executor: "genome-web-local",
        },
        observed_resource_allocation: {
          cpu_count: 8,
          memory_gb: 16,
        },
        binding: {
          host: "fwq10ys",
          pid: 4242,
        },
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
      payload: {
        actor: "operator",
        process_probe: null,
        executor_evidence: {
          active: null,
          terminal_outcome: null,
          exit_code: null,
          evidence: [
            {
              role: "execution_log",
              path: "/home/yangs/software/BioHarness-P0-Acceptance/sessions/test/nextflow.log",
            },
            {
              role: "candidate_manifest",
              path: "/home/yangs/software/BioHarness-P0-Acceptance/sessions/test/manifest.json",
            },
          ],
        },
      },
    },
  ],
  evidence_refs: [],
  evidence_previews: [
    {
      id: "ev-log",
      role: "execution_log",
      name: "nextflow.log",
      source_path: "/home/yangs/software/BioHarness-P0-Acceptance/sessions/test/nextflow.log",
      preview_ref: "/api/tasks/a/evidence/ev-log",
    },
    {
      id: "ev-manifest",
      role: "candidate_manifest",
      name: "manifest.json",
      source_path: "/home/yangs/software/BioHarness-P0-Acceptance/sessions/test/manifest.json",
      preview_ref: "/api/tasks/a/evidence/ev-manifest",
    },
  ],
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

  it("expands an attempt into event, capability, reconciliation, and evidence details", async () => {
    const user = userEvent.setup();
    render(<NodeDetailDrawer detail={detail} onClose={() => {}} />);

    expect(screen.queryByText("核验依据")).toBeNull();

    await user.click(screen.getByRole("button", { name: "展开尝试 2详情" }));

    const panel = screen.getByLabelText("尝试 2详情");
    expect(panel.textContent).toContain("执行器能力");
    expect(panel.textContent).toContain("日志");
    expect(panel.textContent).toContain("跟踪记录");
    expect(panel.textContent).toContain("轮询");
    expect(panel.textContent).toContain("运行环境");
    expect(panel.textContent).toContain("资源分配");
    expect(panel.textContent).toContain("事件时间线");
    expect(panel.textContent).toContain("需要人工核验");
    expect(panel.textContent).toContain("自动探测无法确认执行终态");
    expect(panel.textContent).toContain("核验依据");
    expect(panel.textContent).toContain("进程探测");
    expect(panel.textContent).toContain("无法确认");
    expect(panel.textContent).toContain("执行日志");
    expect(panel.textContent).toContain("候选结果清单");
    expect(panel.textContent).toContain("原始 payload");
  });

  it("loads a persisted evidence file on demand without exposing a filesystem URL", async () => {
    const user = userEvent.setup();
    const loadEvidencePreview = vi.fn(async (previewRef: string) => {
      expect(previewRef).toBe("/api/tasks/a/evidence/ev-log");
      return {
        id: "ev-log",
        role: "execution_log",
        name: "nextflow.log",
        format: "text",
        size_bytes: 42,
        truncated: false,
        content: "executor > process TF_TREE completed\n",
      };
    });

    render(
      <NodeDetailDrawer
        detail={detail}
        loadEvidencePreview={loadEvidencePreview}
        onClose={() => {}}
      />,
    );

    await user.click(screen.getByRole("button", { name: "展开尝试 2详情" }));
    await user.click(screen.getByRole("button", { name: "预览执行日志" }));

    expect(loadEvidencePreview).toHaveBeenCalledTimes(1);
    const preview = await screen.findByLabelText("证据预览");
    expect(preview.textContent).toContain("执行日志");
    expect(preview.textContent).toContain("nextflow.log");
    expect(preview.textContent).toContain("executor > process TF_TREE completed");
    expect(preview.textContent).not.toContain("/home/yangs/software");
  });
});
