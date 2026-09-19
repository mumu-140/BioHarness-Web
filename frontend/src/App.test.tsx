import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import App from "./App";


const tasks = [
  {
    id: "00000000-0000-0000-0000-000000000101",
    title: "Genome-web TF reference",
    analysis_class: "tf_family_phylogeny_reference",
    status: "RUNNING",
    stage: "EXECUTION",
    updated_at: "2026-09-19T02:00:00Z",
    needs_attention: false,
  },
  {
    id: "00000000-0000-0000-0000-000000000102",
    title: "RNA-seq task",
    analysis_class: "rnaseq",
    status: "WAITING",
    stage: "DATA",
    updated_at: "2026-09-19T02:01:00Z",
    needs_attention: false,
  },
];

const graphs = {
  [tasks[0].id]: {
    task: tasks[0],
    revision: "g1",
    nodes: [
      {
        id: "execution:1",
        type: "EXECUTION",
        label: "Genome-web TF",
        status: "ACTIVE",
        detail_ref: "/detail",
      },
    ],
    edges: [],
  },
  [tasks[1].id]: {
    task: tasks[1],
    revision: "g2",
    nodes: [
      {
        id: "data",
        type: "DATA",
        label: "Resolve data",
        status: "WAITING",
        detail_ref: "/detail",
      },
    ],
    edges: [],
  },
};

const fakeApi = {
  listTasks: async () => tasks,
  getTaskGraph: async (taskId: string) => graphs[taskId as keyof typeof graphs],
  getNodeDetail: async () => null,
};


describe("App", () => {
  it("renders task list on the left and graph for selected task", async () => {
    render(<App api={fakeApi} />);
    expect((await screen.findAllByText("Genome-web TF reference")).length).toBe(2);
    expect(await screen.findByText("Genome-web TF")).toBeTruthy();
  });

  it("selecting another task replaces the graph", async () => {
    const user = userEvent.setup();
    render(<App api={fakeApi} />);
    await user.click(await screen.findByText("RNA-seq task"));
    expect(await screen.findByText("Resolve data")).toBeTruthy();
  });
});
