import { useState } from "react";

import type { NodeDetail } from "../api/types";
import {
  eventLabel,
  fieldLabel,
  formatDateTime,
  formatValue,
  nodeTitle,
  stageLabel,
  statusLabel,
} from "../presentation";

interface NodeDetailDrawerProps {
  detail: NodeDetail;
  onClose(): void;
}

type ViewMode = "readable" | "json";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function FriendlyValue({
  value,
  depth = 0,
}: {
  value: unknown;
  depth?: number;
}) {
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return <span>{formatValue(value)}</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span>无</span>;
    return (
      <div className="friendly-list">
        {value.map((item, index) => (
          <div className="friendly-list-item" key={index}>
            <FriendlyValue value={item} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }

  const record = asRecord(value);
  if (!record) return <span>{String(value)}</span>;

  if (depth >= 2) {
    return (
      <pre className="inline-json">{JSON.stringify(record, null, 2)}</pre>
    );
  }

  return (
    <dl className="friendly-object">
      {Object.entries(record).map(([key, item]) => (
        <div className="friendly-row" key={key}>
          <dt>{fieldLabel(key)}</dt>
          <dd><FriendlyValue value={item} depth={depth + 1} /></dd>
        </div>
      ))}
    </dl>
  );
}

function attemptNumber(attempt: Record<string, unknown>, index: number): number {
  const value = Number(attempt.attempt_number);
  return Number.isFinite(value) && value > 0 ? value : index + 1;
}

function ExecutionHistoryTimeline({ detail }: { detail: NodeDetail }) {
  if (detail.node.type !== "EXECUTION") return null;

  const historyValue = detail.summary.attempt_history;
  if (!Array.isArray(historyValue) || historyValue.length === 0) return null;

  const attempts = historyValue
    .map((value) => asRecord(value))
    .filter((value): value is Record<string, unknown> => value !== null)
    .sort((left, right) => (
      attemptNumber(left, 0) - attemptNumber(right, 0)
    ));

  const currentAttempt = asRecord(detail.summary.current_attempt);
  const currentId = currentAttempt?.id ? String(currentAttempt.id) : null;
  const currentNumber = currentAttempt
    ? Number(currentAttempt.attempt_number)
    : Math.max(...attempts.map((attempt, index) => attemptNumber(attempt, index)));

  return (
    <section className="detail-section">
      <h4>执行历史</h4>
      <div className="attempt-timeline" aria-label="执行历史">
        {attempts.map((attempt, index) => {
          const number = attemptNumber(attempt, index);
          const id = attempt.id ? String(attempt.id) : null;
          const isCurrent = currentId ? id === currentId : number === currentNumber;
          const attemptEvents = detail.events
            .filter((event) => (
              id !== null &&
              event.run_attempt_id !== undefined &&
              String(event.run_attempt_id) === id
            ))
            .sort((left, right) => (
              Number(left.sequence_no ?? 0) - Number(right.sequence_no ?? 0)
            ));
          const state = String(attempt.state ?? "UNKNOWN");

          return (
            <div className="attempt-timeline-block" key={id ?? String(number)}>
              {index > 0 && (
                <div className="attempt-transition" aria-label="再次尝试">
                  <span aria-hidden="true">↓</span>
                  <strong>再次尝试</strong>
                </div>
              )}
              <article className={
                "attempt-card state-" + state.toLowerCase() +
                (isCurrent ? " is-current" : "")
              }>
                <header className="attempt-card-header">
                  <div>
                    <strong>尝试 {number}</strong>
                    {attempt.provider_attempt_name && (
                      <div className="attempt-provider">
                        <span>外部执行名称</span>
                        <code>{String(attempt.provider_attempt_name)}</code>
                      </div>
                    )}
                  </div>
                  <div className="attempt-card-badges">
                    {isCurrent && <span className="attempt-current">当前尝试</span>}
                    <span className={"attempt-state status-" + state.toLowerCase()}>
                      {statusLabel(state)}
                    </span>
                  </div>
                </header>

                <dl className="attempt-card-times">
                  <div>
                    <dt>提交</dt>
                    <dd>{formatDateTime(attempt.submitted_at)}</dd>
                  </div>
                  <div>
                    <dt>最近核验</dt>
                    <dd>{formatDateTime(attempt.last_reconciled_at)}</dd>
                  </div>
                </dl>

                {attemptEvents.length > 0 && (
                  <div className="attempt-event-strip">
                    {attemptEvents.slice(-4).map((event, eventIndex) => (
                      <span
                        className="attempt-event-chip"
                        key={String(event.id ?? event.sequence_no ?? eventIndex)}
                        title={String(event.event_type ?? "Event")}
                      >
                        {eventLabel(event.event_type)}
                      </span>
                    ))}
                  </div>
                )}
              </article>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ReadableSummary({ detail }: { detail: NodeDetail }) {
  const hasExecutionHistory = (
    detail.node.type === "EXECUTION" &&
    Array.isArray(detail.summary.attempt_history) &&
    detail.summary.attempt_history.length > 0
  );
  const entries = Object.entries(detail.summary).filter(
    ([key]) => !(
      hasExecutionHistory &&
      (key === "attempt_history" || key === "current_attempt")
    ),
  );

  return (
    <>
      <section className="detail-section">
        <h4>节点信息</h4>
        <dl className="detail-grid">
          <dt>阶段</dt>
          <dd>{stageLabel(detail.node.type)}</dd>
          <dt>状态</dt>
          <dd>{statusLabel(detail.node.status)}</dd>
          <dt>节点标识</dt>
          <dd><code>{detail.node.id}</code></dd>
          <dt>开始时间</dt>
          <dd>{formatDateTime(detail.node.started_at)}</dd>
          <dt>完成时间</dt>
          <dd>{formatDateTime(detail.node.finished_at)}</dd>
        </dl>
      </section>

      <ExecutionHistoryTimeline detail={detail} />

      {entries.length > 0 && (
        <section className="detail-section">
          <h4>运行信息</h4>
          <div className="summary-groups">
            {entries.map(([key, value]) => (
              <div className="summary-group" key={key}>
                <h5>{fieldLabel(key)}</h5>
                <FriendlyValue value={value} />
              </div>
            ))}
          </div>
        </section>
      )}

      {detail.events.length > 0 && (
        <section className="detail-section">
          <h4>最近事件</h4>
          <div className="event-list">
            {detail.events.slice(-12).reverse().map((event, index) => (
              <div className="event-row event-row-rich" key={String(event.id ?? index)}>
                <div>
                  <strong>{eventLabel(event.event_type)}</strong>
                  <code>{String(event.event_type ?? "Event")}</code>
                </div>
                <div className="event-meta">
                  {event.sequence_no !== undefined && (
                    <span>#{String(event.sequence_no)}</span>
                  )}
                  {event.occurred_at !== undefined && event.occurred_at !== null && (
                    <span>{formatDateTime(event.occurred_at)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {detail.evidence_refs.length > 0 && (
        <section className="detail-section">
          <h4>证据引用</h4>
          <ul className="evidence-list">
            {detail.evidence_refs.map((ref) => (
              <li key={ref}>{ref}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

export default function NodeDetailDrawer({
  detail,
  onClose,
}: NodeDetailDrawerProps) {
  const [view, setView] = useState<ViewMode>("readable");

  return (
    <aside
      className="node-detail-drawer"
      role="dialog"
      aria-modal="false"
      aria-label={stageLabel(detail.node.type) + "节点详情"}
    >
      <header className="drawer-header">
        <div>
          <p className="eyebrow">节点详情</p>
          <h3>{nodeTitle(detail.node)}</h3>
          {detail.node.label && detail.node.label !== nodeTitle(detail.node) && (
            <code className="drawer-technical-name">{detail.node.label}</code>
          )}
          <span className={"drawer-status status-" + detail.node.status.toLowerCase()}>
            {statusLabel(detail.node.status)}
          </span>
        </div>
        <button
          className="drawer-close"
          type="button"
          aria-label="关闭详情"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <div className="drawer-tabs" role="tablist" aria-label="详情视图">
        <button
          type="button"
          role="tab"
          aria-selected={view === "readable"}
          className={view === "readable" ? "is-active" : ""}
          onClick={() => setView("readable")}
        >
          易读视图
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "json"}
          className={view === "json" ? "is-active" : ""}
          onClick={() => setView("json")}
        >
          原始 JSON
        </button>
      </div>

      <div className="drawer-body">
        {view === "readable" ? (
          <ReadableSummary detail={detail} />
        ) : (
          <section className="detail-section raw-json-section">
            <div className="raw-json-heading">
              <h4>原始 JSON</h4>
              <span>用于核对字段和底层证据</span>
            </div>
            <pre className="detail-json">
              {JSON.stringify(detail, null, 2)}
            </pre>
          </section>
        )}
      </div>
    </aside>
  );
}
