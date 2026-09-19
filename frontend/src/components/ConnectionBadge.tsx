interface ConnectionBadgeProps {
  connected?: boolean;
  stale?: boolean;
}

export default function ConnectionBadge({
  connected = true,
  stale = false,
}: ConnectionBadgeProps) {
  const text = !connected || stale ? "Disconnected" : "Connected";
  return (
    <div
      className={"connection-badge " + (!connected || stale ? "is-stale" : "")}
      aria-live="polite"
    >
      <span className="connection-dot" aria-hidden="true" />
      {text}
    </div>
  );
}
