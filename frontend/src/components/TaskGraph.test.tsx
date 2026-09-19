import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import TaskGraph from "./TaskGraph";


describe("TaskGraph", () => {
  it("shows active and attention states with text, not color alone", () => {
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
              label: "Running step",
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

    expect(screen.getByText("RUNNING")).toBeTruthy();
    expect(screen.getByText("NEEDS ATTENTION")).toBeTruthy();
  });
});
