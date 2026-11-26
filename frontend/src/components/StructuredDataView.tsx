import type { ReactNode } from "react";

import type { McpToolOutput } from "../api/types";
import { formatValue, isOmittedValue, safeExternalUrl } from "../labels";

interface StructuredDataViewProps {
  data: unknown;
  kind?: string;
  emptyText?: string;
  title?: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMcpOutput(value: unknown): value is McpToolOutput {
  if (!isPlainObject(value)) return false;
  return (
    "is_error" in value ||
    "structured_content" in value ||
    "non_text_content_not_shown" in value ||
    "truncated_characters" in value ||
    "host_error" in value
  );
}

function isUniformObjectArray(value: unknown): value is Record<string, unknown>[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entry) => isPlainObject(entry))
  );
}

function ScalarText({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === "") {
    return <span className="muted">未提供</span>;
  }
  if (isOmittedValue(value)) {
    return (
      <span className="omitted-inline">
        已省略（共 {value.characters} 字符）· 开头: <code>{value.head.slice(0, 120)}</code>
      </span>
    );
  }
  if (typeof value === "boolean") {
    return <code>{value ? "true" : "false"}</code>;
  }
  if (typeof value === "number") {
    return <span>{String(value)}</span>;
  }
  if (typeof value === "string") {
    const url = safeExternalUrl(value);
    if (url) {
      return (
        <a href={url} target="_blank" rel="noopener noreferrer" className="safe-link">
          {value}
        </a>
      );
    }
    return value.includes("\n") ? <pre className="structured-pre">{value}</pre> : <span>{value}</span>;
  }
  return <pre className="structured-pre">{formatValue(value)}</pre>;
}

function OmittedBlock({
  label,
  value,
}: {
  label: string;
  value: { omitted: true; characters: number; head: string };
}) {
  return (
    <div className="notice is-warning structured-omitted">
      <strong>
        {label}过大已省略（共 {value.characters} 字符）
      </strong>
      <p className="muted">仅保留开头片段预览；完整内容未保存且未在前端重构，不可视为空值。</p>
      <pre className="structured-pre">{value.head}</pre>
    </div>
  );
}

function ObjectTable({
  rows,
  title,
}: {
  rows: Record<string, unknown>[];
  title: string;
}) {
  const columns: string[] = [];
  for (const row of rows.slice(0, 50)) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key) && columns.length < 12) columns.push(key);
    }
  }
  const shown = rows.slice(0, 50);

  return (
    <div className="structured-block">
      <div className="structured-block-head">
        <strong>{title}</strong>
        <span className="muted">
          {rows.length > shown.length ? `显示前 ${shown.length} / 共 ${rows.length} 项` : `共 ${rows.length} 项`}
        </span>
      </div>
      <div className="evidence-table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, idx) => (
              <tr key={idx}>
                {columns.map((col) => (
                  <td key={col}>
                    <ScalarText value={row[col]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KeyValueCard({
  record,
  title,
  excludeKeys = [],
}: {
  record: Record<string, unknown>;
  title?: string;
  excludeKeys?: string[];
}) {
  const entries = Object.entries(record).filter(([key]) => !excludeKeys.includes(key));
  if (entries.length === 0) return null;

  return (
    <div className="structured-block">
      {title && <h4>{title}</h4>}
      <dl className="facts">
        {entries.map(([key, val]) => (
          <div className="fact-row" key={key}>
            <dt>{key}</dt>
            <dd>
              {isOmittedValue(val) ? (
                <OmittedBlock label={key} value={val} />
              ) : isUniformObjectArray(val) ? (
                <ObjectTable rows={val} title={key} />
              ) : (
                <ScalarText value={val} />
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function renderDomainSpecific(data: Record<string, unknown>, kind?: string): ReactNode | null {
  // 1. Memory-shaped observations (read-only over actual returned fields; never infers adoption)
  const hasMemoryFields =
    "candidate" in data ||
    "candidates" in data ||
    "memories" in data ||
    "retrieval_mode" in data ||
    "t1" in data ||
    "t2" in data ||
    "t3" in data ||
    ("use" in data && ("execution_verified" in data || "tier" in data || "candidate" in data));

  if (hasMemoryFields) {
    const useText = data.use === undefined ? "未记录" : String(data.use);
    return (
      <div className="structured-domain">
        <p className="notice">
          Memory 观察摘要（按 Module 返回原样展示；检索候选或工具返回不等于已被任务采用或产生科学收益）。
        </p>
        <dl className="facts">
          <dt>记录的使用状态 (use)</dt>
          <dd>{useText === "not recorded" ? "not recorded（未记录使用）" : useText}</dd>
          {"retrieval_mode" in data && (
            <>
              <dt>检索模式</dt>
              <dd>{String(data.retrieval_mode)}</dd>
            </>
          )}
          {"execution_verified" in data && (
            <>
              <dt>执行验证</dt>
              <dd>{data.execution_verified ? "true（记录）" : "false（未经独立验证）"}</dd>
            </>
          )}
        </dl>
        {isPlainObject(data.candidate) && <KeyValueCard record={data.candidate} title="候选记忆条目" />}
        {isUniformObjectArray(data.candidates) && <ObjectTable rows={data.candidates} title="候选记忆列表" />}
        {isUniformObjectArray(data.memories) && <ObjectTable rows={data.memories} title="记忆条目列表" />}
        {isUniformObjectArray(data.evidence) && <ObjectTable rows={data.evidence} title="附带引用" />}
        <KeyValueCard
          record={data}
          title="其余返回字段"
          excludeKeys={["use", "retrieval_mode", "execution_verified", "candidate", "candidates", "memories", "evidence"]}
        />
      </div>
    );
  }

  // 2. Literature-shaped observations (source records only; no invented passage links)
  const papers = Array.isArray(data.papers)
    ? data.papers
    : Array.isArray(data.articles)
      ? data.articles
      : "query" in data && Array.isArray(data.results)
        ? data.results
        : null;
  if (papers && papers.every((item) => isPlainObject(item))) {
    return (
      <div className="structured-domain">
        <KeyValueCard
          record={data}
          title="文献检索参数"
          excludeKeys={["papers", "articles", "results"]}
        />
        <ObjectTable rows={papers as Record<string, unknown>[]} title="返回文献记录" />
      </div>
    );
  }

  // 3. Core answer structure
  if (kind === "core" && ("phase" in data || "action" in data || "ok" in data || "open_requests" in data)) {
    const coreFields: Record<string, unknown> = {};
    for (const key of [
      "ok",
      "request_id",
      "resumed",
      "phase",
      "action",
      "must_not_stop",
      "question_type",
      "instruction",
    ]) {
      if (key in data) coreFields[key] = data[key];
    }
    return (
      <div className="structured-domain">
        <KeyValueCard record={coreFields} title="Core 响应要点" />
        {isPlainObject(data.error) && (
          <div className="notice is-warning">
            <strong>Core 拒绝 / 错误</strong>
            <KeyValueCard record={data.error} />
          </div>
        )}
        {isPlainObject(data.step) && <KeyValueCard record={data.step} title="Core 焦点步骤" />}
        {isUniformObjectArray(data.open_requests) && (
          <ObjectTable rows={data.open_requests} title="开放请求列表" />
        )}
        <KeyValueCard
          record={data}
          title="其余 Core 字段"
          excludeKeys={[...Object.keys(coreFields), "error", "step", "open_requests"]}
        />
      </div>
    );
  }

  // 4. Statistics / evidence / general structured object
  if (isUniformObjectArray(data.evidence) || isUniformObjectArray(data.rows) || isUniformObjectArray(data.items)) {
    const listKey = isUniformObjectArray(data.evidence)
      ? "evidence"
      : isUniformObjectArray(data.rows)
        ? "rows"
        : "items";
    return (
      <div className="structured-domain">
        <KeyValueCard record={data} title="字段摘要" excludeKeys={[listKey]} />
        <ObjectTable rows={data[listKey] as Record<string, unknown>[]} title={listKey} />
      </div>
    );
  }

  return null;
}

/**
 * Renders structured payloads (MCP tool outputs, Core answers, inputs, errors, or
 * generic objects/arrays) as readable cards and tables first, keeping raw JSON as
 * a secondary expandable disclosure or explicit fallback.
 */
export default function StructuredDataView({
  data,
  kind,
  emptyText = "未记录",
  title,
}: StructuredDataViewProps) {
  if (data === null || data === undefined) {
    return <p className="muted">{emptyText}</p>;
  }

  if (isOmittedValue(data)) {
    return <OmittedBlock label={title ?? "载荷"} value={data} />;
  }

  if (typeof data === "string" || typeof data === "number" || typeof data === "boolean") {
    return (
      <div className="structured-block">
        {title && <h4>{title}</h4>}
        <ScalarText value={data} />
      </div>
    );
  }

  let body: ReactNode = null;

  if (isMcpOutput(data)) {
    const extraKeys = Object.keys(data).filter(
      (k) =>
        ![
          "is_error",
          "text",
          "structured_content",
          "non_text_content_not_shown",
          "truncated_characters",
          "host_error",
        ].includes(k),
    );
    body = (
      <div className="structured-mcp">
        {data.is_error === true && (
          <p className="notice is-warning">
            Module 返回错误标记（is_error = true）：本次工具调用报告了执行或请求错误。
          </p>
        )}
        {typeof data.host_error === "string" && data.host_error && (
          <p className="notice is-warning">宿主拒绝 / 异常: {data.host_error}</p>
        )}
        {typeof data.truncated_characters === "number" && data.truncated_characters > 0 && (
          <p className="notice">
            文本输出已被有界截断，另有 {data.truncated_characters} 字符未显示（截断内容不代表为空）。
          </p>
        )}
        {Array.isArray(data.non_text_content_not_shown) && data.non_text_content_not_shown.length > 0 && (
          <p className="notice">
            存在未显示的非文本返回类型: {data.non_text_content_not_shown.join("、")}
          </p>
        )}
        {typeof data.text === "string" && data.text.length > 0 && (
          <div className="structured-block">
            <h4>返回文本</h4>
            <pre className="structured-pre">{data.text}</pre>
          </div>
        )}
        {data.structured_content !== undefined && data.structured_content !== null && (
          <div className="structured-block">
            <h4>结构化返回 (structured_content)</h4>
            {isOmittedValue(data.structured_content) ? (
              <OmittedBlock label="structured_content" value={data.structured_content} />
            ) : isPlainObject(data.structured_content) ? (
              renderDomainSpecific(data.structured_content, kind) ?? (
                <KeyValueCard record={data.structured_content} />
              )
            ) : isUniformObjectArray(data.structured_content) ? (
              <ObjectTable rows={data.structured_content} title="structured_content" />
            ) : (
              <ScalarText value={data.structured_content} />
            )}
          </div>
        )}
        {extraKeys.length > 0 && (
          <KeyValueCard
            record={Object.fromEntries(extraKeys.map((k) => [k, data[k]]))}
            title="其他输出字段"
          />
        )}
      </div>
    );
  } else if (isPlainObject(data)) {
    body = renderDomainSpecific(data, kind) ?? <KeyValueCard record={data} title={title} />;
  } else if (isUniformObjectArray(data)) {
    body = <ObjectTable rows={data} title={title ?? "记录列表"} />;
  } else if (Array.isArray(data)) {
    body = (
      <div className="structured-block">
        {title && <h4>{title}</h4>}
        <ul className="structured-list">
          {data.slice(0, 50).map((item, index) => (
            <li key={index}>
              <ScalarText value={item} />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="structured-data-view">
      {body}
      <details className="raw-json-disclosure">
        <summary>原始 JSON（技术详情 / 回退）</summary>
        <pre className="structured-pre">{formatValue(data)}</pre>
      </details>
    </div>
  );
}
