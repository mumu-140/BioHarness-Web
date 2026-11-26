import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { NowData } from "../api/types";
import BackgroundRunIndicator from "./BackgroundRunIndicator";
import ComposerQuickBar from "./ComposerQuickBar";
import HitlBanner from "./HitlBanner";
import MarkdownMessage from "./MarkdownMessage";

afterEach(cleanup);

describe("MarkdownMessage (R2-A)", () => {
  it("renders GFM tables, fenced code blocks with copy button, KaTeX math, and safe links", () => {
    const md = [
      "显著性指标：$p < 0.05$",
      "",
      "| 样本 | 峰值数 |",
      "| --- | --- |",
      "| WT | 1240 |",
      "",
      "```python",
      "print('hello')",
      "```",
      "",
      "[官方文档](https://example.org/docs) 与 [危险链接](javascript:alert(1))",
    ].join("\n");

    const { container } = render(<MarkdownMessage text={md} />);
    expect(container.querySelector(".katex")).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("1240")).toBeTruthy();
    expect(screen.getByRole("button", { name: "复制" })).toBeTruthy();
    const safeLink = screen.getByRole("link", { name: "官方文档" });
    expect(safeLink.getAttribute("href")).toBe("https://example.org/docs");
    expect(safeLink.getAttribute("rel")).toContain("noopener");
    expect(screen.queryByRole("link", { name: "危险链接" })).toBeNull();
    expect(screen.getByText("危险链接")).toBeTruthy();
  });

  it("does not execute or render raw HTML tags", () => {
    const { container } = render(
      <MarkdownMessage text={'安全文本 <script>window.__xss=1</script> <img src=x onerror="alert(1)" />'} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("HitlBanner (R2-A)", () => {
  it("shows mainline amendment copy action, WAIT_FOR_USER, and REVISE_PLAN without auto-confirming", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    const now: NowData = {
      request_id: "R-10",
      phase: "EXECUTING",
      action: "WAIT_FOR_USER",
      mainline_amendment_pending: {
        id: "A2",
        proposed: { scope: "expand" },
        reason: "新增阴性对照组",
        note: "需要用户确认",
      },
      waiting_for_user: { question: "是否保留批次 2 的样本？" },
    };

    render(<HitlBanner now={now} />);
    expect(screen.getByText(/科研主线修订待确认（A2）/)).toBeTruthy();
    expect(screen.getByText("是否保留批次 2 的样本？")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /复制确认原文/ }));
    expect(writeText).toHaveBeenCalledWith("确认主线 A2");
  });

  it("offers explicit branching action for DELIVERED requests", async () => {
    const onBranch = vi.fn();
    const now: NowData = {
      request_id: "R-done",
      phase: "DELIVERED",
      action: "DONE",
      delivery_kind: "ANSWER",
      scope_context: { scope_id: "S-route-a" },
    };

    render(<HitlBanner now={now} onBranchFromRequest={onBranch} />);
    await userEvent.click(screen.getByRole("button", { name: /基于此路线发起新问题/ }));
    expect(onBranch).toHaveBeenCalledWith("R-done", "S-route-a");
  });
});

describe("BackgroundRunIndicator (R2-A)", () => {
  it("shows return hint when viewing another request and jumps back on click", async () => {
    const onJump = vi.fn();
    const run = { conversationId: "c-1", runId: "run-9", requestId: "R-1" };
    render(<BackgroundRunIndicator activeRun={run} currentRequestId="R-2" onJumpToRun={onJump} />);

    const btn = screen.getByRole("button", { name: /后台运行中 · R-1（点击返回）/ });
    await userEvent.click(btn);
    expect(onJump).toHaveBeenCalledWith(run);
  });
});

describe("ComposerQuickBar (R2-A)", () => {
  it("inserts allowlisted @evidence references and slash module hints", async () => {
    const onInsert = vi.fn();
    render(
      <ComposerQuickBar
        evidenceOptions={[{ id: "results/peaks.tsv", label: "results/peaks.tsv", detail: "sha256:abcd1234" }]}
        moduleToolServers={["governance", "statistics"]}
        onInsert={onInsert}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /引用证据/ }));
    await userEvent.click(screen.getByRole("button", { name: /results\/peaks\.tsv/ }));
    expect(onInsert).toHaveBeenCalledWith("@evidence(results/peaks.tsv)");

    await userEvent.click(screen.getByRole("button", { name: /快捷指令与模块/ }));
    await userEvent.click(screen.getByRole("button", { name: "/statistics" }));
    expect(onInsert).toHaveBeenCalledWith("（请结合模块 statistics 核验）");
  });

  it("honestly states when no external module tool servers are configured", async () => {
    render(<ComposerQuickBar evidenceOptions={[]} moduleToolServers={[]} onInsert={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /快捷指令与模块/ }));
    expect(screen.getByText(/当前未配置外部 Module 工具服务器/)).toBeTruthy();
  });
});
