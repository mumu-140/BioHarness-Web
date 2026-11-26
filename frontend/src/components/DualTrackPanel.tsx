import { Activity, AlertCircle, CheckCircle2, ChevronRight, Clock, Layers } from "lucide-react";

import type { InvocationItem, NowData } from "../api/types";
import { formatTime } from "../labels";
import { cn } from "../lib/utils";

interface DualTrackPanelProps {
  now: NowData;
  selectedStepId: string | null;
  invocations: InvocationItem[];
  loading?: boolean;
  unavailable?: boolean;
  enabled?: boolean;
  hasMore?: boolean;
  onInspectInvocation: (item: InvocationItem, contextRequestId: string | null) => void;
}

const STATE_LABEL: Record<string, string> = {
  STARTED: "执行中",
  SUCCEEDED: "已返回",
  REFUSED: "已拒绝",
  FAILED: "失败",
  UNKNOWN: "结果未知",
  CANCELLED: "已取消",
};

/**
 * Only a host-recorded, versioned association can link an operation to a plan.
 * The current public Core now response does not expose a plan version and the
 * runtime does not yet emit that association. Do not infer it from tool input,
 * successful tool output, timestamps, or the step label alone.
 */
export function recordedStepIdOf(item: InvocationItem, now: NowData): string | null {
  const stepId = item.details?.step_id;
  const version = item.details?.plan_version;
  if (typeof now.plan_version !== "number" || typeof version !== "number" ||
      version !== now.plan_version || typeof stepId !== "string" ||
      !now.plan?.steps.some((step) => step.id === stepId)) return null;
  return stepId;
}

function isAbnormalState(state: string): boolean {
  return state === "FAILED" || state === "REFUSED" || state === "UNKNOWN";
}

function InvocationRow({
  item,
  requestId,
  onInspect,
}: {
  item: InvocationItem;
  requestId: string;
  onInspect: (item: InvocationItem, contextRequestId: string | null) => void;
}) {
  const abnormal = isAbnormalState(item.state);
  const label = STATE_LABEL[item.state] ?? item.state;
  const Icon = abnormal ? AlertCircle : item.state === "STARTED" ? Clock : CheckCircle2;

  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-xs transition-colors",
        abnormal
          ? "border-amber-300 bg-amber-50/70"
          : "border-slate-200 bg-white hover:border-slate-300",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <Icon
            className={cn(
              "h-3.5 w-3.5 shrink-0",
              abnormal
                ? "text-amber-700"
                : item.state === "STARTED"
                  ? "text-blue-600"
                  : "text-teal-700",
            )}
            aria-hidden="true"
          />
          <span className="truncate font-medium text-slate-900">
            {item.server ? `${item.server} · ${item.name}` : item.name}
          </span>
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium",
              abnormal ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700",
            )}
          >
            {label}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onInspect(item, requestId)}
          className="inline-flex shrink-0 items-center gap-0.5 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
        >
          查看详情
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>

      {item.note && <p className="mt-1 text-slate-600">{item.note}</p>}

      <details open={abnormal} className="mt-1.5 text-[11px] text-slate-500">
        <summary className="cursor-pointer select-none font-medium text-slate-600 hover:text-slate-900">
          技术细节（{item.kind} · {formatTime(item.started_at)}）
        </summary>
        <div className="mt-1 space-y-0.5 rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-700">
          <div>operation_id: {item.id}</div>
          <div>run_id: {item.run_id}</div>
          {item.ended_at && <div>ended_at: {formatTime(item.ended_at)}</div>}
          {item.error && (
            <div className="text-amber-800">
              error: {typeof item.error === "string" ? item.error : JSON.stringify(item.error)}
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

/**
 * Observed Execution Track paired with Core's Scientific Plan.
 * Strictly binds events to a plan step only when an explicit recorded step_id exists;
 * events without a recorded step_id stay at the Request level.
 */
export default function DualTrackPanel({
  now,
  selectedStepId,
  invocations,
  loading = false,
  unavailable = false,
  enabled = true,
  hasMore = false,
  onInspectInvocation,
}: DualTrackPanelProps) {
  const stepBound = selectedStepId
    ? invocations.filter((item) => recordedStepIdOf(item, now) === selectedStepId)
    : [];
  const requestLevel = invocations.filter((item) => recordedStepIdOf(item, now) === null);
  const otherStepsCount = invocations.length - stepBound.length - requestLevel.length;

  return (
    <section
      className="dual-track-panel mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3"
      aria-label="双轨执行观测"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
          <Activity className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
          实际执行轨（Observed Execution）
        </div>
        <span className="text-[11px] text-slate-500">
          仅按宿主记录的计划版本和步骤关联挂载；未核实的事件保留在请求层
        </span>
      </div>

      {!enabled && <p className="notice">只读模式：执行观测不可用。</p>}
      {enabled && unavailable && <p role="alert" className="notice is-warning">执行记录读取不可用{invocations.length ? "；以下为上次取得的记录，可能已过期。" : "。不能判断是否存在执行记录。"}</p>}
      {enabled && hasMore && <p className="notice">仅展示最近一页执行记录；更早记录可在该请求的对话执行历史中查看。</p>}
      {enabled && loading && !invocations.length && <p className="notice">正在读取此请求的执行记录…</p>}
      {enabled && !loading && !unavailable && invocations.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
          当前请求尚无可展示的执行记录。
        </p>
      ) : enabled && invocations.length > 0 ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-medium text-slate-700">
              <span className="inline-flex items-center gap-1">
                <Layers className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
                {selectedStepId
                  ? `步骤 ${selectedStepId} 已显式关联 (${stepBound.length})`
                  : "步骤级关联（请先在上方计划图中选择步骤）"}
              </span>
              {otherStepsCount > 0 && (
                <span className="text-[11px] text-slate-500">
                  其他步骤另有 {otherStepsCount} 条
                </span>
              )}
            </div>
            {selectedStepId ? (
              stepBound.length > 0 ? (
                stepBound.map((item) => (
                  <InvocationRow
                    key={item.id}
                    item={item}
                    requestId={now.request_id}
                    onInspect={onInspectInvocation}
                  />
                ))
              ) : (
                <p className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                  步骤 {selectedStepId} 暂无带显式 step_id 的执行事件。
                </p>
              )
            ) : (
              <p className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                点击计划节点可筛选该步骤真实关联的调用与证据。
              </p>
            )}
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-700">
              请求层执行记录（未绑定具体步骤 · {requestLevel.length}）
            </div>
            {requestLevel.length > 0 ? (
              requestLevel.map((item) => (
                <InvocationRow
                  key={item.id}
                  item={item}
                  requestId={now.request_id}
                  onInspect={onInspectInvocation}
                />
              ))
            ) : (
              <p className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                当前请求暂无未绑定步骤的执行事件。
              </p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
