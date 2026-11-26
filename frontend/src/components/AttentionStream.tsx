import { AlertTriangle, ArrowRight, Bell, FileWarning, HelpCircle } from "lucide-react";

import type { NowData, OpenData, TreeData } from "../api/types";

export interface AttentionItem {
  id: string;
  kind: "amendment" | "wait_for_user" | "goal_change" | "evidence_changed" | "open_selection";
  title: string;
  detail: string;
  requestId?: string | null;
  scopeId?: string | null;
  projectId?: string | null;
}

export function buildAttentionItems(
  now: NowData | null,
  tree: TreeData | null,
  open: OpenData | null,
  selectedRequestId: string | null,
): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (now?.mainline_amendment_pending) {
    items.push({
      id: `amendment-${now.request_id}-${now.mainline_amendment_pending.id}`,
      kind: "amendment",
      title: `主线修订待确认 (${now.mainline_amendment_pending.id})`,
      detail: `${now.request_id} · 需由研究者在对话中明确确认，工作台不会自动确认`,
      requestId: now.request_id,
      scopeId:
        typeof now.scope_context?.scope_id === "string" ? now.scope_context.scope_id : null,
      projectId: tree?.project_id ?? null,
    });
  }

  if (now?.action === "WAIT_FOR_USER" || now?.waiting_for_user) {
    items.push({
      id: `wait-${now.request_id}`,
      kind: "wait_for_user",
      title: "等待研究者回复",
      detail: now.waiting_for_user?.question
        ? `${now.request_id} · ${now.waiting_for_user.question}`
        : `${now.request_id} · Core 正在等待你的决策或补充`,
      requestId: now.request_id,
      scopeId:
        typeof now.scope_context?.scope_id === "string" ? now.scope_context.scope_id : null,
      projectId: tree?.project_id ?? null,
    });
  }

  if (now?.evidence_changed_since_submission?.length) {
    items.push({
      id: `evidence-drift-${now.request_id}`,
      kind: "evidence_changed",
      title: `提交后源文件发生变化 (${now.evidence_changed_since_submission.length})`,
      detail: `${now.request_id} · 请在检查器核对最新文件与记录哈希`,
      requestId: now.request_id,
      scopeId:
        typeof now.scope_context?.scope_id === "string" ? now.scope_context.scope_id : null,
      projectId: tree?.project_id ?? null,
    });
  }

  for (const change of tree?.goal_version_changes ?? []) {
    const summary = change.changed_scope_goals
      .map((g) => `${g.scope_id} v${g.bound_version}→v${g.current_version}`)
      .join("，");
    items.push({
      id: `goal-change-${change.request_id}`,
      kind: "goal_change",
      title: "上游目标版本有差异",
      detail: `${change.request_id}${summary ? ` · ${summary}` : ""}（提示复核，非执行门禁）`,
      requestId: change.request_id,
      scopeId: change.scope_id,
      projectId: tree?.project_id ?? null,
    });
  }

  if (!selectedRequestId && open && open.open_requests.length > 1) {
    items.push({
      id: "open-selection",
      kind: "open_selection",
      title: `${open.open_requests.length} 个开放请求待明确选择`,
      detail: "请在左侧选择要继续的请求，工作台不会代为选定",
    });
  }

  return items;
}

interface AttentionStreamProps {
  items: AttentionItem[];
  onNavigate: (item: AttentionItem) => void;
}

/**
 * Aggregated read-only projection of pending items that need researcher attention.
 * Never acts as a second task state machine; clicking only navigates to the target.
 */
export default function AttentionStream({ items, onNavigate }: AttentionStreamProps) {
  if (items.length === 0) return null;

  return (
    <section
      className="attention-stream flex items-center gap-2 overflow-x-auto border-b border-amber-200/80 bg-amber-50/70 px-3 py-1.5"
      aria-label="待关注科研事项"
    >
      <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-amber-900">
        <Bell className="h-3.5 w-3.5" aria-hidden="true" />
        待关注 ({items.length})
      </span>
      <div className="flex items-center gap-2">
        {items.map((item) => {
          const Icon =
            item.kind === "wait_for_user"
              ? HelpCircle
              : item.kind === "evidence_changed"
                ? FileWarning
                : AlertTriangle;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item)}
              className="group flex shrink-0 items-center gap-1.5 rounded-md border border-amber-300/80 bg-white px-2.5 py-1 text-left text-xs text-slate-800 shadow-2xs transition-colors hover:border-amber-400 hover:bg-amber-50"
              title={item.detail}
            >
              <Icon className="h-3.5 w-3.5 shrink-0 text-amber-700" aria-hidden="true" />
              <span className="font-medium text-slate-900">{item.title}</span>
              <span className="max-w-[240px] truncate text-slate-600">{item.detail}</span>
              <ArrowRight
                className="h-3 w-3 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-amber-800"
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>
    </section>
  );
}
