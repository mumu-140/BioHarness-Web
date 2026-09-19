import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import TaskGraph, { horizontalPosition } from "./TaskGraph";


describe("TaskGraph", () => {
  it("places long workflows along the x axis", () => {
    expect(horizontalPosition(0)).toEqual({ x: 0, y: 120 });
    expect(horizontalPosition(7)).toEqual({ x: 2100, y: 120 });
  });

  it("renders the workflow horizontally with Chinese stage and status labels", () => {
    render(
      <TaskGraph
        graph={{
          task: {
            id: "a",
            title: "Task A",
            analysis_class: "test",
            status: "RUNNING",
            stage: "EXECUTION",
            updated_at: "2026-09-19T02:00:00Z",
            needs_attention: false,
          },
          revision: "1",
          nodes: [
            {
              id: "execution:1",
              type: "EXECUTION",
              label: "bh-test-1",
              status: "ACTIVE",
              detail_ref: "/detail",
            },
            {
              id: "validation:1",
              type: "VALIDATION",
              label: "Validation",
              status: "ATTENTION",
              detail_ref: "/detail",
            },
          ],
          edges: [
            { source: "execution:1", target: "validation:1" },
          ],
        }}
        onSelectNode={() => {}}
      />,
    );

    const graph = screen.getByLabelText("任务流程图");
    expect(graph.getAttribute("data-direction")).toBe("horizontal");
    expect(screen.getByText("执行")).toBeTruthy();
    expect(screen.getByText("验证")).toBeTruthy();
    expect(screen.getByText("运行中")).toBeTruthy();
    expect(screen.getByText("需处理")).toBeTruthy();
  });

  it("shows phase grouping and execution retry / reconciliation context", () => {
    render(
      <TaskGraph
        graph={{
          task: {
            id: "a",
            title: "Task A",
            analysis_class: "test",
            status: "ATTENTION",
            stage: "EXECUTION",
            updated_at: "2026-09-19T02:00:00Z",
            needs_attention: true,
          },
          revision: "phase-1",
          nodes: [
            {
              id: "planning:1",
              type: "PLANNING",
              label: "Plan",
              status: "COMPLETED",
              detail_ref: "/detail",
            },
            {
              id: "execution:2",
              type: "EXECUTION",
              label: "Run 2",
              status: "ATTENTION",
              attempt_number: 2,
              attempt_count: 2,
              attention_reason: "reconciliation_required",
              detail_ref: "/detail",
            },
            {
              id: "validation:1",
              type: "VALIDATION",
              label: "Validation",
              status: "WAITING",
              detail_ref: "/detail",
            },
          ],
          edges: [
            { source: "planning:1", target: "execution:2" },
            { source: "execution:2", target: "validation:1" },
          ],
        }}
        onSelectNode={() => {}}
      />,
    );

    expect(screen.getByLabelText("流程分区").textContent).toContain("准备与解析");
    expect(screen.getByLabelText("流程分区").textContent).toContain("执行与收集");
    expect(screen.getByLabelText("流程分区").textContent).toContain("验证与结果");
    expect(screen.getByText("第 2 次尝试 · 共 2 次")).toBeTruthy();
    expect(screen.getByText("需要人工核验")).toBeTruthy();
  });

  it("marks the current stage and keeps attention nodes visually distinct", () => {
    render(
      <TaskGraph
        graph={{
          task: {
            id: "a",
            title: "Task A",
            analysis_class: "test",
            status: "RUNNING",
            stage: "EXECUTION",
            updated_at: "2026-09-19T02:00:00Z",
            needs_attention: true,
          },
          revision: "2",
          nodes: [
            {
              id: "planning:1",
              type: "PLANNING",
              label: "Plan",
              status: "COMPLETED",
              detail_ref: "/detail",
            },
            {
              id: "execution:1",
              type: "EXECUTION",
              label: "Run",
              status: "ACTIVE",
              detail_ref: "/detail",
            },
            {
              id: "validation:1",
              type: "VALIDATION",
              label: "Validation",
              status: "ATTENTION",
              detail_ref: "/detail",
            },
          ],
          edges: [
            { source: "planning:1", target: "execution:1" },
            { source: "execution:1", target: "validation:1" },
          ],
        }}
        onSelectNode={() => {}}
      />,
    );

    const current = screen.getByRole("button", { name: /执行工作流/ });
    const attention = screen.getByRole("button", { name: /验证分析结果/ });

    expect(current.className).toContain("node-current");
    expect(current.textContent).toContain("当前阶段");
    expect(attention.className).toContain("node-attention");
  });
});
