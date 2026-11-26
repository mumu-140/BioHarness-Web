import { useState } from "react";

import { getEvidencePreview } from "../api/client";
import type { EvidencePreviewResponse, EvidenceRef } from "../api/types";
import { formatBytes, identityLabel, unavailableLabel } from "../labels";
import EvidencePreviewViewer from "./EvidencePreviewViewer";

interface EvidenceListProps {
  workspace: string;
  evidence: EvidenceRef[];
}

type Loaded = { response?: EvidencePreviewResponse; error?: string; loading?: boolean; collapsed?: boolean };

function anchorKey(ref: EvidenceRef): string {
  return [ref.request_id, ref.submission_index, ref.evidence_id, ref.sha256].join("/");
}

/** Recorded evidence of one submission; a preview is fetched by its exact recorded anchor. */
export default function EvidenceList({ workspace, evidence }: EvidenceListProps) {
  const [opened, setOpened] = useState<Record<string, Loaded>>({});

  async function open(ref: EvidenceRef) {
    const key = anchorKey(ref);
    setOpened((state) => ({ ...state, [key]: { loading: true, collapsed: false } }));
    try {
      const response = await getEvidencePreview(workspace, ref);
      setOpened((state) => ({ ...state, [key]: { response, collapsed: false } }));
    } catch (reason) {
      const error = reason instanceof Error ? reason.message : "预览读取失败";
      setOpened((state) => ({ ...state, [key]: { error, collapsed: false } }));
    }
  }

  function toggleCollapse(key: string) {
    setOpened((state) => {
      const cur = state[key];
      if (!cur) return state;
      return { ...state, [key]: { ...cur, collapsed: !cur.collapsed } };
    });
  }

  if (evidence.length === 0) return <p className="muted">此提交没有记录证据。</p>;
  return (
    <ul className="evidence-list">
      {evidence.map((ref) => {
        const key = anchorKey(ref);
        const state = opened[key];
        const preview = state?.response?.preview;
        const hasResult = Boolean(state?.response || state?.error);
        return (
          <li key={key}>
            <div className="evidence-row">
              <div>
                <strong>
                  {ref.evidence_id} · {ref.kind ?? "类型未提供"}
                  {ref.bytes !== undefined && ref.bytes !== null ? ` · ${formatBytes(ref.bytes)}` : ""}
                  {ref.snapshot === true ? " · 已留存快照" : ref.snapshot === false ? " · 未留存快照" : ""}
                </strong>
                <code title={ref.source}>{ref.source ?? "来源未提供"}</code>
                <code title={ref.sha256}>
                  证据锚 #{ref.submission_index} · sha256 {ref.sha256.slice(0, 16)}…
                </code>
              </div>
              <div className="evidence-actions">
                <button type="button" onClick={() => open(ref)} disabled={state?.loading}>
                  {state?.loading ? "读取中…" : "预览"}
                </button>
                {hasResult && !state?.loading && (
                  <button
                    type="button"
                    className="ghost-btn"
                    onClick={() => toggleCollapse(key)}
                  >
                    {state?.collapsed ? "展开" : "收起"}
                  </button>
                )}
              </div>
            </div>
            {!state?.collapsed && state?.error && (
              <p className="notice is-warning" role="alert">
                {state.error}
              </p>
            )}
            {!state?.collapsed && state?.response && !state.response.ok && (
              <p className="notice is-warning" role="alert">
                Project Governance 未确认此证据引用:{state.response.error?.message}
              </p>
            )}
            {!state?.collapsed && preview && (
              <div className="evidence-preview">
                <dl className="facts">
                  <dt>记录引用</dt>
                  <dd>{identityLabel(state?.response?.recorded_reference)}</dd>
                  <dt>Core 快照完整性</dt>
                  <dd>{identityLabel(state?.response?.snapshot_integrity)}</dd>
                  <dt>当前文件</dt>
                  <dd>{identityLabel(preview.current_file_identity)}</dd>
                  {preview.size_bytes !== undefined && (
                    <>
                      <dt>当前文件大小</dt>
                      <dd>{formatBytes(preview.size_bytes)}</dd>
                    </>
                  )}
                </dl>
                {state?.response?.source_note && (
                  <p className="muted">{state.response.source_note}</p>
                )}
                <p className="muted">
                  以上只说明内容标识是否一致,不代表来源可靠、适用于当前问题或科学结论成立。
                </p>
                {preview.content_available && preview.content !== null ? (
                  <EvidencePreviewViewer
                    preview={{
                      format: preview.format ?? "text",
                      truncated: Boolean(preview.truncated),
                      content: preview.content,
                    }}
                  />
                ) : (
                  <p className="notice">无法显示内容:{unavailableLabel(preview.unavailable_reason)}</p>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
