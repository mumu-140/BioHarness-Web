import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import TaskSidebar from "./TaskSidebar";


describe("TaskSidebar", () => {
  it("uses Chinese navigation and status labels while keeping technical names intact", () => {
    render(
      <TaskSidebar
        tasks={[
          {
            id: "a",
            title: "Genome-web TF reference",
            analysis_class: "tf_family_phylogeny_reference",
            status: "RUNNING",
            stage: "EXECUTION",
            updated_at: "2026-09-19T02:00:00Z",
            needs_attention: false,
          },
        ]}
        selectedTaskId="a"
        onSelectTask={() => {}}
      />,
    );

    expect(screen.getByText("任务观察台")).toBeTruthy();
    expect(screen.getByLabelText("搜索任务")).toBeTruthy();
    expect(screen.getByLabelText("按状态筛选")).toBeTruthy();
    expect(screen.getAllByText("运行中").length).toBeGreaterThan(0);
    expect(screen.getByText("当前阶段：执行")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Genome-web TF reference/ })
        .getAttribute("aria-current"),
    ).toBe("true");
  });
});
