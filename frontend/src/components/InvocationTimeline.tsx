import { useMemo, useState } from "react";

import type {
  ConversationEvent,
  InvocationItem,
  McpToolOutput,
  ModuleServerObservation,
} from "../api/types";
import type { InvocationsProjection } from "../hooks/useInvocations";
import type { ModulesProjection } from "../hooks/useModules";
import {
  formatDuration,
  formatTime,
  isOmittedValue,
  moduleStateLabel,
  operationKindLabel,
  operationStateLabel,
} from "../labels";
import StructuredDataView from "./StructuredDataView";

interface InvocationTimelineProps {
  conversationId: string | null;
  requestId: string | null;
  events: ConversationEvent[];
  invocations: InvocationsProjection;
  modules: ModulesProjection;
  configuredServers: string[];
  onInspectInvocation(item: InvocationItem, contextRequestId: string | null): void;
  onInspectModule(server: ModuleServerObservation): void;
}

type TraceTab = "timeline" | "modules";

function eventsToFallbackInvocations(events: ConversationEvent[]): InvocationItem[] {
  const byId = new Map<string, InvocationItem>();
  let syntheticCursor = 0;
  for (const event of events) {
    if (event.type !== "operation.started" && event.type !== "operation.finished") continue;
    const { operation_id, kind, name, initiator, state, server, input, output, error, note, ...rest } =
      event.data as Record<string, unknown>;
    const id = String(operation_id ?? "");
    if (!id) continue;
    const held = byId.get(id);
    if (event.type === "operation.started") {
      syntheticCursor += 1;
      byId.set(id, {
        cursor: event.seq ?? syntheticCursor,
        id,
        run_id: event.run_id ?? "",
        kind: String(kind ?? ""),
        name: String(name ?? ""),
        state: "STARTED",
        started_at: event.at ?? "",
        ended_at: null,
        server: typeof server === "string" ? server : null,
        input: input ?? null,
        output: null,
        error: null,
        note: null,
        initiator: typeof initiator === "string" ? initiator : null,
        details: rest,
      });
    } else if (held) {
      byId.set(id, {
        ...held,
        state: String(state ?? held.state),
        ended_at: event.at ?? held.ended_at,
        server: typeof server === "string" ? server : held.server,
        output: output !== undefined ? output : held.output,
        error: error !== undefined ? (error as InvocationItem["error"]) : held.error,
        note: typeof note === "string" ? note : held.note,
        details: { ...held.details, ...rest },
      });
    }
  }
  return [...byId.values()].sort((a, b) => b.cursor - a.cursor);
}

function summaryLine(item: InvocationItem): string | null {
  if (item.error && typeof item.error === "object" && "message" in item.error) {
    return String(item.error.message ?? "");
  }
  if (typeof item.error === "string") return item.error;
  if (typeof item.output === "object" && item.output !== null) {
    const out = item.output as McpToolOutput;
    if (typeof out.host_error === "string" && out.host_error) return out.host_error;
    if (typeof out.text === "string" && out.text) {
      return out.text.length > 110 ? out.text.slice(0, 110) + "…" : out.text;
    }
    if (typeof out.instruction === "string" && out.instruction) {
      return out.instruction.length > 110 ? out.instruction.slice(0, 110) + "…" : out.instruction;
    }
  }
  if (isOmittedValue(item.output)) {
    return `输出已省略（${item.output.characters} 字符）`;
  }
  return item.note ?? null;
}

export default function InvocationTimeline({
  conversationId,
  requestId,
  events,
  invocations,
  modules,
  configuredServers,
  onInspectInvocation,
  onInspectModule,
}: InvocationTimelineProps) {
  const [traceTab, setTraceTab] = useState<TraceTab>("timeline");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [serverFilter, setServerFilter] = useState<string>("all");
  const [newestFirst, setNewestFirst] = useState<boolean>(false);

  const fallbackItems = useMemo(() => eventsToFallbackInvocations(events), [events]);

  // Prefer the authoritative paginated /invocations projection; merge any newer SSE
  // operations not yet returned in page 1, and fall back to SSE events if /invocations
  // has not loaded yet.
  const mergedItems = useMemo(() => {
    const base = invocations.response ? invocations.items : fallbackItems;
    if (!invocations.response) return base;
    const byId = new Map(base.map((item) => [item.id, item]));
    for (const live of fallbackItems) {
      const existing = byId.get(live.id);
      if (!existing) {
        byId.set(live.id, live);
      } else if (existing.state === "STARTED" && live.state !== "STARTED") {
        byId.set(live.id, {
          ...existing,
          state: live.state,
          ended_at: live.ended_at ?? existing.ended_at,
          output: live.output ?? existing.output,
          error: live.error ?? existing.error,
          note: live.note ?? existing.note,
          details: { ...existing.details, ...live.details },
        });
      }
    }
    return [...byId.values()].sort((a, b) => b.cursor - a.cursor);
  }, [invocations.response, invocations.items, fallbackItems]);

  const contextRequestId = invocations.response?.request_id ?? requestId;

  const knownServers = useMemo(() => {
    const names = new Set<string>(configuredServers);
    for (const s of modules.response?.servers ?? []) names.add(s.server);
    for (const item of mergedItems) {
      if (item.server) names.add(item.server);
    }
    return [...names].sort();
  }, [configuredServers, modules.response, mergedItems]);

  const filteredItems = useMemo(() => {
    const list = mergedItems.filter((item) => {
      if (kindFilter !== "all" && item.kind !== kindFilter) return false;
      if (serverFilter !== "all" && item.server !== serverFilter) return false;
      return true;
    });
    return newestFirst ? list : [...list].reverse();
  }, [mergedItems, kindFilter, serverFilter, newestFirst]);

  const displayedServers: ModuleServerObservation[] = useMemo(() => {
    if (modules.response) return modules.response.servers;
    return configuredServers.map((server) => ({
      server,
      configured: true,
      state: "NOT_OBSERVED",
      run_id: null,
      observed_at: null,
    }));
  }, [modules.response, configuredServers]);

  return (
    <section className="trace" aria-label="执行轨迹">
      <header className="trace-header">
        <div>
          <h3>执行轨迹与 Module 观察</h3>
        </div>
        <div className="trace-subtabs" role="tablist" aria-label="轨迹视图">
          <button
            type="button"
            role="tab"
            aria-selected={traceTab === "timeline"}
            className={traceTab === "timeline" ? "is-active" : ""}
            onClick={() => setTraceTab("timeline")}
          >
            调用时间线 ({mergedItems.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={traceTab === "modules"}
            className={traceTab === "modules" ? "is-active" : ""}
            onClick={() => setTraceTab("modules")}
          >
            Module 状态 ({displayedServers.length})
          </button>
        </div>
      </header>

      <p className="muted trace-disclaimer">
        这里是工作台实际观察到的模型请求、Core 调用和工具调用。调用返回不代表科学结果成立。
      </p>

      {traceTab === "timeline" ? (
        <>
          <div className="trace-controls">
            <select
              aria-label="按调用类型筛选"
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value)}
            >
              <option value="all">全部类型</option>
              <option value="tool">Module 工具</option>
              <option value="core">Core</option>
              <option value="model">模型</option>
              <option value="hook">Core hook</option>
            </select>
            {knownServers.length > 0 && (
              <select
                aria-label="按服务器筛选"
                value={serverFilter}
                onChange={(e) => setServerFilter(e.target.value)}
              >
                <option value="all">全部服务器</option>
                {knownServers.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className="ghost-btn"
              onClick={() => setNewestFirst((v) => !v)}
              title="切换时间排序"
            >
              {newestFirst ? "最新在前" : "时间正序"}
            </button>
            {conversationId && (
              <button
                type="button"
                className="ghost-btn"
                disabled={invocations.refreshing}
                onClick={() => void invocations.refresh()}
              >
                {invocations.refreshing ? "刷新中…" : "刷新"}
              </button>
            )}
          </div>

          {invocations.error && (
            <p className="notice is-warning">
              调用时间线投影读取失败（{invocations.error.code}）：{invocations.error.message}
              {fallbackItems.length > 0 && " · 当前仅展示已收到的实时事件。"}
            </p>
          )}

          {invocations.loadMoreError && (
            <p className="notice is-warning">{invocations.loadMoreError}</p>
          )}

          {invocations.nextBefore !== null && (
            <div className="trace-pagination">
              <button
                type="button"
                className="ghost-btn"
                disabled={invocations.loadingMore}
                onClick={() => void invocations.loadMore()}
              >
                {invocations.loadingMore ? "加载更早记录中…" : "加载更早记录"}
              </button>
            </div>
          )}

          {invocations.loading && mergedItems.length === 0 ? (
            <p className="muted">正在读取调用时间线…</p>
          ) : filteredItems.length === 0 ? (
            <p className="muted">
              {mergedItems.length === 0 ? "尚无记录。" : "当前筛选条件下没有调用记录。"}
            </p>
          ) : (
            <ol className="trace-list">
              {filteredItems.map((item) => {
                const isMcpErr =
                  typeof item.output === "object" &&
                  item.output !== null &&
                  (item.output as McpToolOutput).is_error === true;
                const omitted =
                  isOmittedValue(item.input) ||
                  isOmittedValue(item.output) ||
                  (typeof item.output === "object" &&
                    item.output !== null &&
                    isOmittedValue((item.output as McpToolOutput).structured_content));
                const truncatedChars =
                  typeof item.output === "object" &&
                  item.output !== null &&
                  typeof (item.output as McpToolOutput).truncated_characters === "number"
                    ? ((item.output as McpToolOutput).truncated_characters ?? null)
                    : null;
                const finishReason =
                  typeof item.details?.finish_reason === "string"
                    ? item.details.finish_reason
                    : null;
                const targetRid =
                  item.kind === "core" &&
                  typeof item.input === "object" &&
                  item.input !== null &&
                  typeof (item.input as Record<string, unknown>).request_id === "string"
                    ? ((item.input as Record<string, unknown>).request_id as string)
                    : null;
                const crossRequest =
                  targetRid !== null &&
                  contextRequestId !== null &&
                  targetRid !== contextRequestId;
                const line = summaryLine(item);

                return (
                  <li key={item.id} className="trace-item">
                    <details>
                      <summary>
                        <span className="chip">{operationKindLabel(item.kind)}</span>
                        {item.server && <span className="chip is-soft">{item.server}</span>}
                        <code>{item.name}</code>
                        <span className={"trace-state is-" + item.state.toLowerCase()}>
                          {operationStateLabel(item.state)}
                        </span>
                        {isMcpErr && <span className="chip is-warn">is_error</span>}
                        {omitted && <span className="chip is-warn">已省略</span>}
                        {truncatedChars !== null && truncatedChars > 0 && (
                          <span className="chip is-warn">已截断</span>
                        )}
                        {finishReason === "length" && (
                          <span className="chip is-warn">输出截断</span>
                        )}
                        {crossRequest && (
                          <span className="chip is-soft">目标 {targetRid}</span>
                        )}
                        <span className="muted trace-meta">
                          {item.initiator === "model"
                            ? "模型提出"
                            : item.initiator === "host"
                              ? "工作台发起"
                              : "发起方未知"}
                          {" · " + formatTime(item.started_at)}
                          {item.ended_at ? " · " + formatDuration(item.started_at, item.ended_at) : ""}
                        </span>
                      </summary>
                      {line && <p className="trace-summary-line">{line}</p>}
                      <div className="trace-detail-actions">
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={() => onInspectInvocation(item, contextRequestId)}
                        >
                          在检查器中查看完整详情
                        </button>
                      </div>
                      {item.input !== null && item.input !== undefined && (
                        <div className="trace-inline-block">
                          <h4>输入</h4>
                          <StructuredDataView data={item.input} />
                        </div>
                      )}
                      {item.output !== null && item.output !== undefined && (
                        <div className="trace-inline-block">
                          <h4>输出</h4>
                          <StructuredDataView data={item.output} kind={item.kind} />
                        </div>
                      )}
                      {item.error !== null && item.error !== undefined && (
                        <div className="trace-inline-block">
                          <h4>错误</h4>
                          <StructuredDataView data={item.error} />
                        </div>
                      )}
                      {Object.keys(item.details ?? {}).length > 0 && (
                        <div className="trace-inline-block">
                          <h4>调用元数据</h4>
                          <StructuredDataView data={item.details} />
                        </div>
                      )}
                    </details>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      ) : (
        <div className="modules-list-pane">
          <div className="trace-controls">
            <span className="muted">
              {conversationId
                ? "以下为本对话最近一次发现观察，非实时连通性或科研有效性证明。"
                : "尚未开启对话：仅列出已配置服务器名称，均处于未观察状态。"}
            </span>
            {conversationId && (
              <button
                type="button"
                className="ghost-btn"
                disabled={modules.refreshing}
                onClick={() => void modules.refresh()}
              >
                {modules.refreshing ? "刷新中…" : "刷新"}
              </button>
            )}
          </div>

          {modules.error && (
            <p className="notice is-warning">
              Module 观察读取失败（{modules.error.code}）：{modules.error.message}
            </p>
          )}

          {modules.loading && !modules.response ? (
            <p className="muted">正在读取 Module 发现状态…</p>
          ) : displayedServers.length === 0 ? (
            <p className="muted">服务端未配置外部 Module MCP 工具服务器。</p>
          ) : (
            <ul className="module-cards">
              {displayedServers.map((srv) => {
                const listedCount = srv.tools?.length ?? 0;
                const offeredCount = srv.offered_tools?.length ?? 0;
                const conflictCount =
                  srv.state === "LISTED" && srv.tools && srv.offered_tools
                    ? srv.tools.filter((t) => !srv.offered_tools!.includes(t)).length
                    : 0;
                return (
                  <li key={srv.server} className="module-card">
                    <header>
                      <strong>{srv.server}</strong>
                      <span className={"chip trace-chip is-" + srv.state.toLowerCase()}>
                        {moduleStateLabel(srv.state)}
                      </span>
                      {conflictCount > 0 && (
                        <span className="chip is-warn">{conflictCount} 个名称冲突</span>
                      )}
                    </header>
                    <p className="muted">
                      {srv.observed_at
                        ? `观察时间: ${formatTime(srv.observed_at)}${srv.run_id ? " · 运行 " + srv.run_id : ""}`
                        : "尚未在本对话观察"}
                    </p>
                    {srv.state === "LISTED" && (
                      <p className="muted">
                        发现 {listedCount} 个工具 · 本轮提供 {offeredCount} 个
                      </p>
                    )}
                    {srv.state === "UNAVAILABLE" && srv.error && (
                      <p className="error-text">
                        {srv.error.code ? `${srv.error.code}: ` : ""}
                        {srv.error.message ?? "不可用"}
                      </p>
                    )}
                    <div className="module-card-actions">
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => onInspectModule(srv)}
                      >
                        在检查器中查看
                      </button>
                      {srv.state === "LISTED" && (
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={() => {
                            setServerFilter(srv.server);
                            setTraceTab("timeline");
                          }}
                        >
                          筛选此服务器调用
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
