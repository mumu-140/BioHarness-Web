import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { InvocationItem } from "../api/types";
import AttentionStream, { buildAttentionItems } from "./AttentionStream";
import DualTrackPanel from "./DualTrackPanel";
import SettingsCenter from "./SettingsCenter";
import { META, NOW, OPEN, TREE } from "../test/fixtures";

describe("V3 R1 Workbench components", () => {
  it("AttentionStream aggregates pending items and navigates without mutating state", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const items = buildAttentionItems(
      {
        ...NOW,
        action: "WAIT_FOR_USER",
        mainline_amendment_pending: {
          id: "A1",
          proposed: { purpose: "Revised" },
          reason: "Scope narrowed",
          note: "Confirm via user message",
        },
      },
      TREE,
      OPEN,
      null,
    );
    expect(items.some((i) => i.kind === "amendment")).toBe(true);
    expect(items.some((i) => i.kind === "wait_for_user")).toBe(true);
    expect(items.some((i) => i.kind === "goal_change")).toBe(true);

    render(<AttentionStream items={items} onNavigate={onNavigate} />);
    await user.click(screen.getByText(/主线修订待确认/));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate.mock.calls[0][0].kind).toBe("amendment");
  });

  it("DualTrackPanel binds only explicit step_id invocations and keeps unlinked ones at Request level", () => {
    const invocations: InvocationItem[] = [
      {
        cursor: 1,
        id: "op-1",
        run_id: "run-1",
        kind: "tool",
        name: "memory_recall",
        state: "SUCCEEDED",
        started_at: "2026-11-26T00:00:00Z",
        ended_at: "2026-11-26T00:00:01Z",
        server: "bioharness-memory",
        input: { step_id: "inputs" },
        output: { ok: true },
        error: null,
        note: "Recalled 2 items",
        initiator: "model",
        details: { step_id: "inputs" },
      },
      {
        cursor: 2,
        id: "op-2",
        run_id: "run-1",
        kind: "core",
        name: "science_plan",
        state: "FAILED",
        started_at: "2026-11-26T00:00:02Z",
        ended_at: "2026-11-26T00:00:03Z",
        server: null,
        input: {},
        output: null,
        error: { code: "PLAN_INVALID", message: "bad plan" },
        note: null,
        initiator: "model",
        details: {},
      },
    ];

    render(
      <DualTrackPanel
        now={NOW}
        selectedStepId="inputs"
        invocations={invocations}
        onInspectInvocation={vi.fn()}
      />,
    );

    const panel = screen.getByRole("region", { name: "双轨执行观测" });
    expect(within(panel).getByText(/步骤 inputs 已显式关联 \(1\)/)).toBeTruthy();
    expect(within(panel).getByText(/请求层执行记录（未绑定具体步骤 · 1）/)).toBeTruthy();

    // Normal invocation keeps technical details collapsed; FAILED invocation auto-expands.
    const detailsEls = panel.querySelectorAll("details");
    expect(detailsEls.length).toBe(2);
    expect(detailsEls[0].open).toBe(false);
    expect(detailsEls[1].open).toBe(true);
  });

  it("SettingsCenter shows inline ActionStatus and marks unimplemented Memory/Compute capabilities honestly", async () => {
    const user = userEvent.setup();
    const onCompact = vi.fn();
    render(
      <SettingsCenter
        meta={META}
        compactDensity={false}
        onCompactDensityChange={onCompact}
      />,
    );

    await user.click(screen.getByRole("button", { name: "高密度" }));
    expect(onCompact).toHaveBeenCalledWith(true);
    expect(screen.getByRole("status").textContent).toContain("高密度科研视图");

    await user.click(screen.getByRole("tab", { name: "记忆" }));
    expect(screen.getByText(/DEEP 检索/)).toBeTruthy();
    expect(screen.getByText(/source_registration/)).toBeTruthy();
  });
});
