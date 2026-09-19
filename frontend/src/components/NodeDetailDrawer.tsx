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

function ReadableSummary({ detail }: { detail: NodeDetail }) {
  const entries = Object.entries(detail.summary);

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
