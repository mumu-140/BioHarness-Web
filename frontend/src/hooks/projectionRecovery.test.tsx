import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { SWRConfig } from "swr";
import { afterEach, expect, it, vi } from "vitest";
import { FakeEventSource, stubFetch } from "../test/fixtures";
import { invocationsUrl } from "../api/client";
import useConversationEvents, { type ConversationLog } from "./useConversationEvents";
import useInvocations from "./useInvocations";

afterEach(() => vi.unstubAllGlobals());

function wrapper({ children }: { children: ReactNode }) {
  return <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>;
}
const base = "/api/workspaces/pilot/conversations/conv-1/invocations?limit=50";
const log: ConversationLog = { events: [], draft: "", connected: true, connectSeq: 1 };
function page(top: number, bottom: number, next: number | null) {
  return { service: "test", workspace: "pilot", conversation_id: "conv-1", request_id: "sci-1",
    authority: "web-observation", note: "not scientific validation", next_before: next,
    items: Array.from({ length: top - bottom + 1 }, (_, i) => ({
      cursor: top - i, id: "op-" + (top - i), run_id: "run-1", kind: "tool", name: "lookup",
      state: "SUCCEEDED", started_at: "", ended_at: "", server: "fixture", input: {}, output: {},
      error: null, note: null, initiator: "model", details: {},
    })) };
}

it("restarts pagination at the new first-page boundary so live calls cannot leave a gap", async () => {
  let first = page(100, 51, 51);
  stubFetch({
    [base]: () => ({ body: first }),
    [invocationsUrl("pilot", "conv-1", { limit: 50, before: 51 })]: { body: page(50, 1, null) },
    [invocationsUrl("pilot", "conv-1", { limit: 50, before: 61 })]: { body: page(60, 11, 11) },
    [invocationsUrl("pilot", "conv-1", { limit: 50, before: 11 })]: { body: page(10, 1, null) },
  });
  const { result } = renderHook(() => useInvocations("pilot", "conv-1", true, log), { wrapper });
  await waitFor(() => expect(result.current.items).toHaveLength(50));
  await act(() => result.current.loadMore());
  expect(result.current.items).toHaveLength(100);
  first = page(110, 61, 61);
  await act(() => result.current.refresh());
  await waitFor(() => expect(result.current.nextBefore).toBe(61));
  await act(() => result.current.loadMore());
  await act(() => result.current.loadMore());
  expect(result.current.items.map(i => i.cursor)).toEqual(Array.from({ length: 110 }, (_, i) => 110 - i));
});

it("ignores an older-page reply that completes after its first-page boundary changed", async () => {
  let first = page(100, 51, 51);
  let release!: (value: Response) => void;
  vi.stubGlobal("fetch", vi.fn((url: string) => url.includes("before=51")
    ? new Promise<Response>(resolve => { release = resolve; })
    : Promise.resolve(new Response(JSON.stringify(first)))));
  const { result } = renderHook(() => useInvocations("pilot", "conv-1", true, log), { wrapper });
  await waitFor(() => expect(result.current.items).toHaveLength(50));
  let pending!: Promise<void>;
  act(() => { pending = result.current.loadMore(); });
  first = page(110, 61, 61);
  await act(() => result.current.refresh());
  await act(async () => { release(new Response(JSON.stringify(page(50, 1, null)))); await pending; });
  expect(result.current.nextBefore).toBe(61);
  expect(result.current.items.map(i => i.cursor)).toEqual(Array.from({ length: 50 }, (_, i) => 110 - i));
});

it("clears a replaced SSE log on stream.reset but still ignores ordinary replay duplicates", () => {
  const factory = (url: string) => new FakeEventSource(url);
  const { result } = renderHook(() => useConversationEvents("pilot", "conv-1", factory));
  const source = FakeEventSource.latest();
  const event = (seq: number | null, text: string) => ({
    seq, conversation_id: "conv-1", run_id: "run-1",
    type: seq === null ? "assistant.delta" : "assistant.text", data: { text }, at: "",
  });
  act(() => source.emit("assistant.text", event(20, "old log")));
  act(() => source.emit("assistant.text", event(20, "duplicate")));
  expect(result.current.events).toHaveLength(1);
  act(() => source.emit("assistant.delta", event(null, "old draft")));
  act(() => source.emit("stream.reset", { conversation_id: "conv-1" }));
  expect(result.current.events).toEqual([]);
  expect(result.current.draft).toBe("");
  act(() => source.emit("assistant.text", event(2, "restored log")));
  expect(result.current.events.map(e => e.data.text)).toEqual(["restored log"]);
});
