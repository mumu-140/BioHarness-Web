import { Loader2 } from "lucide-react";

export interface ActiveRunSummary {
  conversationId: string;
  runId: string;
  requestId: string | null;
}

interface BackgroundRunIndicatorProps {
  activeRun: ActiveRunSummary | null;
  currentRequestId: string | null;
  onJumpToRun: (run: ActiveRunSummary) => void;
}

/**
 * Top-bar indicator for an in-flight backend Run.
 * Lets researchers inspect other scopes/projects/artifacts without interrupting the active Run,
 * and jump straight back with one click.
 */
export default function BackgroundRunIndicator({
  activeRun,
  currentRequestId,
  onJumpToRun,
}: BackgroundRunIndicatorProps) {
  if (!activeRun) return null;
  const viewingElsewhere = Boolean(activeRun.requestId && currentRequestId !== activeRun.requestId);

  return (
    <button
      type="button"
      onClick={() => onJumpToRun(activeRun)}
      title="后台运行不受页面切换影响；点击回到正在执行的请求"
      className="inline-flex items-center gap-1.5 rounded-full border border-teal-300 bg-teal-50 px-2.5 py-0.5 text-[11px] font-medium text-teal-900 transition-colors hover:bg-teal-100"
    >
      <Loader2 className="h-3 w-3 animate-spin text-teal-700" aria-hidden="true" />
      <span>
        后台运行中 · {activeRun.requestId ?? activeRun.conversationId}
        {viewingElsewhere ? "（点击返回）" : ""}
      </span>
    </button>
  );
}
