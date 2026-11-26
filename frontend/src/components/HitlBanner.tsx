import { AlertTriangle, Check, Copy, GitBranch, HelpCircle, RefreshCw } from "lucide-react";
import { useState } from "react";

import type { NowData } from "../api/types";

interface HitlBannerProps {
  now: NowData | null;
  disabled?: boolean;
  onBranchFromRequest?: (requestId: string, scopeId: string | null) => void;
}

/**
 * First-class Human-in-the-Loop (HITL) scientific collaboration cards.
 * Never auto-confirms mainline amendments or mutates Core state behind the user's back;
 * provides exact confirmation text copy and explicit branching entry points.
 */
export default function HitlBanner({ now, disabled, onBranchFromRequest }: HitlBannerProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  if (!now) return null;

  const amendment = now.mainline_amendment_pending;
  const waiting = now.action === "WAIT_FOR_USER" || Boolean(now.waiting_for_user);
  const revising = now.action === "REVISE_PLAN";
  const delivered = now.phase === "DELIVERED";
  const requestScope =
    typeof now.scope_context?.scope_id === "string" ? now.scope_context.scope_id : null;

  if (!amendment && !waiting && !revising && !delivered) return null;

  async function copyPhrase(id: string) {
    const phrase = `确认主线 ${id}`;
    try {
      await navigator.clipboard.writeText(phrase);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      // ignore clipboard errors
    }
  }

  return (
    <div className="hitl-banner space-y-2 py-1" aria-label="人机协同提示">
      {amendment && (
        <div className="rounded-lg border border-amber-300 bg-amber-50/90 p-2.5 text-xs text-amber-950">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-700" aria-hidden="true" />
              科研主线修订待确认（{amendment.id}）
            </span>
            <button
              type="button"
              onClick={() => void copyPhrase(amendment.id)}
              className="inline-flex items-center gap-1 rounded border border-amber-400 bg-white px-2 py-0.5 text-[11px] font-medium text-amber-900 hover:bg-amber-100"
            >
              {copiedId === amendment.id ? (
                <>
                  <Check className="h-3 w-3 text-teal-700" aria-hidden="true" />
                  已复制「确认主线 {amendment.id}」
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" aria-hidden="true" />
                  复制确认原文
                </>
              )}
            </button>
          </div>
          <p className="mt-1 text-amber-900">
            <strong>修订原因：</strong>
            {amendment.reason}
          </p>
          <p className="mt-0.5 text-[11px] text-amber-800">
            须由你亲自在下方发送 <code>确认主线 {amendment.id}</code>（走服务端原生用户消息
            hook），工作台绝不代为确认。
          </p>
        </div>
      )}

      {waiting && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/80 p-2.5 text-xs text-blue-950">
          <div className="flex items-center gap-1.5 font-semibold text-blue-900">
            <HelpCircle className="h-3.5 w-3.5 text-blue-700" aria-hidden="true" />
            Core 正在等待你的决策或补充
          </div>
          {now.waiting_for_user?.question && (
            <p className="mt-1 text-blue-900">{now.waiting_for_user.question}</p>
          )}
        </div>
      )}

      {revising && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-800">
          <div className="flex items-center gap-1.5 font-semibold text-slate-900">
            <RefreshCw className="h-3.5 w-3.5 text-teal-700" aria-hidden="true" />
            Core 要求修订当前计划（REVISE_PLAN）
          </div>
          <p className="mt-1 text-slate-600">
            可在下方补充科研约束或直接点击“从 Core 当前状态继续”，由模型按最新主线重新对齐步骤。
          </p>
        </div>
      )}

      {delivered && onBranchFromRequest && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-teal-200 bg-teal-50/60 px-3 py-2 text-xs text-teal-950">
          <span>
            请求 <code>{now.request_id}</code> 已交付（{now.delivery_kind ?? "DELIVERED"}
            ）；如需沿此历史路线开展对照或后续分析，可显式发起关联新请求。
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onBranchFromRequest(now.request_id, requestScope)}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-teal-600 bg-teal-700 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-teal-800 disabled:opacity-50"
          >
            <GitBranch className="h-3 w-3" aria-hidden="true" />
            基于此路线发起新问题
          </button>
        </div>
      )}
    </div>
  );
}
