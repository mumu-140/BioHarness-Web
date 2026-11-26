import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import useSWR, { SWRConfig } from "swr";

import { getJson } from "../api/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FakeEventSource, stubFetch } from "../test/fixtures";
import ConversationPanel from "./ConversationPanel";

const BASE = "/api/workspaces/pilot/conversations";

class NoResize {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const conversation = (id: string, request_id: string | null) => ({
  id, workspace: "pilot", request_id, created_at: "2026-11-26T00:00:00+00:00",
});
const idle = (id: string, request_id: string | null, extra = {}) => ({
  conversation: conversation(id, request_id), active_run: null, begin_reconcile: null,
  begin_candidates: [], open_listing: null, ...extra,
});

let seq = 0;
function emit(type: string, data: object, run_id: string | null = "run-1") {
  seq += 1;
  act(() => FakeEventSource.latest().emit(type, { seq, run_id, type, data, at: "2026-11-26T01:00:00+00:00" }));
}
function emitDelta(text: string) {
  act(() => FakeEventSource.latest().emit("assistant.delta", {
    seq: null, run_id: "run-1", type: "assistant.delta", data: { operation_id: "op-m", text },
  }));
}

function renderPanel(props: Partial<Parameters<typeof ConversationPanel>[0]> = {}) {
  const onRequestKnown = vi.fn(), onNewQuestion = vi.fn();
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ConversationPanel
        workspace="pilot" model="fake-model" requestId={null} scopeId={null} delivered={false}
        onRequestKnown={onRequestKnown} onNewQuestion={onNewQuestion}
        eventSourceFactory={(url) => new FakeEventSource(url)} {...props}
      />
    </SWRConfig>,
  );
  return { onRequestKnown, onNewQuestion };
}

beforeEach(() => {
  seq = 0;
  FakeEventSource.instances = [];
  vi.stubGlobal("ResizeObserver", NoResize);
});
afterEach(() => vi.unstubAllGlobals());

describe("ConversationPanel", () => {
  it("sends a new question verbatim with the scope the user chose, then follows the recorded events", async () => {
    const { calls, bodies } = stubFetch({
      [BASE]: { body: [] },
      ["POST " + BASE]: { status: 201, body: { conversation: conversation("conv-1", null), run_id: "run-1" } },
      [BASE + "/conv-1"]: { body: idle("conv-1", null) },
    });
    const { onRequestKnown } = renderPanel({ scopeId: "dap" });
    await userEvent.click(await screen.findByLabelText("归属到已选范围 dap"));
    await userEvent.type(screen.getByLabelText("消息"), "  Which motif does the factor bind?  ");
    await userEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(calls).toContain("POST " + BASE));
    // exactly what was typed, spaces included: the host does not edit the user's words
    expect(bodies["POST " + BASE]).toEqual({ text: "  Which motif does the factor bind?  ", scope: { id: "dap" } });

    await waitFor(() => expect(FakeEventSource.latest()?.url).toBe(BASE + "/conv-1/events"));
    emit("run.started", {});
    emit("user.message", { text: "Which motif does the factor bind?" });
    emit("operation.started", { operation_id: "op-1", kind: "core", name: "science_begin", initiator: "host" });
    emit("operation.finished", {
      operation_id: "op-1", kind: "core", name: "science_begin", state: "SUCCEEDED",
      output: { ok: true, request_id: "sci-7", scope_context: { scope_id: "dap", project_id: "dap" } },
    });
    expect(onRequestKnown).toHaveBeenCalledWith("sci-7", "dap", "dap");

    emit("operation.started", { operation_id: "op-m", kind: "model", name: "fake-model", initiator: "host" });
    emitDelta("Planning ");
    emitDelta("the work.");
    const thread = () => document.querySelector(".chat-viewport")!.textContent ?? "";
    expect(thread()).toContain("Planning the work."); // text still being written is shown as it arrives
    emit("assistant.text", { operation_id: "op-m", text: "Planning the work." });
    expect(thread().split("Planning the work.").length - 1).toBe(1); // the draft was replaced, not doubled

    emit("notice", { source: "core", text: "BioHarness Core still expects work." });
    expect(screen.getByText("Core:BioHarness Core still expects work.")).toBeTruthy();

    const trace = screen.getByRole("region", { name: "执行轨迹" });
    expect(within(trace).getByText("science_begin")).toBeTruthy();
    expect(within(trace).getByText("已返回")).toBeTruthy();
    expect(within(trace).getByText(/调用返回不代表科学结果成立/)).toBeTruthy();
  });

  it("keeps its conversation when the workspace selects the request that conversation just began", async () => {
    stubFetch({
      [BASE]: { body: [] }, // the list is not refreshed yet: it does not know the new conversation's request
      ["POST " + BASE]: { status: 201, body: { conversation: conversation("conv-1", null), run_id: "run-1" } },
      [BASE + "/conv-1"]: { body: idle("conv-1", null) },
    });
    const props = {
      workspace: "pilot", model: "m", scopeId: null, delivered: false,
      onRequestKnown: vi.fn(), onNewQuestion: vi.fn(),
      eventSourceFactory: (url: string) => new FakeEventSource(url),
    };
    const cache = new Map();
    const tree = (requestId: string | null) => (
      <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
        <ConversationPanel {...props} requestId={requestId} />
      </SWRConfig>
    );
    const view = render(tree(null));
    await userEvent.type(await screen.findByLabelText("消息"), "Q?");
    await userEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(FakeEventSource.latest()?.url).toBe(BASE + "/conv-1/events"));
    emit("user.message", { text: "Q?" });
    emit("operation.finished", {
      operation_id: "op-1", kind: "core", name: "science_begin", state: "SUCCEEDED",
      output: { ok: true, request_id: "sci-7" },
    });
    expect(props.onRequestKnown).toHaveBeenCalledWith("sci-7", null, null);
    view.rerender(tree("sci-7")); // the workspace now shows that request
    emit("assistant.text", { operation_id: "op-m", text: "Answer for the same conversation." });
    expect(screen.getByText("Answer for the same conversation.")).toBeTruthy();
    expect(screen.getByText("Q?")).toBeTruthy();
    expect(FakeEventSource.latest().closed).toBe(false);
    expect(screen.getByText(/请求 sci-7/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /开启对话/ })).toBeNull();
  });

  it("offers cancel while a run is active and reports it as requested until the run ends", async () => {
    const { calls } = stubFetch({
      [BASE]: { body: [conversation("conv-1", "sci-1")] },
      [BASE + "/conv-1"]: { body: idle("conv-1", "sci-1") },
      ["POST " + BASE + "/conv-1/runs/run-1/cancel"]: { status: 202, body: { cancel: "REQUESTED" } },
    });
    renderPanel({ requestId: "sci-1" });
    await waitFor(() => expect(FakeEventSource.latest()?.url).toBe(BASE + "/conv-1/events"));
    emit("run.started", {});
    await userEvent.click(await screen.findByRole("button", { name: "取消本次运行" }));
    await waitFor(() => expect(calls).toContain("POST " + BASE + "/conv-1/runs/run-1/cancel"));
    emit("run.cancel_requested", {});
    expect(screen.getByRole("button", { name: "已请求取消,等待确认" })).toBeTruthy();
    emit("run.finished", { state: "CANCELLED", reason: "cancelled at the user's request" });
    expect(screen.getByText(/本次运行已取消/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "发送" })).toBeTruthy();
  });

  it("ignores events it already holds when the stream replays them", async () => {
    stubFetch({
      [BASE]: { body: [conversation("conv-1", "sci-1")] },
      [BASE + "/conv-1"]: { body: idle("conv-1", "sci-1") },
    });
    renderPanel({ requestId: "sci-1" });
    await waitFor(() => expect(FakeEventSource.latest()?.url).toBe(BASE + "/conv-1/events"));
    emit("user.message", { text: "Only once" });
    seq = 0;
    emit("user.message", { text: "Only once" });
    expect(screen.getAllByText("Only once").length).toBe(1);
  });

  it("does not start anything for a selected request until the user opens a conversation for it", async () => {
    const { calls, bodies } = stubFetch({
      [BASE]: { body: [] },
      ["POST " + BASE]: { status: 201, body: { conversation: conversation("conv-9", "sci-9"), run_id: null } },
      [BASE + "/conv-9"]: { body: idle("conv-9", "sci-9") },
      ["POST " + BASE + "/conv-9/runs"]: { status: 202, body: { run_id: "run-1" } },
    });
    renderPanel({ requestId: "sci-9" });
    const open = await screen.findByRole("button", { name: "为请求 sci-9 开启对话" });
    expect(calls.filter((call) => call.startsWith("POST"))).toEqual([]);
    await userEvent.click(open);
    await waitFor(() => expect(bodies["POST " + BASE]).toEqual({ request_id: "sci-9" }));
    await userEvent.click(await screen.findByRole("button", { name: "从 Core 当前状态继续" }));
    await waitFor(() => expect(bodies["POST " + BASE + "/conv-9/runs"]).toEqual({}));
  });

  it("says a delivered request takes no further messages", async () => {
    stubFetch({ [BASE]: { body: [] } });
    renderPanel({ requestId: "sci-1", delivered: true });
    expect(await screen.findByText(/Core 报告此请求已交付/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /开启对话/ })).toBeNull();
  });

  it("asks the user to reconcile a science_begin whose outcome is unknown", async () => {
    const { bodies } = stubFetch({
      [BASE]: { body: [conversation("conv-1", null)] },
      ["POST " + BASE]: { status: 201, body: { conversation: conversation("conv-1", null), run_id: "run-1" } },
      [BASE + "/conv-1"]: {
        body: idle("conv-1", null, {
          begin_reconcile: "OUTCOME_UNKNOWN",
          begin_candidates: [{ request_id: "sci-3", question: "Q", question_match: "EXACT" }],
          open_listing: { listed: 20, may_be_incomplete: true, source_message: null },
        }),
      },
      ["PUT " + BASE + "/conv-1/request"]: { body: { conversation: conversation("conv-1", "sci-3") } },
    });
    const { onRequestKnown } = renderPanel();
    await userEvent.type(await screen.findByLabelText("消息"), "Q");
    await userEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByText(/结果未知。工作台不会重发/)).toBeTruthy();
    expect(screen.getByText(/可能存在未列出的请求/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "关联此请求" }));
    await waitFor(() => expect(bodies["PUT " + BASE + "/conv-1/request"]).toEqual({ request_id: "sci-3" }));
    expect(onRequestKnown).toHaveBeenCalledWith("sci-3", null, null);
  });

  it("shows why the service refused", async () => {
    stubFetch({
      [BASE]: { body: [conversation("conv-1", "sci-1")] },
      [BASE + "/conv-1"]: { body: idle("conv-1", "sci-1") },
      ["POST " + BASE + "/conv-1/runs"]: {
        status: 409, body: { detail: { code: "REQUEST_BUSY", message: "another conversation is working on this request" } },
      },
    });
    renderPanel({ requestId: "sci-1" });
    await waitFor(() => expect(FakeEventSource.latest()?.url).toBe(BASE + "/conv-1/events"));
    await userEvent.type(await screen.findByLabelText("消息"), "continue");
    await userEvent.click(screen.getByRole("button", { name: "发送" }));
    expect((await screen.findByRole("alert")).textContent).toContain("REQUEST_BUSY");
  });

  it("does not send when the chosen scope cannot be honoured, and forgets the choice once it was used", async () => {
    const { calls, bodies } = stubFetch({
      [BASE]: { body: [] },
      ["POST " + BASE]: { status: 201, body: { conversation: conversation("conv-1", null), run_id: "run-1" } },
      [BASE + "/conv-1"]: { body: idle("conv-1", null) },
    });
    renderPanel({ scopeId: "dap" });
    await userEvent.click(await screen.findByLabelText(/新建范围/));
    expect((await screen.findByRole("alert")).textContent).toContain("请填写新范围的 ID");
    expect((screen.getByLabelText("消息") as HTMLTextAreaElement).disabled).toBe(true); // never sent as "no scope"
    expect(calls.filter((call) => call.startsWith("POST"))).toEqual([]);

    await userEvent.type(screen.getByLabelText("新范围 ID"), "dap-branch");
    await userEvent.type(screen.getByLabelText("消息"), "Q?");
    await userEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() =>
      expect(bodies["POST " + BASE]).toEqual({ text: "Q?", scope: { id: "dap-branch", create: true, parent_id: "dap" } }),
    );
    await waitFor(() => expect(FakeEventSource.latest()?.url).toBe(BASE + "/conv-1/events"));
    emit("operation.finished", {
      operation_id: "op-1", kind: "core", name: "science_begin", state: "SUCCEEDED",
      output: { ok: true, request_id: "sci-7" },
    });
    emit("run.finished", { state: "FINISHED", reason: "the turn ended" });
    await userEvent.click(screen.getByRole("button", { name: "新问题" }));
    expect((screen.getByLabelText("不归属") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("新范围 ID") as HTMLInputElement).value).toBe("");
  });

  it("acts on every recorded event even when several arrive together", async () => {
    const { calls } = stubFetch({
      [BASE]: { body: [conversation("conv-1", null)] },
      ["POST " + BASE]: { status: 201, body: { conversation: conversation("conv-1", null), run_id: "run-1" } },
      [BASE + "/conv-1"]: { body: idle("conv-1", null) },
    });
    const { onRequestKnown } = renderPanel();
    await userEvent.type(await screen.findByLabelText("消息"), "Q?");
    await userEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(FakeEventSource.latest()?.url).toBe(BASE + "/conv-1/events"));
    const source = FakeEventSource.latest();
    const frame = (n: number, type: string, data: object) => ({ seq: n, run_id: "run-1", type, data });
    act(() => {
      // one network chunk: the begin answer is not the last event of the batch
      source.emit("operation.finished", frame(1, "operation.finished", {
        operation_id: "op-1", kind: "core", name: "science_begin", state: "SUCCEEDED",
        output: { ok: true, request_id: "sci-7" },
      }));
      source.emit("operation.started", frame(2, "operation.started", { operation_id: "op-m", kind: "model", name: "m" }));
      source.emit("notice", frame(3, "notice", { source: "host", text: "later event" }));
    });
    expect(onRequestKnown).toHaveBeenCalledWith("sci-7", null, null);
  });

  it("keeps a running conversation and its cancel control when another request is selected", async () => {
    stubFetch({
      [BASE]: { body: [conversation("conv-1", "sci-1")] },
      [BASE + "/conv-1"]: { body: idle("conv-1", "sci-1") },
    });
    const props = {
      workspace: "pilot", model: "m", scopeId: null, delivered: false,
      onRequestKnown: vi.fn(), onNewQuestion: vi.fn(),
      eventSourceFactory: (url: string) => new FakeEventSource(url),
    };
    const cache = new Map();
    const tree = (requestId: string) => (
      <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
        <ConversationPanel {...props} requestId={requestId} />
      </SWRConfig>
    );
    const view = render(tree("sci-1"));
    await waitFor(() => expect(FakeEventSource.latest()?.url).toBe(BASE + "/conv-1/events"));
    emit("run.started", {});
    emit("user.message", { text: "still running" });
    view.rerender(tree("sci-2"));
    expect(screen.getByText("still running")).toBeTruthy();
    expect(screen.getByRole("button", { name: "取消本次运行" })).toBeTruthy();
    expect(screen.getByText(/这里仍是请求 sci-1 的对话/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "新问题" }) as HTMLButtonElement).disabled).toBe(true);
    expect(FakeEventSource.latest().closed).toBe(false);
    emit("run.finished", { state: "FINISHED", reason: "the turn ended" });
    expect(await screen.findByRole("button", { name: "为请求 sci-2 开启对话" })).toBeTruthy();
  });

  it("keeps cancel reported as requested while further events of the run arrive", async () => {
    stubFetch({
      [BASE]: { body: [conversation("conv-1", "sci-1")] },
      [BASE + "/conv-1"]: { body: idle("conv-1", "sci-1") },
    });
    renderPanel({ requestId: "sci-1" });
    await waitFor(() => expect(FakeEventSource.latest()?.url).toBe(BASE + "/conv-1/events"));
    emit("run.started", {});
    emit("run.cancel_requested", {});
    emit("operation.finished", { operation_id: "op-m", kind: "model", name: "m", state: "CANCELLED" });
    expect((screen.getByRole("button", { name: "已请求取消,等待确认" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a Core refusal in the conversation and an existing request as something to attach", async () => {
    stubFetch({
      [BASE]: { body: [conversation("conv-1", null)] },
      ["POST " + BASE]: { status: 201, body: { conversation: conversation("conv-1", null), run_id: "run-1" } },
      [BASE + "/conv-1"]: {
        body: idle("conv-1", null, {
          begin_reconcile: "EXISTING_REQUEST",
          begin_candidates: [{ request_id: "sci-3", question: "Q", question_match: "EXACT" }],
        }),
      },
    });
    const { onRequestKnown } = renderPanel();
    await userEvent.type(await screen.findByLabelText("消息"), "Q");
    await userEvent.click(screen.getByRole("button", { name: "发送" }));
    await waitFor(() => expect(FakeEventSource.latest()?.url).toBe(BASE + "/conv-1/events"));
    emit("operation.finished", {
      operation_id: "op-1", kind: "core", name: "science_begin", state: "SUCCEEDED",
      output: { ok: true, request_id: "sci-3", resumed: true },
    });
    expect(onRequestKnown).not.toHaveBeenCalled(); // an existing request is not adopted
    expect(await screen.findByText(/Core 对这个问题返回了一个已存在的请求,没有新建/)).toBeTruthy();
    emit("operation.finished", {
      operation_id: "op-2", kind: "core", name: "science_plan", state: "REFUSED",
      output: { ok: false, error: { code: "PLAN_INVALID", message: "3 field problem(s) in the plan" } },
    });
    expect(screen.getByText("Core 拒绝了 science_plan:3 field problem(s) in the plan")).toBeTruthy();
  });

  it("goes back to sign-in when the session has ended", async () => {
    let signedOut = false;
    const { calls } = stubFetch({
      "/api/meta": () =>
        signedOut
          ? { status: 401, body: { detail: { code: "UNAUTHENTICATED", message: "sign in" } } }
          : { body: { service: "s" } },
      [BASE]: { body: [conversation("conv-1", "sci-1")] },
      [BASE + "/conv-1"]: { body: idle("conv-1", "sci-1") },
      ["POST " + BASE + "/conv-1/runs"]: { status: 401, body: { detail: { code: "UNAUTHENTICATED", message: "sign in" } } },
    });
    // The App decides about sign-in from /api/meta; this stands in for it.
    function Meta() {
      const meta = useSWR("/api/meta", getJson, { shouldRetryOnError: false });
      return <span>{meta.error ? "signed out" : "signed in"}</span>;
    }
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <Meta />
        <ConversationPanel
          workspace="pilot" model="m" requestId="sci-1" scopeId={null} delivered={false}
          onRequestKnown={vi.fn()} onNewQuestion={vi.fn()}
          eventSourceFactory={(url) => new FakeEventSource(url)}
        />
      </SWRConfig>,
    );
    expect(screen.getByText("signed in")).toBeTruthy();
    await waitFor(() => expect(FakeEventSource.latest()?.url).toBe(BASE + "/conv-1/events"));
    signedOut = true;
    await userEvent.type(await screen.findByLabelText("消息"), "continue");
    await userEvent.click(screen.getByRole("button", { name: "发送" }));
    expect(await screen.findByText("signed out")).toBeTruthy();
    expect(calls).toContain("GET /api/meta");
  });

  it("loads paginated invocations, reconciles in-flight items across pages, and refreshes modules on module.discovery", async () => {
    let page1Phase: "initial" | "updated" = "initial";
    let page2Phase: "started" | "finished" = "started";
    let modulesPhase: "initial" | "discovered" = "initial";

    const opOld = {
      cursor: 1,
      id: "op-old",
      run_id: "run-0",
      kind: "tool",
      name: "recall",
      state: "STARTED",
      started_at: "2026-11-26T00:00:00+00:00",
      ended_at: null,
      server: "memory",
      input: { query: "motif" },
      output: null,
      error: null,
      note: null,
      initiator: "model",
      details: {},
    };

    const { calls } = stubFetch({
      [BASE]: { body: [conversation("conv-1", "sci-1")] },
      [BASE + "/conv-1"]: { body: idle("conv-1", "sci-1") },
      [BASE + "/conv-1/invocations?limit=50"]: () => ({
        body: {
          service: "s",
          workspace: "pilot",
          conversation_id: "conv-1",
          request_id: "sci-1",
          authority: "web-observation",
          note: "Observed technical operations only.",
          items: [
            {
              cursor: 2,
              id: "op-new",
              run_id: "run-1",
              kind: "tool",
              name: "structured_error",
              state: page1Phase === "initial" ? "STARTED" : "FAILED",
              started_at: "2026-11-26T01:00:00+00:00",
              ended_at: page1Phase === "initial" ? null : "2026-11-26T01:00:02+00:00",
              server: "memory",
              input: {},
              output:
                page1Phase === "initial"
                  ? null
                  : { is_error: true, text: "tool failed", structured_content: { error: "bad input" } },
              error: null,
              note: null,
              initiator: "model",
              details: {},
            },
          ],
          next_before: 2,
        },
      }),
      [BASE + "/conv-1/invocations?before=2&limit=50"]: () => ({
        body: {
          service: "s",
          workspace: "pilot",
          conversation_id: "conv-1",
          request_id: "sci-1",
          authority: "web-observation",
          note: "Observed technical operations only.",
          items: [
            {
              ...opOld,
              state: page2Phase === "started" ? "STARTED" : "UNKNOWN",
              note: page2Phase === "started" ? null : "restarted before outcome recorded",
            },
          ],
          next_before: null,
        },
      }),
      [BASE + "/conv-1/modules"]: () => ({
        body: {
          service: "s",
          workspace: "pilot",
          conversation_id: "conv-1",
          request_id: "sci-1",
          authority: "web-observation",
          note: "Last discovery observations.",
          servers:
            modulesPhase === "initial"
              ? [
                  { server: "memory", configured: true, state: "NOT_OBSERVED", run_id: null, observed_at: null },
                  { server: "broken", configured: true, state: "NOT_OBSERVED", run_id: null, observed_at: null },
                ]
              : [
                  {
                    server: "memory",
                    configured: true,
                    state: "LISTED",
                    run_id: "run-1",
                    observed_at: "2026-11-26T01:00:00+00:00",
                    tools: ["recall", "science_plan"],
                    offered_tools: ["recall"],
                  },
                  {
                    server: "broken",
                    configured: true,
                    state: "UNAVAILABLE",
                    run_id: "run-1",
                    observed_at: "2026-11-26T01:00:00+00:00",
                    error: { code: "TOOL_UNAVAILABLE" },
                  },
                ],
        },
      }),
    });

    const onInspectInvocation = vi.fn();
    const onInspectModule = vi.fn();
    renderPanel({
      requestId: "sci-1",
      moduleToolServers: ["memory", "broken"],
      onInspectInvocation,
      onInspectModule,
    });

    await waitFor(() => expect(FakeEventSource.latest()?.url).toBe(BASE + "/conv-1/events"));
    const trace = screen.getByRole("region", { name: "执行轨迹" });
    expect(await within(trace).findByText("structured_error")).toBeTruthy();

    // Load older page via cursor pagination
    await userEvent.click(within(trace).getByRole("button", { name: "加载更早记录" }));
    expect(await within(trace).findByText("recall")).toBeTruthy();

    // Operation finish on both page 1 and page 2 reconciles STARTED items by id
    page1Phase = "updated";
    page2Phase = "finished";
    emit("operation.finished", { operation_id: "op-new", kind: "tool", name: "structured_error", state: "FAILED" });
    emit("operation.finished", { operation_id: "op-old", kind: "tool", name: "recall", state: "UNKNOWN" });

    await waitFor(() => {
      expect(within(trace).getByText("is_error")).toBeTruthy();
      expect(within(trace).getByText("结果未知")).toBeTruthy();
    });

    // Clicking inspect forwards item & context request id
    await userEvent.click(within(trace).getAllByRole("button", { name: "在检查器中查看完整详情" })[0]);
    expect(onInspectInvocation).toHaveBeenCalled();

    // Module tab shows NOT_OBSERVED first, then updates on module.discovery SSE event
    await userEvent.click(within(trace).getByRole("tab", { name: /Module 状态/ }));
    expect(within(trace).getAllByText("未观察")).toHaveLength(2);

    modulesPhase = "discovered";
    emit("module.discovery", { server: "memory", state: "LISTED", tools: ["recall", "science_plan"], offered_tools: ["recall"] });
    await waitFor(() => {
      expect(within(trace).getByText("已列出工具（上次观察）")).toBeTruthy();
      expect(within(trace).getByText("1 个名称冲突")).toBeTruthy();
      expect(within(trace).getByText("不可用")).toBeTruthy();
    });
    expect(calls).toContain("GET " + BASE + "/conv-1/modules");

    await userEvent.click(within(trace).getAllByRole("button", { name: "在检查器中查看" })[0]);
    expect(onInspectModule).toHaveBeenCalled();
  });

  it("discards partial assistant.delta draft when model fails or stream reconnects without promoting it", async () => {
    stubFetch({
      [BASE]: { body: [conversation("conv-1", "sci-1")] },
      [BASE + "/conv-1"]: { body: idle("conv-1", "sci-1") },
    });
    renderPanel({ requestId: "sci-1" });
    await waitFor(() => expect(FakeEventSource.latest()?.url).toBe(BASE + "/conv-1/events"));

    emit("run.started", {});
    emit("operation.started", { operation_id: "op-m", kind: "model", name: "m" });
    emitDelta("Incomplete draft answer");
    expect(screen.getByText("Incomplete draft answer")).toBeTruthy();

    emit("operation.finished", {
      operation_id: "op-m",
      kind: "model",
      name: "m",
      state: "FAILED",
      error: { code: "PROVIDER_ERROR", message: "upstream timeout" },
    });
    expect(screen.queryByText("Incomplete draft answer")).toBeNull();

    // Truncated response notice
    emit("operation.finished", {
      operation_id: "op-m2",
      kind: "model",
      name: "m",
      state: "SUCCEEDED",
      finish_reason: "length",
    });
    expect(screen.getByText(/finish_reason=length/)).toBeTruthy();
  });
});
