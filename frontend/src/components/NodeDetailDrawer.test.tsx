import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import NodeDetailDrawer from "./NodeDetailDrawer";


const detail = {
  node: {
    id: "execution:1",
    type: "EXECUTION" as const,
    label: "Genome-web TF",
    status: "ACTIVE" as const,
    detail_ref: "/detail",
  },
  summary: {
    current_attempt: {
      attempt_number: 2,
      state: "RUNNING",
      provider_attempt_name: "bh-test-2",
    },
    attempt_history: [
      { attempt_number: 1, state: "FAILED" },
      { attempt_number: 2, state: "RUNNING" },
    ],
  },
  events: [
    { event_type: "ExecutionStarted", sequence_no: 5 },
  ],
  evidence_refs: [],
  links: ["/api/tasks/a/events"],
};


describe("NodeDetailDrawer", () => {
  it("shows only the selected node detail and closes explicitly", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<NodeDetailDrawer detail={detail} onClose={onClose} />);

    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("Execution");
    expect(dialog.textContent).toContain("Genome-web TF");
    expect(dialog.textContent).toContain("bh-test-2");
    expect(screen.queryByText("All artifacts")).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Close details" }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
