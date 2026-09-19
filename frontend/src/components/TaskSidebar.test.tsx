import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import TaskSidebar from "./TaskSidebar";


describe("TaskSidebar", () => {
  it("marks the selected task with aria-current", () => {
    render(
      <TaskSidebar
        tasks={[
          {
            id: "a",
            title: "Task A",
            analysis_class: "test",
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

    expect(screen.getByRole("button", { name: /Task A/ }).getAttribute("aria-current"))
      .toBe("true");
  });
});
