import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import App from "./App";
import type { ObservatoryApi } from "./api/client";
import type { NodeDetail, TaskGraphModel, TaskSummary } from "./api/types";
import type {
  EventSourceFactory,
  EventSourceLike,
} from "./hooks/useTaskStream";


const tasks: TaskSummary[] = [
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

const graphs: Record<string, TaskGraphModel> = {
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

const executionDetail: NodeDetail = {
  node: graphs[tasks[0].id].nodes[0],
  summary: {
    current_attempt: {
      attempt_number: 1,
      state: "RUNNING",
      provider_attempt_name: "bh-test-1",
    },
  },
  events: [],
  evidence_refs: [],
  links: [],
};


class FakeEventSource implements EventSourceLike {
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private listeners = new Map<string, Array<(event: MessageEvent) => void>>();

  addEventListener(
    type: string,
    listener: (event: MessageEvent) => void,
  ): void {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }

  close(): void {}

  emitOpen(): void {
    this.onopen?.(new Event("open"));
  }

  emitError(): void {
    this.onerror?.(new Event("error"));
  }

  emit(type: string, data: unknown): void {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}


function makeApi() {
  const api: ObservatoryApi = {
    listTasks: vi.fn(async () => tasks),
    getTaskGraph: vi.fn(async (taskId: string) => graphs[taskId]),
    getNodeDetail: vi.fn(async (_taskId: string, nodeId: string) =>
      nodeId === "execution:1" ? executionDetail : null,
    ),
  };
  return api;
}


describe("App", () => {
  it("renders task list on the left and graph for selected task", async () => {
    render(<App api={makeApi()} eventSourceFactory={() => new FakeEventSource()} />);
    expect((await screen.findAllByText("Genome-web TF reference")).length).toBe(2);
    expect(await screen.findByText("Genome-web TF")).toBeTruthy();
  });

  it("selecting another task replaces the graph", async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} eventSourceFactory={() => new FakeEventSource()} />);
    await user.click(await screen.findByText("RNA-seq task"));
    expect(await screen.findByText("Resolve data")).toBeTruthy();
  });

  it("opens only selected node detail and closing preserves task selection", async () => {
    const user = userEvent.setup();
    render(<App api={makeApi()} eventSourceFactory={() => new FakeEventSource()} />);

    const graphRegion = await screen.findByLabelText("Task graph");
    await user.click(
      within(graphRegion).getByRole("button", { name: /Genome-web TF/ }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("Execution");
    expect(dialog.textContent).toContain("bh-test-1");

    await user.click(
      screen.getByRole("button", { name: "Close details" }),
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByRole("button", { name: /Genome-web TF reference/ })
        .getAttribute("aria-current"),
    ).toBe("true");
  });

  it("marks data stale on stream error while keeping the graph visible", async () => {
    const stream = new FakeEventSource();
    render(<App api={makeApi()} eventSourceFactory={() => stream} />);

    expect(await screen.findByText("Genome-web TF")).toBeTruthy();
    stream.emitError();

    expect(
      await screen.findByText("Disconnected · showing last update"),
    ).toBeTruthy();
    expect(screen.getByText("Genome-web TF")).toBeTruthy();
  });



  it("refetches an open node detail after task.updated", async () => {
    const user = userEvent.setup();
    const stream = new FakeEventSource();
    const api = makeApi();
    render(<App api={api} eventSourceFactory={() => stream} />);

    const graphRegion = await screen.findByLabelText("Task graph");
    await user.click(
      within(graphRegion).getByRole("button", { name: /Genome-web TF/ }),
    );
    await screen.findByRole("dialog");
    const before = vi.mocked(api.getNodeDetail).mock.calls.length;

    stream.emit("task.updated", {
      task_id: tasks[0].id,
      revision: "g3",
    });

    await waitFor(() => {
      expect(vi.mocked(api.getNodeDetail).mock.calls.length).toBeGreaterThan(before);
    });
  });

  it("refetches selected task after task.updated invalidation", async () => {
    const stream = new FakeEventSource();
    const api = makeApi();
    render(<App api={api} eventSourceFactory={() => stream} />);

    await screen.findByText("Genome-web TF");
    const before = vi.mocked(api.getTaskGraph).mock.calls.length;

    stream.emit("task.updated", {
      task_id: tasks[0].id,
      revision: "g2",
    });

    await waitFor(() => {
      expect(vi.mocked(api.getTaskGraph).mock.calls.length).toBeGreaterThan(before);
    });
  });
});
