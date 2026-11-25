import type { ViewName } from "../api/types";

interface ConnectionBadgeProps {
  connected: boolean;
  staleViews: ViewName[];
}

const SOURCE: Record<string, string> = {
  open: "Core",
  now: "Core",
  tree: "Project Governance",
};

export default function ConnectionBadge({ connected, staleViews }: ConnectionBadgeProps) {
  const sources = [...new Set(staleViews.map((view) => SOURCE[view] ?? view))];
  const degraded = !connected || sources.length > 0;
  const text = !connected
    ? "更新通道已断开 · 显示最近一次快照"
    : sources.length > 0
      ? sources.join("、") + " 暂时读取失败 · 显示最近一次快照"
      : "更新通道正常";
  return (
    <div className={"connection-badge " + (degraded ? "is-stale" : "")} role="status">
      <span className="connection-dot" aria-hidden="true" />
      {text}
    </div>
  );
}
