import { useState } from "react";

import type {
  EvidencePreview,
  EvidencePreviewRef,
  NodeDetail,
} from "../api/types";
import {
  eventLabel,
  evidenceRoleLabel,
  fieldLabel,
  formatDateTime,
  formatValue,
  nodeTitle,
  stageLabel,
  statusLabel,
} from "../presentation";

interface NodeDetailDrawerProps {
  detail: NodeDetail;
  loadEvidencePreview?: (previewRef: string) => Promise<EvidencePreview>;
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

function evidenceRefsForEvents(
  events: Record<string, unknown>[],
  previews: EvidencePreviewRef[],
): EvidencePreviewRef[] {
  const lookup = new Map(
    previews.map((ref) => [
      ref.role + "\0" + ref.source_path,
      ref,
    ]),
  );
  const seen = new Set<string>();
  const values: EvidencePreviewRef[] = [];

  for (const event of events) {
    const payload = asRecord(event.payload);
    const executorEvidence = asRecord(payload?.executor_evidence);
    const evidence = executorEvidence?.evidence;
    if (!Array.isArray(evidence)) continue;

    for (const value of evidence) {
      const item = asRecord(value);
      if (!item) continue;
      const role = String(item.role ?? "");
      const sourcePath = String(item.path ?? "");
      const ref = lookup.get(role + "\0" + sourcePath);
      if (!ref || seen.has(ref.id)) continue;
      seen.add(ref.id);
      values.push(ref);
    }
  }

  return values;
}

function formatBytes(value: number): string {
  if (value < 1024) return value + " B";
  if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB";
  return (value / (1024 * 1024)).toFixed(1) + " MB";
}

function EvidenceFiles({
  events,
  evidencePreviews,
  loadEvidencePreview,
}: {
  events: Record<string, unknown>[];
  evidencePreviews: EvidencePreviewRef[];
  loadEvidencePreview?: (previewRef: string) => Promise<EvidencePreview>;
}) {
  const [preview, setPreview] = useState<EvidencePreview | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const refs = evidenceRefsForEvents(events, evidencePreviews);

  if (refs.length === 0) return null;

  const openPreview = async (ref: EvidencePreviewRef) => {
    if (!loadEvidencePreview) return;
    setLoadingId(ref.id);
    setPreview(null);
    setPreviewError(null);
    try {
      const value = await loadEvidencePreview(ref.preview_ref);
      setPreview(value);
    } catch (reason) {
      setPreview(null);
      setPreviewError(
        reason instanceof Error ? reason.message : "无法加载证据预览",
      );
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <section className="attempt-drilldown-section evidence-files-section">
      <h5>证据文件</h5>
      <div className="evidence-preview-list">
        {refs.map((ref) => {
          const label = evidenceRoleLabel(ref.role);
          return (
            <div className="evidence-preview-row" key={ref.id}>
              <div>
                <strong>{label}</strong>
                <code>{ref.name}</code>
              </div>
              <button
                type="button"
                aria-label={"预览" + label}
                disabled={!loadEvidencePreview || loadingId === ref.id}
                onClick={() => void openPreview(ref)}
              >
                {loadingId === ref.id ? "加载中…" : "预览"}
              </button>
            </div>
          );
        })}
      </div>

      {previewError && (
        <div className="evidence-preview-error" role="alert">
          预览失败：{previewError}
        </div>
      )}

      {preview && (
        <div className="evidence-preview-panel" aria-label="证据预览">
          <header>
            <div>
              <strong>{evidenceRoleLabel(preview.role)}</strong>
              <code>{preview.name}</code>
            </div>
            <div className="evidence-preview-meta">
              <span>{formatBytes(preview.size_bytes)}</span>
              {preview.truncated && <span>已截断</span>}
            </div>
          </header>
          <pre>{preview.content}</pre>
        </div>
      )}
    </section>
  );
}

function attemptNumber(attempt: Record<string, unknown>, index: number): number {
  const value = Number(attempt.attempt_number);
  return Number.isFinite(value) && value > 0 ? value : index + 1;
}

function hasRecordValues(value: unknown): boolean {
  const record = asRecord(value);
  return record !== null && Object.keys(record).length > 0;
}

function probeLabel(value: unknown): string {
  if (value === true) return "确认运行中";
  if (value === false) return "确认未运行";
  return "无法确认";
}

function reconciliationReason(event: Record<string, unknown>): string | null {
  if (String(event.event_type ?? "") !== "ReconciliationRequired") {
    return null;
  }

  const payload = asRecord(event.payload);
  const evidence = asRecord(payload?.executor_evidence);
  const processProbe = payload?.process_probe;

  if (
    (processProbe === null || processProbe === undefined) &&
    (evidence?.active === null || evidence?.active === undefined) &&
    (evidence?.terminal_outcome === null ||
      evidence?.terminal_outcome === undefined) &&
    (evidence?.exit_code === null || evidence?.exit_code === undefined)
  ) {
    return "自动探测无法确认执行终态";
  }

  return "自动核验未能确认确定的执行终态";
}

function ReconciliationEvidence({
  event,
}: {
  event: Record<string, unknown>;
}) {
  const reason = reconciliationReason(event);
  if (!reason) return null;

  const payload = asRecord(event.payload) ?? {};
  const executorEvidence = asRecord(payload.executor_evidence) ?? {};
  const evidenceItems = Array.isArray(executorEvidence.evidence)
    ? executorEvidence.evidence
    : [];

  return (
    <div className="reconciliation-evidence">
      <div className="reconciliation-heading">
        <strong>核验依据</strong>
        <span>{reason}</span>
      </div>
      <dl className="reconciliation-grid">
        <dt>进程探测</dt>
        <dd>{probeLabel(payload.process_probe)}</dd>
        <dt>执行是否活跃</dt>
        <dd>{formatValue(executorEvidence.active)}</dd>
        <dt>终态结果</dt>
        <dd>{formatValue(executorEvidence.terminal_outcome)}</dd>
        <dt>退出码</dt>
        <dd>{formatValue(executorEvidence.exit_code)}</dd>
      </dl>
      {evidenceItems.length > 0 && (
        <div className="reconciliation-artifacts">
          <span>证据</span>
          <p>
            已记录 {evidenceItems.length} 项文件证据；可预览项会显示在下方“证据文件”中。
          </p>
        </div>
      )}
    </div>
  );
}

function AttemptEventTimeline({
  events,
}: {
  events: Record<string, unknown>[];
}) {
  if (events.length === 0) {
    return <p className="attempt-empty">当前尝试没有持久化事件。</p>;
  }

  return (
    <div className="attempt-event-timeline">
      {events.map((event, index) => {
        const payload = asRecord(event.payload);
        const hasPayload = payload !== null && Object.keys(payload).length > 0;
        return (
          <article
            className="attempt-event-card"
            key={String(event.id ?? event.sequence_no ?? index)}
          >
            <div className="attempt-event-marker" aria-hidden="true" />
            <div className="attempt-event-body">
              <header>
                <div>
                  <strong>{eventLabel(event.event_type)}</strong>
                  <code>{String(event.event_type ?? "Event")}</code>
                </div>
                <div className="attempt-event-meta">
                  {event.sequence_no !== undefined && (
                    <span>#{String(event.sequence_no)}</span>
                  )}
                  {event.occurred_at !== undefined &&
                    event.occurred_at !== null && (
                      <span>{formatDateTime(event.occurred_at)}</span>
                    )}
                </div>
              </header>

              <ReconciliationEvidence event={event} />

              {hasPayload && (
                <details className="attempt-payload">
                  <summary>原始 payload</summary>
                  <FriendlyValue value={payload} />
                </details>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function AttemptDrilldown({
  attempt,
  events,
  evidencePreviews,
  loadEvidencePreview,
  number,
}: {
  attempt: Record<string, unknown>;
  events: Record<string, unknown>[];
  evidencePreviews: EvidencePreviewRef[];
  loadEvidencePreview?: (previewRef: string) => Promise<EvidencePreview>;
  number: number;
}) {
  const capabilities = asRecord(attempt.capability_snapshot);
  const runtimeEnvironment = asRecord(attempt.observed_runtime_environment);
  const resources = asRecord(attempt.observed_resource_allocation);
  const binding = asRecord(attempt.binding);

  return (
    <div className="attempt-drilldown" aria-label={`尝试 ${number}详情`}>
      {capabilities && Object.keys(capabilities).length > 0 && (
        <section className="attempt-drilldown-section">
          <h5>执行器能力</h5>
          <FriendlyValue value={capabilities} />
        </section>
      )}

      {(hasRecordValues(runtimeEnvironment) ||
        hasRecordValues(resources) ||
        hasRecordValues(binding)) && (
        <section className="attempt-drilldown-section attempt-context-grid">
          {hasRecordValues(runtimeEnvironment) && (
            <div>
              <h5>运行环境</h5>
              <FriendlyValue value={runtimeEnvironment} />
            </div>
          )}
          {hasRecordValues(resources) && (
            <div>
              <h5>资源分配</h5>
              <FriendlyValue value={resources} />
            </div>
          )}
          {hasRecordValues(binding) && (
            <div>
              <h5>执行绑定</h5>
              <FriendlyValue value={binding} />
            </div>
          )}
        </section>
      )}

      <EvidenceFiles
        events={events}
        evidencePreviews={evidencePreviews}
        loadEvidencePreview={loadEvidencePreview}
      />

      <section className="attempt-drilldown-section">
        <h5>事件时间线</h5>
        <AttemptEventTimeline events={events} />
      </section>
    </div>
  );
}

function ExecutionHistoryTimeline({
  detail,
  loadEvidencePreview,
}: {
  detail: NodeDetail;
  loadEvidencePreview?: (previewRef: string) => Promise<EvidencePreview>;
}) {
  const [expandedAttemptKey, setExpandedAttemptKey] = useState<string | null>(
    null,
  );

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
  const fallbackCurrentNumber = Math.max(
    ...attempts.map((attempt, index) => attemptNumber(attempt, index)),
  );
  const rawCurrentNumber = currentAttempt
    ? Number(currentAttempt.attempt_number)
    : Number.NaN;
  const currentNumber = Number.isFinite(rawCurrentNumber)
    ? rawCurrentNumber
    : fallbackCurrentNumber;

  return (
    <section className="detail-section">
      <h4>执行历史</h4>
      <div className="attempt-timeline" aria-label="执行历史">
        {attempts.map((attempt, index) => {
          const number = attemptNumber(attempt, index);
          const id = attempt.id ? String(attempt.id) : null;
          const attemptKey = id ?? `attempt-${number}`;
          const isExpanded = expandedAttemptKey === attemptKey;
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
            <div className="attempt-timeline-block" key={attemptKey}>
              {index > 0 && (
                <div className="attempt-transition" aria-label="再次尝试">
                  <span aria-hidden="true">↓</span>
                  <strong>再次尝试</strong>
                </div>
              )}
              <article className={
                "attempt-card state-" + state.toLowerCase() +
                (isCurrent ? " is-current" : "") +
                (isExpanded ? " is-expanded" : "")
              }>
                <header className="attempt-card-header">
                  <div>
                    <strong>尝试 {number}</strong>
                    {attempt.provider_attempt_name !== undefined &&
                      attempt.provider_attempt_name !== null && (
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

                <button
                  type="button"
                  className="attempt-expand-button"
                  aria-expanded={isExpanded}
                  aria-label={
                    isExpanded
                      ? `收起尝试 ${number}详情`
                      : `展开尝试 ${number}详情`
                  }
                  onClick={() => setExpandedAttemptKey(
                    isExpanded ? null : attemptKey,
                  )}
                >
                  <span>{isExpanded ? "收起详情" : "展开详情"}</span>
                  <span aria-hidden="true">{isExpanded ? "⌃" : "⌄"}</span>
                </button>

                {isExpanded && (
                  <AttemptDrilldown
                    attempt={attempt}
                    events={attemptEvents}
                    evidencePreviews={detail.evidence_previews ?? []}
                    loadEvidencePreview={loadEvidencePreview}
                    number={number}
                  />
                )}
              </article>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ReadableSummary({
  detail,
  loadEvidencePreview,
}: {
  detail: NodeDetail;
  loadEvidencePreview?: (previewRef: string) => Promise<EvidencePreview>;
}) {
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

      <ExecutionHistoryTimeline
        detail={detail}
        loadEvidencePreview={loadEvidencePreview}
      />

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
  loadEvidencePreview,
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
          <ReadableSummary
            detail={detail}
            loadEvidencePreview={loadEvidencePreview}
          />
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
