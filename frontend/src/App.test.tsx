import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "./App";
import { FakeEventSource, META, NOW, OPEN, ROUTES, SHA, snapshot, stubFetch, TREE } from "./test/fixtures";

const VIEWS = "/api/workspaces/pilot/views";
const NOW_URL = VIEWS + "/now?request_id=sci-1";
const CONTEXT_DAP = {
  ok: true,
  scope_guidance: "Scope selection does not bind a Core request.",
  shared: {
    scope: TREE.nodes[0],
    ancestors: [],
    children: [TREE.nodes[1]],
    child_count: 1,
    requests: TREE.nodes[0].requests,
    request_count: 1,
    submission_count: 1,
  },
  shared_sha256: "ctx-sha-1",
  selected_request: {
    request_id: "sci-1",
    scope_id: "dap",
    request_status: "OPEN",
    mainline_version: 1,
    goal_source: { kind: "LOCKED_MAINLINE", request_id: "sci-1", mainline_version: 1 },
    changed_scope_goals: [],
  },
  view_semantics: "Current read-only projection.",
};

function routes(overrides: Record<string, { status?: number; body: unknown }> = {}) {
  return {
    "/api/meta": { body: META },
    [VIEWS + "/tree"]: { body: snapshot("tree", {}, TREE) },
    [VIEWS + "/tree?project_id=dap"]: { body: snapshot("tree", { project_id: "dap" }, TREE) },
    [VIEWS + "/open"]: { body: snapshot("open", {}, OPEN) },
    [NOW_URL]: { body: snapshot("now", { request_id: "sci-1" }, NOW) },
    [VIEWS + "/routes?limit=100&scope_id=dap"]: { body: snapshot("routes", { scope_id: "dap", limit: 100 }, ROUTES) },
    [VIEWS + "/routes?limit=100&scope_id=dap-branch"]: {
      body: snapshot("routes", { scope_id: "dap-branch", limit: 100 }, { ...ROUTES, scope_id: "dap-branch", attempt_count: 0, attempts: [] }),
    },
    [VIEWS + "/context?request_id=sci-1&scope_id=dap"]: {
      body: snapshot("context", { scope_id: "dap", request_id: "sci-1" }, CONTEXT_DAP),
    },
    [VIEWS + "/context?scope_id=dap"]: {
      body: snapshot("context", { scope_id: "dap" }, { ...CONTEXT_DAP, selected_request: null }),
    },
    [VIEWS + "/context?scope_id=dap-branch"]: {
      body: snapshot("context", { scope_id: "dap-branch" }, {
        ...CONTEXT_DAP,
        shared: { ...CONTEXT_DAP.shared, scope: TREE.nodes[1], ancestors: [TREE.nodes[0]], children: [] },
        selected_request: null,
      }),
    },
    ...overrides,
  };
}

function renderApp() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <App eventSourceFactory={(url) => new FakeEventSource(url)} />
    </SWRConfig>,
  );
}

async function openRequest(id: string) {
  const open = await screen.findByRole("region", { name: "开放请求" });
  await userEvent.click(await within(open).findByText(id));
}

beforeEach(() => {
  FakeEventSource.instances = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("keeps the selected request's observed operations independent of the conversation dock", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const conversations = [
      { id: "conv-a", workspace: "pilot", request_id: "sci-1", created_at: "" },
      { id: "conv-b", workspace: "pilot", request_id: "sci-2", created_at: "" },
    ];
    const observed = (id: string, request: string, name: string) => ({
      service: META.service, workspace: "pilot", conversation_id: id, request_id: request,
      authority: "runtime", note: "", next_before: null,
      items: [{ cursor: 1, id: name, run_id: "run", kind: "tool", name,
        state: "SUCCEEDED", started_at: "2026-11-26T01:00:00Z", ended_at: null,
        server: null, input: {}, output: null, error: null, note: null, initiator: "model", details: {} }],
    });
    const base = "/api/workspaces/pilot/conversations";
    const otherNow = { ...NOW, request_id: "sci-2", scope_context: { scope_id: "dap-branch", path: ["dap", "dap-branch"] } };
    const entries = routes({
      "/api/meta": { body: { ...META, runtime: { enabled: true, model: "test", module_tool_servers: [] } } },
      [base]: { body: conversations },
      [base + "/conv-a/invocations?limit=50"]: { body: observed("conv-a", "sci-1", "operation-A-only") },
      [base + "/conv-b/invocations?limit=50"]: { body: observed("conv-b", "sci-2", "operation-B-only") },
      [VIEWS + "/now?request_id=sci-2"]: { body: snapshot("now", { request_id: "sci-2" }, otherNow) },
    });
    stubFetch(entries);
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "收起对话与执行轨迹" }));
    await openRequest("sci-1");
    expect(await within(await screen.findByRole("region", { name: "双轨执行观测" })).findByText("operation-A-only")).toBeTruthy();
    await openRequest("sci-2");
    const track = await screen.findByRole("region", { name: "双轨执行观测" });
    expect(await within(track).findByText("operation-B-only")).toBeTruthy();
    expect(within(track).queryByText("operation-A-only")).toBeNull();
    expect(screen.queryByRole("button", { name: "收起对话与执行轨迹" })).toBeNull();
  });

  it("rejects an invocation response whose recorded request does not match the selected request", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    const base = "/api/workspaces/pilot/conversations";
    stubFetch(routes({
      "/api/meta": { body: { ...META, runtime: { enabled: true, model: "test", module_tool_servers: [] } } },
      [base]: { body: [{ id: "conv-a", workspace: "pilot", request_id: "sci-1", created_at: "" }] },
      [base + "/conv-a/invocations?limit=50"]: { body: {
        service: META.service, workspace: "pilot", conversation_id: "conv-a", request_id: "sci-2",
        authority: "runtime", note: "", next_before: null, items: [],
      } },
    }));
    renderApp();
    await userEvent.click(await screen.findByRole("button", { name: "收起对话与执行轨迹" }));
    await openRequest("sci-1");
    const track = await screen.findByRole("region", { name: "双轨执行观测" });
    expect(await within(track).findByText(/执行记录读取不可用/)).toBeTruthy();
    expect(within(track).queryByText(/当前请求尚无可展示/)).toBeNull();
  });

  it("asks for the access token when the service answers 401, then loads", async () => {
    const user = userEvent.setup();
    let signedIn = false;
    stubFetch({
      ...routes(),
      "/api/meta": () =>
        signedIn
          ? { body: META }
          : { status: 401, body: { detail: { code: "UNAUTHENTICATED", message: "sign in" } } },
      "/api/session": () => {
        signedIn = true;
        return { status: 204, body: null };
      },
    });
    renderApp();
    await user.type(await screen.findByLabelText("服务访问令牌"), "the-token");
    await user.click(screen.getByRole("button", { name: "进入" }));
    expect(await screen.findByRole("heading", { name: "科研工作台" })).toBeTruthy();
  });

  it("shows the research tree from Project Governance and selects no request by itself", async () => {
    const { calls } = stubFetch(routes());
    renderApp();
    const tree = await screen.findByRole("region", { name: "科研树" });
    expect(await within(tree).findByText("dap-branch")).toBeTruthy();
    expect(within(tree).getAllByText("sci-2").length).toBe(1);

    // the unscoped request is listed by Core only and never placed under a scope
    expect(within(tree).queryByText("sci-9")).toBeNull();
    const open = screen.getByRole("region", { name: "开放请求" });
    expect(await within(open).findByText("未归属研究范围")).toBeTruthy();
    expect(within(open).getByText(/需明确选择,不会自动选定/)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "科研流程" }));
    expect(screen.getByText(/请在左侧明确选择一个请求/)).toBeTruthy();
    expect(calls.some((call) => call.includes("/views/now"))).toBe(false);
  });

  it("marks goal-version differences and related links as context, not gates", async () => {
    stubFetch(routes());
    renderApp();
    expect(await screen.findByText("目标版本有差异")).toBeTruthy();
    await userEvent.click(within(screen.getByLabelText("科研树", { selector: ".graph-fallback" })).getByText("dap-branch"));
    const inspector = screen.getByRole("complementary", { name: "检查器" });
    expect(within(inspector).getByText(/dap 绑定 v0,当前 v1/)).toBeTruthy();
    expect(within(inspector).getByText(/相关链接是背景参考,不是前置条件/)).toBeTruthy();
  });

  it("renders the selected request's plan with the status Core reports", async () => {
    stubFetch(routes());
    renderApp();
    await openRequest("sci-1");

    const state = await screen.findByRole("region", { name: "Core 当前状态" });
    expect(within(state).getByText("Which motif does the factor bind?")).toBeTruthy();
    expect(within(state).getByText("Do step 'call' now.")).toBeTruthy();
    expect(within(state).getByText("步骤 1/2")).toBeTruthy();
    expect(within(state).getByText(/Report the motif/)).toBeTruthy();

    const graph = screen.getByLabelText("科研流程图");
    const steps = within(graph).getAllByRole("button");
    expect(steps.map((step) => within(step).getByRole("strong").textContent)).toEqual(["inputs", "call"]);
    expect(within(steps[0]).getByText(/已完成 · 尝试 1 · 未评审/)).toBeTruthy();
    expect(within(steps[1]).getByText("Core 当前步骤")).toBeTruthy();
    expect(within(steps[0]).queryByText("Core 当前步骤")).toBeNull();
  });

  it("shows a step's declared method and its recorded submissions, and previews by exact anchor", async () => {
    const preview =
      `/api/workspaces/pilot/evidence-preview?evidence_id=e1&request_id=sci-1&sha256=${SHA}&submission_index=1`;
    const { calls } = stubFetch(
      routes({
        [preview]: {
          body: {
            ok: true,
            selector: {},
            recorded_reference: "MATCH",
            snapshot_integrity: "MATCH",
            preview: {
              evidence_id: "e1",
              kind: "file",
              name: "inputs.tsv",
              recorded_sha256: SHA,
              recorded_bytes: 20,
              content_available: true,
              unavailable_reason: null,
              current_file_identity: "DIFFERS_FROM_RECORD",
              format: "text",
              size_bytes: 20,
              truncated: false,
              content: "sample one",
            },
          },
        },
      }),
    );
    renderApp();
    await openRequest("sci-1");
    const graph = await screen.findByLabelText("科研流程图");

    await userEvent.click(within(graph).getByText("call"));
    const inspector = screen.getByRole("complementary", { name: "检查器" });
    expect(within(inspector).getByText("macs3 callpeak")).toBeTruthy();
    expect(await within(inspector).findByText("没有记录的提交。")).toBeTruthy();

    await userEvent.click(within(graph).getByText("inputs"));
    expect(await within(inspector).findByText("Six samples confirmed.")).toBeTruthy();
    expect(within(inspector).getByText(/否:为提交方报告,未经独立验证/)).toBeTruthy();
    expect(within(inspector).getByText("$WORKSPACE/inputs.tsv")).toBeTruthy();

    await userEvent.click(within(inspector).getByRole("button", { name: "预览" }));
    expect(await within(inspector).findByText("sample one")).toBeTruthy();
    expect(within(inspector).getByText("当前文件与记录不一致")).toBeTruthy();
    expect(calls).toContain("GET " + preview);
  });

  it("says that an unscoped request has no public submission history", async () => {
    const unscoped = { ...NOW, request_id: "sci-9", scope_context: undefined };
    stubFetch(
      routes({
        [VIEWS + "/now?request_id=sci-9"]: { body: snapshot("now", { request_id: "sci-9" }, unscoped) },
      }),
    );
    renderApp();
    await openRequest("sci-9");
    await userEvent.click(within(await screen.findByLabelText("科研流程图")).getByText("inputs"));
    expect(screen.getByText(/此请求未归属研究范围/)).toBeTruthy();
    expect(screen.getByText("未归属")).toBeTruthy();
  });

  it("shows a Core refusal with its code instead of an empty view", async () => {
    stubFetch(
      routes({
        [VIEWS + "/now?request_id=sci-404"]: {
          body: snapshot("now", { request_id: "sci-404" }, null, {
            error: { origin: "core", code: "REQUEST_NOT_FOUND", message: "no such request" },
          }),
        },
      }),
    );
    renderApp();
    await userEvent.type(await screen.findByLabelText("按 request_id 打开"), "sci-404");
    await userEvent.click(screen.getByRole("button", { name: "打开" }));
    expect((await screen.findByRole("alert")).textContent).toContain("REQUEST_NOT_FOUND");
    expect(screen.queryByRole("region", { name: "Core 当前状态" })).toBeNull();
  });

  it("says when Core shortened its answer", async () => {
    stubFetch(
      routes({
        [NOW_URL]: {
          body: snapshot("now", { request_id: "sci-1" }, NOW, {
            shortened: { note: "Parts marked PREVIEW were shortened", fields: ["question"] },
          }),
        },
      }),
    );
    renderApp();
    await openRequest("sci-1");
    expect(await screen.findByText(/省略了部分内容\(question\)/)).toBeTruthy();
  });

  it("refetches only when a notification names different content", async () => {
    const { calls, routes: table } = stubFetch(routes());
    renderApp();
    await openRequest("sci-1");
    await screen.findByRole("region", { name: "Core 当前状态" });
    const source = FakeEventSource.latest();
    expect(source.url).toBe("/api/workspaces/pilot/stream?project_id=dap&request_id=sci-1");
    const count = () => calls.filter((call) => call === "GET " + NOW_URL).length;
    const before = count();
    const where = { workspace: "pilot", view: "now", selector: { request_id: "sci-1" } };

    act(() => source.emit("version", { ...where, content_sha256: "v1-now" }));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(count()).toBe(before);

    table[NOW_URL] = {
      body: snapshot("now", { request_id: "sci-1" }, { ...NOW, phase: "READY_TO_DELIVER", action: "DELIVER" }, { content_sha256: "v2-now" }),
    };
    act(() => source.emit("version", { ...where, content_sha256: "v2-now" }));
    await waitFor(() => expect(count()).toBe(before + 1));
    expect(await screen.findByText("可交付")).toBeTruthy();
  });

  it("reports a disconnected channel and an unreachable source without discarding the snapshot", async () => {
    stubFetch(routes());
    renderApp();
    await screen.findByText("目标版本有差异");
    const source = FakeEventSource.latest();
    expect(screen.getByRole("status").textContent).toContain("更新通道已断开");

    act(() => source.onopen?.(new Event("open")));
    expect(screen.getByRole("status").textContent).toContain("更新通道正常");

    act(() => source.emit("source.stale", { workspace: "pilot", view: "tree", selector: {}, code: "TOOL_TIMEOUT" }));
    expect(screen.getByRole("status").textContent).toContain("Project Governance 暂时读取失败");
    expect(screen.getAllByText("dap-branch").length).toBeGreaterThan(0);

    act(() => source.emit("version", { workspace: "pilot", view: "tree", selector: {}, content_sha256: "v1-tree" }));
    expect(screen.getByRole("status").textContent).toContain("更新通道正常");
  });

  it("offers the project list again after a project was chosen", async () => {
    const project = (id: string) => ({ ...TREE.nodes[0], scope_id: id, path: [id], requests: undefined });
    const overview = { nodes: [], projects: [project("alpha"), project("beta")], note: "Select an explicit project_id" };
    const chosen = (id: string) => ({ ...TREE, project_id: id, nodes: [{ ...TREE.nodes[0], scope_id: id, path: [id] }], related_requests: [], goal_version_changes: [] });
    const { calls } = stubFetch(
      routes({
        [VIEWS + "/tree"]: { body: snapshot("tree", {}, overview) },
        [VIEWS + "/tree?project_id=alpha"]: { body: snapshot("tree", { project_id: "alpha" }, chosen("alpha")) },
        [VIEWS + "/tree?project_id=beta"]: { body: snapshot("tree", { project_id: "beta" }, chosen("beta")) },
        [VIEWS + "/open"]: { body: snapshot("open", {}, { ...OPEN, open_requests: [] }) },
      }),
    );
    renderApp();
    expect(await screen.findByText("此工作区有多个项目,请在左侧明确选择一个。")).toBeTruthy();
    expect(calls.some((call) => call.includes("project_id="))).toBe(false); // none chosen for the user

    const select = screen.getByLabelText("科研项目");
    await userEvent.selectOptions(select, "alpha");
    const tree = screen.getByRole("region", { name: "科研树" });
    expect(await within(tree).findByText("alpha")).toBeTruthy();

    await userEvent.selectOptions(screen.getByLabelText("科研项目"), "beta");
    expect(await within(tree).findByText("beta")).toBeTruthy();
    expect(within(tree).queryByText("alpha")).toBeNull();

    await userEvent.selectOptions(screen.getByLabelText("科研项目"), "");
    expect(await screen.findByText("此工作区有多个项目,请在左侧明确选择一个。")).toBeTruthy();
  });

  it("asks to sign in again when the session ends after the page has loaded", async () => {
    const { routes: table } = stubFetch(routes());
    renderApp();
    await openRequest("sci-1");
    await screen.findByRole("region", { name: "Core 当前状态" });
    table[NOW_URL] = { status: 401, body: { detail: { code: "UNAUTHENTICATED", message: "sign in" } } };
    act(() =>
      FakeEventSource.latest().emit("version", {
        workspace: "pilot", view: "now", selector: { request_id: "sci-1" }, content_sha256: "changed",
      }),
    );
    expect(await screen.findByLabelText("服务访问令牌")).toBeTruthy();
  });

  it("reads the most recent submissions when a scope has more than one page", async () => {
    const page = (offset: number, summary: string) => ({
      ...ROUTES, attempt_count: 130, offset, attempts: [{ ...ROUTES.attempts[0], summary }],
    });
    const { calls } = stubFetch(
      routes({
        [VIEWS + "/routes?limit=100&scope_id=dap"]: { body: snapshot("routes", { scope_id: "dap", limit: 100 }, page(0, "oldest page")) },
        [VIEWS + "/routes?limit=100&offset=30&scope_id=dap"]: {
          body: snapshot("routes", { scope_id: "dap", limit: 100, offset: 30 }, page(30, "most recent page")),
        },
      }),
    );
    renderApp();
    await openRequest("sci-1");
    const graph = await screen.findByLabelText("科研流程图");
    await userEvent.click(within(graph).getByText("inputs"));
    const inspector = screen.getByRole("complementary", { name: "检查器" });
    expect(await within(inspector).findByText("most recent page")).toBeTruthy();
    expect(within(inspector).queryByText("oldest page")).toBeNull();
    expect(within(inspector).getByText(/共 130 条提交,这里只读取了最近的 1 条/)).toBeTruthy();

    await userEvent.click(within(graph).getByText("call"));
    expect(await within(inspector).findByText(/在已读取的提交中没有符合的记录;更早的提交未读取/)).toBeTruthy();
    expect(within(inspector).queryByText("没有记录的提交。")).toBeNull();
    expect(calls).toContain("GET " + VIEWS + "/routes?limit=100&offset=30&scope_id=dap");
  });

  it("says that a full open list may be incomplete and quotes Core", async () => {
    const many = Array.from({ length: 20 }, (_, index) => ({ request_id: "sci-" + (100 + index), question: "q" }));
    stubFetch(
      routes({
        [VIEWS + "/open"]: {
          body: snapshot("open", {}, { ...OPEN, open_requests: many, may_be_incomplete: true, source_message: "25 requests are open" }),
        },
      }),
    );
    renderApp();
    const open = await screen.findByRole("region", { name: "开放请求" });
    expect(await within(open).findByText(/可能还有未列出的.*25 requests are open/)).toBeTruthy();
  });

  it("keeps read-only views functional when runtime is disabled and never requests runtime routes", async () => {
    const { calls } = stubFetch(
      routes({
        "/api/meta": { body: { ...META, runtime: { enabled: false, model: null, module_tool_servers: [] } } },
      }),
    );
    renderApp();
    expect(await screen.findByText(/原生运行时未配置（当前为只读模式/)).toBeTruthy();
    await openRequest("sci-1");
    expect(await screen.findByRole("region", { name: "Core 当前状态" })).toBeTruthy();
    expect(calls.some((c) => c.includes("/conversations") || c.includes("/invocations") || c.includes("/modules"))).toBe(false);
  });

  it("displays Governance context details, collapsible panels, and navigator search filtering", async () => {
    stubFetch(routes());
    renderApp();
    await userEvent.click(within(await screen.findByLabelText("科研树", { selector: ".graph-fallback" })).getByText("dap-branch"));
    const inspector = screen.getByRole("complementary", { name: "检查器" });
    const ctxRegion = await within(inspector).findByRole("region", { name: "范围上下文" });
    expect(await within(ctxRegion).findByText("上级范围:")).toBeTruthy();
    expect(within(ctxRegion).getByRole("button", { name: "dap" })).toBeTruthy();

    // Navigator search filters scopes and open requests locally without altering authority
    const filter = screen.getByLabelText("筛选范围与请求");
    await userEvent.type(filter, "unscoped");
    const open = screen.getByRole("region", { name: "开放请求" });
    expect(within(open).getByText("sci-9")).toBeTruthy();
    expect(within(open).queryByText("sci-1")).toBeNull();

    // Panels can be collapsed and re-expanded
    await userEvent.click(screen.getByRole("button", { name: "收起导航" }));
    expect(screen.queryByRole("complementary", { name: "科研项目导航" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "展开导航" }));
    expect(screen.getByRole("complementary", { name: "科研项目导航" })).toBeTruthy();
  });

  it("surfaces Governance context refusal and Core evidence changes without claiming success", async () => {
    const changedNow = {
      ...NOW,
      must_not_stop: true,
      evidence_changed_since_submission: ["$WORKSPACE/inputs.tsv (modified after submission)"],
    };
    stubFetch(
      routes({
        [NOW_URL]: { body: snapshot("now", { request_id: "sci-1" }, changedNow) },
        [VIEWS + "/context?request_id=sci-1&scope_id=dap"]: {
          body: snapshot("context", { scope_id: "dap", request_id: "sci-1" }, null, {
            error: { origin: "project-governance", code: null, message: "request_id does not belong to selected scope" },
          }),
        },
      }),
    );
    renderApp();
    await openRequest("sci-1");
    const nowPanel = await screen.findByRole("region", { name: "Core 当前状态" });
    expect(within(nowPanel).getByText("must_not_stop")).toBeTruthy();
    expect(within(nowPanel).getByText(/inputs\.tsv \(modified after submission\)/)).toBeTruthy();
    const inspector = screen.getByRole("complementary", { name: "检查器" });
    expect(await within(inspector).findByText(/request_id does not belong to selected scope/)).toBeTruthy();
  });
});
