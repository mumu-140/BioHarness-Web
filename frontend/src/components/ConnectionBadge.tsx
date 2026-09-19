interface ConnectionBadgeProps {
  connected?: boolean;
  stale?: boolean;
}

export default function ConnectionBadge({
  connected = true,
  stale = false,
}: ConnectionBadgeProps) {
  const degraded = !connected || stale;
  const text = degraded
    ? "连接已断开 · 显示最近一次数据"
    : "实时连接正常";

  return (
    <div
      className={"connection-badge " + (degraded ? "is-stale" : "")}
      aria-live="polite"
    >
      <span className="connection-dot" aria-hidden="true" />
      {text}
    </div>
  );
}
