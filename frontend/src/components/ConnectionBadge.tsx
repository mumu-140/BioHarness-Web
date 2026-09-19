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
    ? "Disconnected · showing last update"
    : "Connected";

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
