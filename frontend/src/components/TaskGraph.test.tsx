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
});
