import { vi } from "vitest";

import type { EventSourceLike } from "../hooks/useVersionStream";

export const SHA = "a".repeat(64);

export function snapshot(view: string, selector: object, data: object | null, extra: object = {}) {
  return {
    service: "test-service",
    workspace: "pilot",
    view,
    selector,
    source: {
      owner: view === "now" || view === "open" ? "core" : "project-governance",
      interface: view === "now" || view === "open" ? "science_now" : view,
    },
    observed_at: "2026-11-26T01:00:00+00:00",
    ok: data !== null,
    data,
    error: null,
    source_version: null,
    content_sha256: "v1-" + view,
    shortened: null,
    warnings: [],
    ...extra,
  };
}

export const META = {
  service: "test-service",
  workspaces: ["pilot"],
  poll_interval_seconds: 5,
  tools: {
    core: { command: "bioharness-host", found: true },
    "project-governance": { command: "bioharness-governance", found: true },
  },
};

const ref = (request_id: string, scope_id: string, request_status = "OPEN") => ({
  request_id,
  scope_id,
  revision: 3,
  request_status,
  delivery_kind: null,
});

export const TREE = {
  project_id: "dap",
  nodes: [
    {
      scope_id: "dap",
      path: ["dap"],
      parent_scope_id: null,
      objective: "Find the binding motif.",
      mainline_version: 1,
      origin: ref("sci-1", "dap"),
      request_count: 1,
      requests: [ref("sci-1", "dap")],
    },
    {
      scope_id: "dap-branch",
      path: ["dap", "dap-branch"],
      parent_scope_id: "dap",
      objective: "Test an alternative peak caller.",
      mainline_version: 0,
      origin: ref("sci-2", "dap-branch"),
      request_count: 1,
      requests: [ref("sci-2", "dap-branch")],
    },
  ],
  related_requests: [
    { source_request_id: "sci-2", target_request_id: "sci-1", type: "RELATED", target_available: true },
  ],
  shared_evidence: [],
  goal_version_changes: [
    {
      ...ref("sci-2", "dap-branch"),
      changed_scope_goals: [{ scope_id: "dap", bound_version: 0, current_version: 1 }],
    },
  ],
  review_note: "Recorded goal-version differences suggest review only.",
};

export const OPEN = {
  core_state_present: true,
  open_requests: [
    { request_id: "sci-1", question: "Q1", scope_id: "dap", project_id: "dap" },
    { request_id: "sci-2", question: "Q2", scope_id: "dap-branch", project_id: "dap" },
    { request_id: "sci-9", question: "An unscoped question" },
  ],
  may_be_incomplete: false,
  source_message: "3 requests are open; choose the task explicitly",
};

export const NOW = {
  request_id: "sci-1",
  question: "Which motif does the factor bind?",
  question_type: "ANALYZE",
  phase: "WORK",
  action: "DO_STEP",
  instruction: "Do step 'call' now.",
  call: { tool: "science_submit", arguments: {} },
  mainline: {
    version: 1,
    purpose: "Find the binding motif.",
    requirements: { R1: "Call peaks", R2: "Report the motif" },
  },
  plan: {
    question_type: "ANALYZE",
    objective: "Find the binding motif.",
    steps: [
      { id: "inputs", kind: "KNOWLEDGE", objective: "Confirm the inputs.", serves: ["R1"] },
      {
        id: "call",
        kind: "ANALYSIS",
        objective: "Call peaks.",
        serves: ["R1", "R2"],
        depends_on: ["inputs"],
        method: "macs3 callpeak",
        parameters: { q: 0.01 },
      },
    ],
  },
  progress: {
    done: 1,
    total: 2,
    steps: [
      { id: "inputs", kind: "KNOWLEDGE", status: "DONE", attempts: 1, review: "UNREVIEWED" },
      { id: "call", kind: "ANALYSIS", status: "PENDING", attempts: 0, review: "UNREVIEWED" },
    ],
  },
  step: { id: "call", kind: "ANALYSIS", objective: "Call peaks.", attempt: 1 },
  retained_historical_submissions: 0,
  scope_context: { scope_id: "dap", path: ["dap"] },
};

export const ROUTES = {
  scope_id: "dap",
  included_scope_ids: ["dap"],
  attempt_count: 1,
  offset: 0,
  attempts: [
    {
      ...ref("sci-1", "dap"),
      submission_index: 1,
      step_id: "inputs",
      plan_version: 1,
      at: "2026-11-25T10:00:00+00:00",
      submission_status: "DONE",
      summary: "Six samples confirmed.",
      method_used: "",
      parameters_used: {},
      declared_conditions: null,
      condition_gaps: [],
      execution_verified: false,
      evidence: [
        {
          request_id: "sci-1",
          submission_index: 1,
          evidence_id: "e1",
          sha256: SHA,
          source: "$WORKSPACE/inputs.tsv",
          kind: "file",
          bytes: 20,
          snapshot: true,
        },
      ],
    },
  ],
};

type Route = { status?: number; body: unknown };

/** Replaces fetch by a table of URL -> answer and records every requested URL. */
export function stubFetch(routes: Record<string, Route | (() => Route)>) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push((init?.method ?? "GET") + " " + url);
    const entry = routes[url];
    if (!entry) return new Response(JSON.stringify({ detail: { code: "NOT_STUBBED", message: url } }), { status: 500 });
    const route = typeof entry === "function" ? entry() : entry;
    const status = route.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(route.body), { status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, routes };
}

export class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  private listeners = new Map<string, ((event: MessageEvent) => void)[]>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  static latest(): FakeEventSource {
    return FakeEventSource.instances[FakeEventSource.instances.length - 1];
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string, data: object) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data: JSON.stringify(data) }));
    }
  }

  close() {
    this.closed = true;
  }
}
