import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { InvocationItem, ModuleServerObservation } from "../api/types";
import InvocationInspector from "./InvocationInspector";
import ModuleInspector from "./ModuleInspector";
import StructuredDataView from "./StructuredDataView";

describe("StructuredDataView", () => {
  it("renders MCP output with is_error, truncation, non-text warning, and Memory non-adoption honestly", () => {
    render(
      <StructuredDataView
        kind="tool"
        data={{
          is_error: true,
          truncated_characters: 512,
          non_text_content_not_shown: ["image"],
          text: "Candidate memory retrieved.",
          structured_content: {
            candidate: { id: "m1", tier: "T2" },
            use: "not recorded",
            execution_verified: false,
            evidence: [{ source: "fixture", text: "synthetic only" }],
          },
        }}
      />,
    );

    expect(screen.getByText(/Module 返回错误标记（is_error = true）/)).toBeTruthy();
    expect(screen.getByText(/另有 512 字符未显示/)).toBeTruthy();
    expect(screen.getByText(/存在未显示的非文本返回类型: image/)).toBeTruthy();
    expect(screen.getByText(/检索候选或工具返回不等于已被任务采用或产生科学收益/)).toBeTruthy();
    expect(screen.getByText(/not recorded（未记录使用）/)).toBeTruthy();
    expect(screen.getByText(/false（未经独立验证）/)).toBeTruthy();
    expect(screen.getByText("m1")).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("原始 JSON（技术详情 / 回退）")).toBeTruthy();
  });

  it("shows omitted large payload warning with head preview without reconstructing content", () => {
    render(
      <StructuredDataView
        kind="tool"
        data={{
          is_error: false,
          text: "Summary",
          structured_content: {
            omitted: true,
            characters: 200000,
            head: '{"blob":"xxxx',
          },
        }}
      />,
    );

    expect(screen.getByText(/structured_content过大已省略（共 200000 字符）/)).toBeTruthy();
    expect(screen.getByText(/完整内容未保存且未在前端重构/)).toBeTruthy();
    expect(screen.getByText('{"blob":"xxxx')).toBeTruthy();
  });

  it("renders literature records as a table and only turns http(s) URLs into links", () => {
    render(
      <StructuredDataView
        kind="tool"
        data={{
          query: "WRKY transcription factor",
          papers: [
            {
              title: "Valid Paper",
              url: "https://example.org/paper/1",
            },
            {
              title: "Unsafe Link Paper",
              url: "javascript:alert(1)",
            },
          ],
        }}
      />,
    );

    const link = screen.getByRole("link", { name: "https://example.org/paper/1" });
    expect(link.getAttribute("href")).toBe("https://example.org/paper/1");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.queryByRole("link", { name: /javascript:/ })).toBeNull();
    expect(screen.getByText("javascript:alert(1)")).toBeTruthy();
  });
});

describe("InvocationInspector", () => {
  it("flags cross-request science_now target, model truncation, and missing version/step identity", () => {
    const item: InvocationItem = {
      cursor: 10,
      id: "op-core-2",
      run_id: "run-9",
      kind: "core",
      name: "science_now",
      state: "SUCCEEDED",
      started_at: "2026-11-26T02:00:00+00:00",
      ended_at: "2026-11-26T02:00:01+00:00",
      server: null,
      input: { request_id: "sci-other" },
      output: { ok: true, request_id: "sci-other", phase: "WORK", action: "DO_STEP" },
      error: null,
      note: null,
      initiator: "model",
      details: {
        reported_model: "test-model",
        finish_reason: "length",
        usage: { input_tokens: 12, output_tokens: 40 },
      },
    };

    render(<InvocationInspector item={item} conversationRequestId="sci-1" />);
    expect(screen.getByText(/跨请求读取：此 Core 调用的输入针对请求/)).toBeTruthy();
    expect(screen.getByText(/模型响应因达到输出长度上限而截断（finish_reason = length）/)).toBeTruthy();
    expect(screen.getByText(/未知（公开运行投影未提供）/)).toBeTruthy();
    expect(screen.getByText(/未知（运行观察未绑定计划步骤）/)).toBeTruthy();
    expect(screen.getByText(/Web 运行观察（非科学裁决）/)).toBeTruthy();
  });
});

describe("ModuleInspector", () => {
  it("shows listed vs offered tools, name conflicts, and strictly server-matched invocations", async () => {
    const server: ModuleServerObservation = {
      server: "memory",
      configured: true,
      state: "LISTED",
      run_id: "run-1",
      observed_at: "2026-11-26T02:00:00+00:00",
      tools: ["recall", "science_plan"],
      offered_tools: ["recall"],
    };
    const invocations: InvocationItem[] = [
      {
        cursor: 1,
        id: "op-1",
        run_id: "run-1",
        kind: "tool",
        name: "recall",
        state: "SUCCEEDED",
        started_at: "2026-11-26T02:00:05+00:00",
        ended_at: "2026-11-26T02:00:06+00:00",
        server: "memory",
        input: { query: "dap" },
        output: { is_error: false, text: "ok" },
        error: null,
        note: null,
        initiator: "model",
        details: {},
      },
      {
        cursor: 2,
        id: "op-2",
        run_id: "run-1",
        kind: "tool",
        name: "recall",
        state: "SUCCEEDED",
        started_at: "2026-11-26T02:00:07+00:00",
        ended_at: "2026-11-26T02:00:08+00:00",
        server: "other-server",
        input: {},
        output: {},
        error: null,
        note: null,
        initiator: "model",
        details: {},
      },
    ];
    const onInspect = vi.fn();
    render(
      <ModuleInspector
        server={server}
        invocations={invocations}
        onInspectInvocation={onInspect}
      />,
    );

    expect(screen.getByText("存在 1 个工具名冲突")).toBeTruthy();
    expect(screen.getByText(/名称冲突未提供/)).toBeTruthy();
    const callsSection = screen.getByText(/本对话中该服务器的实际调用 \(1\)/).closest("section")!;
    const buttons = within(callsSection).getAllByRole("button");
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]);
    expect(onInspect).toHaveBeenCalledWith(invocations[0]);
  });
});
