import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import { type ApiError, conversationsUrl, getJson, sendJson } from "../api/client";
import type {
  Conversation,
  ConversationEvent,
  ConversationState,
  InvocationItem,
  ModuleServerObservation,
} from "../api/types";
import useConversationEvents from "../hooks/useConversationEvents";
import useInvocations from "../hooks/useInvocations";
import useModules from "../hooks/useModules";
import type { EventSourceFactory } from "../hooks/useVersionStream";
import InvocationTimeline from "./InvocationTimeline";

interface ConversationPanelProps {
  workspace: string;
  model: string | null;
  moduleToolServers?: string[];
  /** The request selected in the workspace, if any. */
  requestId: string | null;
  /** The scope selected in the research tree, offered as the scope of a new question. */
  scopeId: string | null;
  /** Core reports the selected request as delivered. */
  delivered: boolean;
  onRequestKnown(requestId: string, scopeId: string | null, projectId: string | null): void;
  onNewQuestion(): void;
  onInspectInvocation?: (item: InvocationItem, contextRequestId: string | null) => void;
  onInspectModule?: (server: ModuleServerObservation, contextRequestId: string | null) => void;
  eventSourceFactory?: EventSourceFactory;
}

type Item = { id: string; role: "user" | "assistant" | "system"; text: string };

const STATE: Record<string, string> = {
  STARTED: "进行中",
  SUCCEEDED: "已返回",
  REFUSED: "被拒绝",
  FAILED: "失败",
  UNKNOWN: "结果未知",
  FINISHED: "已结束",
  INTERRUPTED: "已中断",
  CANCELLED: "已取消",
};
const SOURCE: Record<string, string> = { core: "Core", host: "工作台" };

// Text is shown exactly as received, as soon as it is received.
function PlainText({ text }: { text: string }) {
  return <p>{text}</p>;
}

function message(role: string) {
  return function Message() {
    return (
      <MessagePrimitive.Root className={"chat-message is-" + role}>
        <MessagePrimitive.Parts components={{ Text: PlainText }} />
      </MessagePrimitive.Root>
    );
  };
}

const MESSAGES = {
  UserMessage: message("user"),
  AssistantMessage: message("assistant"),
  SystemMessage: message("system"),
};

function toItems(events: ConversationEvent[], draft: string): Item[] {
  const items: Item[] = [];
  for (const event of events) {
    const text = typeof event.data.text === "string" ? event.data.text : "";
    if (event.type === "user.message") items.push({ id: "e" + event.seq, role: "user", text });
    else if (event.type === "assistant.text") items.push({ id: "e" + event.seq, role: "assistant", text });
    else if (event.type === "notice") {
      const source = SOURCE[String(event.data.source)] ?? String(event.data.source ?? "");
      items.push({ id: "e" + event.seq, role: "system", text: source + ":" + text });
    } else if (
      event.type === "operation.finished" &&
      event.data.kind === "core" &&
      (event.data.state === "REFUSED" || event.data.state === "UNKNOWN")
    ) {
      const error = (event.data.output as { error?: { message?: unknown } } | undefined)?.error;
      items.push({
        id: "e" + event.seq,
        role: "system",
        text:
          event.data.state === "REFUSED"
            ? `Core 拒绝了 ${String(event.data.name)}:${String(error?.message ?? "未说明原因")}`
            : `${String(event.data.name)} 没有收到 Core 的答复,结果未知;工作台没有重发。`,
      });
    } else if (
      event.type === "operation.finished" &&
      event.data.kind === "model" &&
      event.data.state === "SUCCEEDED" &&
      event.data.finish_reason === "length"
    ) {
      items.push({
        id: "e" + event.seq,
        role: "system",
        text: "模型响应因长度上限截断（finish_reason=length），未派发未完成的工具调用。",
      });
    } else if (
      event.type === "operation.finished" &&
      event.data.kind === "tool" &&
      event.data.state === "UNKNOWN"
    ) {
      items.push({
        id: "e" + event.seq,
        role: "system",
        text: `工具 ${String(event.data.name)} 未在时限内返回，结果未知；工作台未重发。`,
      });
    } else if (event.type === "run.finished" && event.data.state !== "FINISHED") {
      items.push({
        id: "e" + event.seq,
        role: "system",
        text: "本次运行" + (STATE[String(event.data.state)] ?? event.data.state) + ":" + String(event.data.reason ?? ""),
      });
    }
  }
  if (draft) items.push({ id: "draft", role: "assistant", text: draft });
  return items;
}

export default function ConversationPanel(props: ConversationPanelProps) {
  const { workspace, requestId, scopeId, delivered, onRequestKnown } = props;
  const { mutate } = useSWRConfig();
  const listUrl = conversationsUrl(workspace);
  const list = useSWR<Conversation[], ApiError>(listUrl, getJson, {
    revalidateOnFocus: false,
    onError: (err) => {
      if (err.status === 401) void mutate("/api/meta");
    },
  });
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [scopeChoice, setScopeChoice] = useState<"none" | "selected" | "new">("none");
  const [newScopeId, setNewScopeId] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  function resetScope() {
    setScopeChoice("none");
    setNewScopeId("");
  }
  useEffect(() => {
    setConversationId(null);
    setProblem(null);
    resetScope();
  }, [workspace]);
  // A choice that named the selected scope cannot outlive that selection.
  useEffect(() => {
    if (!scopeId && scopeChoice === "selected") setScopeChoice("none");
  }, [scopeId, scopeChoice]);

  const stateUrl = conversationId ? conversationsUrl(workspace, "/" + conversationId) : null;
  const state = useSWR<ConversationState, ApiError>(stateUrl, getJson, {
    revalidateOnFocus: false,
    onError: (err) => {
      if (err.status === 401) void mutate("/api/meta");
    },
  });
  const log = useConversationEvents(workspace, conversationId, props.eventSourceFactory);
  const invocations = useInvocations(workspace, conversationId, true, log);
  const modules = useModules(workspace, conversationId, true, log);

  // The request of the conversation on screen: what Core answered to its science_begin, or
  // what the service recorded for it. A conversation belongs to exactly one request.
  const begun = useMemo(() => {
    for (const event of log.events) {
      const output = event.data.output as { request_id?: unknown; resumed?: unknown } | undefined;
      if (
        event.type === "operation.finished" &&
        event.data.name === "science_begin" &&
        event.data.state === "SUCCEEDED" &&
        output?.resumed !== true &&
        typeof output?.request_id === "string"
      ) {
        return output.request_id;
      }
    }
    return null;
  }, [log.events]);
  const conversationRequest =
    begun ??
    state.data?.conversation.request_id ??
    list.data?.find((item) => item.id === conversationId)?.request_id ??
    null;

  const lastSeq = log.events.length ? (log.events[log.events.length - 1].seq as number) : 0;
  const { activeRunId, cancelRequested } = useMemo(() => {
    let active: string | null = null;
    let requested = false;
    for (const event of log.events) {
      if (event.type === "run.started") {
        active = event.run_id;
        requested = false;
      }
      if (event.type === "run.cancel_requested" && event.run_id === active) requested = true;
      if (event.type === "run.finished" && event.run_id === active) active = null;
    }
    return { activeRunId: active, cancelRequested: active !== null && requested };
  }, [log.events]);

  // When another request is selected in the workspace, show its conversation if this
  // service has one. A conversation whose run is in progress stays on screen, with its
  // cancel control, until that run has ended.
  useEffect(() => {
    if (!requestId || conversationRequest === requestId || activeRunId) return;
    const match = list.data?.find((item) => item.request_id === requestId);
    setConversationId(match ? match.id : null);
  }, [requestId, list.data, conversationRequest, activeRunId]);

  // What recorded events imply for the rest of the screen: scientific state is re-read
  // from Core (the snapshots), never taken from an event. Every event not yet looked at
  // is looked at, however many arrived together.
  const seen = useRef(0);
  useEffect(() => {
    if (lastSeq < seen.current) seen.current = 0; // another conversation's log
    const fresh = log.events.filter((event) => (event.seq as number) > seen.current);
    seen.current = lastSeq;
    let core = false;
    let run = false;
    for (const event of fresh) {
      if (event.type === "operation.finished" && event.data.kind === "core") {
        core = true;
        const output = event.data.output as
          | { request_id?: unknown; resumed?: unknown; scope_context?: Record<string, unknown> }
          | undefined;
        if (
          event.data.name === "science_begin" &&
          event.data.state === "SUCCEEDED" &&
          output?.resumed !== true &&
          typeof output?.request_id === "string"
        ) {
          const scope = output.scope_context ?? {};
          resetScope(); // the choice was used for this request
          onRequestKnown(
            output.request_id,
            typeof scope.scope_id === "string" ? scope.scope_id : null,
            typeof scope.project_id === "string" ? scope.project_id : null,
          );
        }
      }
      if (event.type === "run.finished" || event.type === "run.started") run = true;
    }
    if (core) {
      const views = `/api/workspaces/${encodeURIComponent(workspace)}/views/`;
      void mutate((key) => typeof key === "string" && key.startsWith(views));
    }
    if (run) {
      void mutate(listUrl);
      if (stateUrl) void mutate(stateUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSeq]);

  // A chosen scope that cannot be sent as chosen keeps the question from being sent at all.
  const scopeProblem =
    !conversationId && !requestId && scopeChoice === "new" && !newScopeId.trim()
      ? "请填写新范围的 ID,或改选其他归属。"
      : null;
  const reconcile = state.data?.begin_reconcile ?? null;
  const unknownBegin = reconcile !== null;
  const hasRequest = conversationRequest !== null;
  const conversationDelivered = hasRequest && conversationRequest === requestId && delivered;
  const differentRequest = conversationId !== null && conversationRequest !== requestId && requestId !== null;

  const busy = useRef(false);
  async function act<T>(work: () => Promise<T>): Promise<T | null> {
    if (busy.current) return null; // one click, one request to the service
    busy.current = true;
    setProblem(null);
    try {
      return await work();
    } catch (reason) {
      const error = reason as ApiError;
      if (error.status === 401) void mutate("/api/meta"); // the session ended: back to sign-in
      setProblem((error.code ? error.code + ":" : "") + (error.message ?? "请求失败"));
      return null;
    } finally {
      busy.current = false;
    }
  }

  async function send(text: string) {
    if (!conversationId) {
      // The scope sent is exactly the one shown as chosen; a choice that cannot be
      // honoured stops the send instead of silently becoming "no scope".
      let scope: { id: string; create?: boolean; parent_id?: string } | undefined;
      if (scopeChoice === "selected") {
        if (!scopeId) return setProblem("所选的研究范围已不在当前选择中,请重新选择归属。");
        scope = { id: scopeId };
      } else if (scopeChoice === "new") {
        const id = newScopeId.trim();
        if (!id) return setProblem("请填写新范围的 ID,或改选其他归属。");
        scope = { id, create: true, ...(scopeId ? { parent_id: scopeId } : {}) };
      }
      const created = await act(() =>
        sendJson<{ conversation: Conversation }>("POST", listUrl, { text, ...(scope ? { scope } : {}) }),
      );
      if (created) {
        setConversationId(created.conversation.id);
        void mutate(listUrl);
      }
    } else {
      await act(() => sendJson("POST", conversationsUrl(workspace, `/${conversationId}/runs`), { text }));
    }
  }

  const runtime = useExternalStoreRuntime<Item>({
    messages: useMemo(() => toItems(log.events, log.draft), [log.events, log.draft]),
    isRunning: activeRunId !== null,
    isDisabled:
      unknownBegin || scopeProblem !== null || conversationDelivered || differentRequest || (!conversationId && Boolean(requestId)),
    convertMessage: (item): ThreadMessageLike => ({
      id: item.id,
      role: item.role,
      content: [{ type: "text", text: item.text }],
    }),
    onNew: async (message: AppendMessage) => {
      await send(message.content.map((part) => (part.type === "text" ? part.text : "")).join(""));
    },
    onCancel: async () => {
      if (activeRunId && conversationId) {
        await act(() =>
          sendJson("POST", conversationsUrl(workspace, `/${conversationId}/runs/${activeRunId}/cancel`), {}),
        );
      }
    },
  });

  const lastRunState =
    state.data?.conversation.last_run_state ??
    list.data?.find((item) => item.id === conversationId)?.last_run_state ??
    null;

  return (
    <section className="conversation" aria-label="对话">
      <div className="conversation-thread">
        <header>
          <strong>对话</strong>
          <span className="muted">
            模型 {props.model ?? "未提供"} · {conversationRequest ? "请求 " + conversationRequest : "尚无请求"}
            {conversationId && !log.connected && " · 事件通道未连接"}
          </span>
          {(conversationId || requestId) && (
            <button
              type="button"
              disabled={activeRunId !== null}
              title={activeRunId ? "本次运行结束或取消后才能开始新问题" : undefined}
              onClick={() => {
                setConversationId(null);
                setProblem(null);
                resetScope();
                props.onNewQuestion();
              }}
            >
              新问题
            </button>
          )}
        </header>

        {activeRunId && requestId && conversationRequest && requestId !== conversationRequest && (
          <p className="notice">
            这里仍是请求 {conversationRequest} 的对话:它的运行还在进行。运行结束后才会切换到所选的请求 {requestId}。
          </p>
        )}

        {!activeRunId && (lastRunState === "INTERRUPTED" || lastRunState === "FAILED") && conversationId && hasRequest && !conversationDelivered && !differentRequest && (
          <p className="notice">
            上次运行状态为 {STATE[lastRunState] ?? lastRunState}。可在下方发送回复，或点击“从 Core 当前状态继续”恢复。
          </p>
        )}

        {problem && (
          <p className="notice is-warning" role="alert">
            {problem}
          </p>
        )}

        {!conversationId && requestId && (
          <div className="notice">
            {delivered ? (
              "Core 报告此请求已交付。后续问题是新的请求,请点“新问题”。"
            ) : (
              <>
                本工作台还没有此请求的对话。
                <button
                  type="button"
                  onClick={async () => {
                    const created = await act(() =>
                      sendJson<{ conversation: Conversation }>("POST", listUrl, { request_id: requestId }),
                    );
                    if (created) {
                      setConversationId(created.conversation.id);
                      void mutate(listUrl);
                    }
                  }}
                >
                  为请求 {requestId} 开启对话
                </button>
              </>
            )}
          </div>
        )}

        {unknownBegin && state.data && (
          <div className="notice is-warning" role="alert">
            <p>
              {reconcile === "EXISTING_REQUEST"
                ? "Core 对这个问题返回了一个已存在的请求,没有新建。工作台不会自行接管,请明确选择:"
                : "science_begin 已发出,但没有收到 Core 的答复,结果未知。工作台不会重发。请确认 Core 是否已创建请求,并明确选择:"}
            </p>
            <ul>
              {state.data.begin_candidates.map((item) => (
                <li key={item.request_id}>
                  <code>{item.request_id}</code>
                  {item.question_match === "EXACT" ? "(问题文本一致)" : "(Core 只列出问题开头,开头一致)"}
                  <button
                    type="button"
                    onClick={async () => {
                      const done = await act(() =>
                        sendJson("PUT", conversationsUrl(workspace, `/${conversationId}/request`), {
                          request_id: item.request_id,
                        }),
                      );
                      if (done) {
                        void mutate(stateUrl);
                        void mutate(listUrl);
                        onRequestKnown(item.request_id, item.scope_id ?? null, item.project_id ?? null);
                      }
                    }}
                  >
                    关联此请求
                  </button>
                </li>
              ))}
            </ul>
            {state.data.begin_candidates.length === 0 && <p>Core 的开放请求列表中没有问题一致的请求。</p>}
            {state.data.open_listing?.may_be_incomplete && (
              <p>Core 一次最多列出 20 个开放请求,可能存在未列出的请求。</p>
            )}
          </div>
        )}

        {!conversationId && !requestId && (
          <fieldset className="scope-choice">
            <legend>新问题归属的研究范围(由你明确选择,Core 负责校验)</legend>
            <label>
              <input type="radio" name="scope-choice" checked={scopeChoice === "none"} onChange={() => setScopeChoice("none")} />
              不归属
            </label>
            {scopeId && (
              <label>
                <input type="radio" name="scope-choice" checked={scopeChoice === "selected"} onChange={() => setScopeChoice("selected")} />
                归属到已选范围 {scopeId}
              </label>
            )}
            <label>
              <input type="radio" name="scope-choice" checked={scopeChoice === "new"} onChange={() => setScopeChoice("new")} />
              新建范围{scopeId ? "(作为 " + scopeId + " 的分支)" : "(作为新项目)"}
              <input
                aria-label="新范围 ID"
                value={newScopeId}
                disabled={scopeChoice !== "new"}
                onChange={(event) => setNewScopeId(event.target.value)}
              />
            </label>
            {scopeProblem && (
              <p className="error-text" role="alert">
                {scopeProblem}
              </p>
            )}
          </fieldset>
        )}

        <AssistantRuntimeProvider runtime={runtime}>
          <ThreadPrimitive.Root className="chat">
            <ThreadPrimitive.Viewport className="chat-viewport">
              <ThreadPrimitive.Messages components={MESSAGES} />
            </ThreadPrimitive.Viewport>
            <ComposerPrimitive.Root className="chat-composer">
              <ComposerPrimitive.Input
                aria-label="消息"
                rows={2}
                placeholder={
                  conversationDelivered
                    ? "此请求已交付;后续问题请点“新问题”"
                    : conversationId
                      ? "回复,或发送 Core 要求的确认原文"
                      : requestId
                        ? "先为此请求开启对话"
                        : "输入科研问题;原文会逐字交给 Core"
                }
              />
              {activeRunId ? (
                <ComposerPrimitive.Cancel disabled={cancelRequested}>
                  {cancelRequested ? "已请求取消,等待确认" : "取消本次运行"}
                </ComposerPrimitive.Cancel>
              ) : (
                <ComposerPrimitive.Send>发送</ComposerPrimitive.Send>
              )}
              {conversationId && hasRequest && !conversationDelivered && !differentRequest && !activeRunId && (
                <button
                  type="button"
                  onClick={() => act(() => sendJson("POST", conversationsUrl(workspace, `/${conversationId}/runs`), {}))}
                >
                  从 Core 当前状态继续
                </button>
              )}
            </ComposerPrimitive.Root>
          </ThreadPrimitive.Root>
        </AssistantRuntimeProvider>
        <p className="muted">关闭页面或断开连接不会取消运行;取消需要明确点击,并以运行的结束事件为准。</p>
      </div>
      <InvocationTimeline
        conversationId={conversationId}
        requestId={conversationRequest}
        events={log.events}
        invocations={invocations}
        modules={modules}
        configuredServers={props.moduleToolServers ?? []}
        onInspectInvocation={(item, ctxRid) => props.onInspectInvocation?.(item, ctxRid)}
        onInspectModule={(srv) => props.onInspectModule?.(srv, conversationRequest)}
      />
    </section>
  );
}
