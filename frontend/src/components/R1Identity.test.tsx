import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { afterEach, describe, expect, it, vi } from "vitest";

import ArtifactsWorkbench from "./ArtifactsWorkbench";
import EvidenceList from "./EvidenceList";
import ModuleInspector from "./ModuleInspector";
import { NOW, ROUTES, SHA, snapshot, stubFetch, TREE } from "../test/fixtures";

afterEach(() => vi.unstubAllGlobals());

const routeURL = "/api/workspaces/pilot/views/routes?limit=100&scope_id=dap";
const ref = ROUTES.attempts[0].evidence[0];

function renderArtifacts() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <ArtifactsWorkbench workspace="pilot" scopeId="dap" requestId="sci-1" now={NOW} tree={TREE} />
    </SWRConfig>,
  );
}

function preview(content: string) {
  return {
    ok: true, selector: {}, recorded_reference: "MATCH", snapshot_integrity: "MATCH",
    preview: { evidence_id: "e1", kind: "file", name: "inputs.tsv",
      recorded_sha256: SHA, recorded_bytes: 20, content_available: true,
      unavailable_reason: null, current_file_identity: "MATCH",
      format: "text", size_bytes: 20, truncated: false, content },
  };
}

describe("R1 scientific identity regression", () => {
  it("labels a module observation from another request without implying empty invocation history", () => {
    render(<ModuleInspector server={{ server: "memory", state: "LISTED", configured: true,
      run_id: "old-run", observed_at: null, tools: ["recall"], offered_tools: ["recall"] }}
      invocations={[]} callsAvailable={false} contextRequestId="old-request" onInspectInvocation={vi.fn()} />);
    expect(screen.getByText(/所属请求：old-request/)).toBeTruthy();
    expect(screen.getByText(/不能判定该服务器没有被调用/)).toBeTruthy();
    expect(screen.queryByText(/尚未观察到该服务器的工具调用/)).toBeNull();
  });
  it("filters a shared scope to the exact request; scope mode explicitly includes other requests", async () => {
    const other = { ...ROUTES.attempts[0], request_id: "sci-2",
      evidence: [{ ...ref, request_id: "sci-2", evidence_id: "other-evidence" }] };
    stubFetch({ [routeURL]: { body: snapshot("routes", {}, {
      ...ROUTES, attempt_count: 2, attempts: [...ROUTES.attempts, other],
    }) } });
    renderArtifacts();
    expect(await screen.findByRole("button", { name: /e1 file/ })).toBeTruthy();
    expect(screen.queryByText("other-evidence")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Scope 历史路线" }));
    expect(await screen.findByText("other-evidence")).toBeTruthy();
    await userEvent.click(screen.getByRole("tab", { name: /Results/ }));
    expect(await screen.findByText(/范围视图展示历史提交/)).toBeTruthy();
    expect(screen.queryByText(NOW.question)).toBeNull();
  });

  it("distinguishes a failed route read from an empty evidence list", async () => {
    stubFetch({ [routeURL]: { status: 503, body: { detail: { code: "TOOL_UNAVAILABLE", message: "down" } } } });
    renderArtifacts();
    expect(await screen.findByText(/提交历史不可用，不能判断/)).toBeTruthy();
    expect(screen.queryByText(/暂无已提交证据/)).toBeNull();
  });

  it("discloses the partial first page and permits reading a later page", async () => {
    const nextURL = "/api/workspaces/pilot/views/routes?limit=100&offset=100&scope_id=dap";
    const first = { ...ROUTES, attempt_count: 101, attempts: Array.from({ length: 100 }, (_, i) => ({
      ...ROUTES.attempts[0], request_id: "sci-other", submission_index: i + 1, evidence: [],
    })) };
    stubFetch({
      [routeURL]: { body: snapshot("routes", {}, first) },
      [nextURL]: { body: snapshot("routes", {}, { ...ROUTES, offset: 100, attempt_count: 101 }) },
    });
    renderArtifacts();
    expect(await screen.findByText(/同域共 101 条提交/)).toBeTruthy();
    expect(screen.getByText(/本页暂无已提交证据/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(await screen.findByRole("button", { name: /e1 file/ })).toBeTruthy();
    expect((screen.getByRole("button", { name: "上一页" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("drops loaded evidence on workspace change even if the anchor text is identical", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(preview("old workspace content")))));
    const { rerender } = render(<EvidenceList workspace="old" evidence={[ref]} />);
    await userEvent.click(screen.getByRole("button", { name: "预览" }));
    expect(await screen.findByText("old workspace content")).toBeTruthy();
    rerender(<EvidenceList workspace="new" evidence={[ref]} />);
    expect(screen.queryByText("old workspace content")).toBeNull();
    expect(screen.getByRole("button", { name: "预览" })).toBeTruthy();
  });

  it("ignores a late preview response from an unmounted workspace", async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((done) => { resolve = done; })));
    const { rerender } = render(<EvidenceList workspace="old" evidence={[ref]} />);
    await userEvent.click(screen.getByRole("button", { name: "预览" }));
    rerender(<EvidenceList workspace="new" evidence={[ref]} />);
    await act(async () => resolve(new Response(JSON.stringify(preview("late old content")))));
    expect(screen.queryByText("late old content")).toBeNull();
    expect(within(screen.getByRole("list")).getByRole("button", { name: "预览" })).toBeTruthy();
  });
});
