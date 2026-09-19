import type { NodeDetail } from "../api/types";

interface NodeDetailDrawerProps {
  detail: NodeDetail;
  onClose(): void;
}

function humanize(value: string): string {
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export default function NodeDetailDrawer({
  detail,
  onClose,
}: NodeDetailDrawerProps) {
  const currentAttempt = asRecord(detail.summary.current_attempt);
  const attemptHistory = Array.isArray(detail.summary.attempt_history)
    ? detail.summary.attempt_history
    : [];

  return (
    <aside
      className="node-detail-drawer"
      role="dialog"
      aria-modal="false"
      aria-label={humanize(detail.node.type) + " details"}
    >
      <header className="drawer-header">
        <div>
          <p className="eyebrow">{humanize(detail.node.type)}</p>
          <h3>{detail.node.label}</h3>
          <span className={"drawer-status status-" + detail.node.status.toLowerCase()}>
            {detail.node.status}
          </span>
        </div>
        <button
          className="drawer-close"
          type="button"
          aria-label="Close details"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <div className="drawer-body">
        {currentAttempt && (
          <section className="detail-section">
            <h4>Current attempt</h4>
            <dl className="detail-grid">
              <dt>Attempt</dt>
              <dd>{String(currentAttempt.attempt_number ?? "—")}</dd>
              <dt>State</dt>
              <dd>{String(currentAttempt.state ?? "—")}</dd>
              <dt>Provider name</dt>
              <dd>{String(currentAttempt.provider_attempt_name ?? "—")}</dd>
            </dl>
          </section>
        )}

        {attemptHistory.length > 0 && (
          <section className="detail-section">
            <h4>Attempt history</h4>
            <div className="attempt-list">
              {attemptHistory.map((item, index) => {
                const record = asRecord(item) ?? {};
                return (
                  <div className="attempt-row" key={String(record.id ?? index)}>
                    <span>#{String(record.attempt_number ?? index + 1)}</span>
                    <strong>{String(record.state ?? "UNKNOWN")}</strong>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {detail.events.length > 0 && (
          <section className="detail-section">
            <h4>Recent events</h4>
            <div className="event-list">
              {detail.events.slice(-12).map((event, index) => (
                <div className="event-row" key={String(event.id ?? index)}>
                  <span>{String(event.event_type ?? "Event")}</span>
                  {event.sequence_no !== undefined && (
                    <small>#{String(event.sequence_no)}</small>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        <section className="detail-section">
          <h4>Stage data</h4>
          <pre className="detail-json">
            {JSON.stringify(detail.summary, null, 2)}
          </pre>
        </section>

        {detail.evidence_refs.length > 0 && (
          <section className="detail-section">
            <h4>Evidence</h4>
            <ul className="evidence-list">
              {detail.evidence_refs.map((ref) => (
                <li key={ref}>{ref}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}
