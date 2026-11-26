import type { InvocationItem, McpToolOutput } from "../api/types";
import {
  formatDuration,
  formatTime,
  formatValue,
  isOmittedValue,
  operationKindLabel,
  operationStateLabel,
} from "../labels";
import StructuredDataView from "./StructuredDataView";

interface InvocationInspectorProps {
  item: InvocationItem;
  conversationRequestId: string | null;
  onBack?: () => void;
}

function inputTargetRequestId(input: unknown): string | null {
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    const rid = (input as Record<string, unknown>).request_id;
    return typeof rid === "string" && rid ? rid : null;
  }
  return null;
}

function inputStepHint(input: unknown): string | null {
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    const sid = (input as Record<string, unknown>).step_id;
    return typeof sid === "string" && sid ? sid : null;
  }
  return null;
}

export default function InvocationInspector({
  item,
  conversationRequestId,
  onBack,
}: InvocationInspectorProps) {
  const details = item.details ?? {};
  const finishReason = typeof details.finish_reason === "string" ? details.finish_reason : null;
  const reportedModel = typeof details.reported_model === "string" ? details.reported_model : null;
  const usage =
    typeof details.usage === "object" && details.usage !== null && !Array.isArray(details.usage)
      ? (details.usage as Record<string, unknown>)
      : null;
  const mcpIsError =
    typeof item.output === "object" &&
    item.output !== null &&
    (item.output as McpToolOutput).is_error === true;

  const targetRequest = item.kind === "core" ? inputTargetRequestId(item.input) : null;
  const crossRequest =
    targetRequest !== null &&
    conversationRequestId !== null &&
    targetRequest !== conversationRequestId;
  const stepHint = inputStepHint(item.input);

  const hasOmission =
    isOmittedValue(item.input) ||
    isOmittedValue(item.output) ||
    (typeof item.output === "object" &&
      item.output !== null &&
      isOmittedValue((item.output as McpToolOutput).structured_content));

  return (
    <div className="module-invocation-inspector">
      <header className="inspector-subhead">
        <div>
          <p className="eyebrow">Web 运行观察（非科学裁决）</p>
          <h2>
            {operationKindLabel(item.kind)} · <code>{item.name}</code>
          </h2>
        </div>
        {onBack && (
          <button type="button" className="ghost-btn" onClick={onBack}>
            返回科研详情
          </button>
        )}
      </header>

      <div className="badge-row">
        <span className={"chip trace-chip is-" + item.state.toLowerCase()}>
          {operationStateLabel(item.state)} ({item.state})
        </span>
        {item.server && <span className="chip">服务器: {item.server}</span>}
        {mcpIsError && <span className="chip is-warn">MCP is_error=true</span>}
        {hasOmission && <span className="chip is-warn">包含省略内容</span>}
        {finishReason === "length" && <span className="chip is-warn">输出被截断 (length)</span>}
      </div>

      <p className="notice">
        技术调用返回仅代表运行过程记录（authority: web-observation），不代表科学结果成立或未经独立验证的结论可靠。
      </p>

      {crossRequest && (
        <p className="notice is-warning">
          跨请求读取：此 Core 调用的输入针对请求 <code>{targetRequest}</code>，不同于当前对话所属请求{" "}
          <code>{conversationRequestId}</code>。
        </p>
      )}

      {finishReason === "length" && (
        <p className="notice is-warning">
          模型响应因达到输出长度上限而截断（finish_reason = length）；未完成内容不作为有效结论。
        </p>
      )}

      <section>
        <h3>身份与来源信息</h3>
        <dl className="facts">
          <dt>操作 ID</dt>
          <dd>
            <code>{item.id}</code>
          </dd>
          <dt>运行 ID</dt>
          <dd>
            <code>{item.run_id}</code>
          </dd>
          <dt>对话上下文请求</dt>
          <dd>{conversationRequestId ? <code>{conversationRequestId}</code> : "尚未绑定请求"}</dd>
          {targetRequest && (
            <>
              <dt>输入目标请求</dt>
              <dd>
                <code>{targetRequest}</code>
              </dd>
            </>
          )}
          <dt>所属服务器</dt>
          <dd>{item.server ?? "未知 / 不适用"}</dd>
          <dt>Module 版本</dt>
          <dd>未知（公开运行投影未提供）</dd>
          <dt>计划步骤身份</dt>
          <dd>
            {stepHint ? (
              <>
                输入参数提及 <code>{stepHint}</code>（非 Core 权威绑定）
              </>
            ) : (
              "未知（运行观察未绑定计划步骤）"
            )}
          </dd>
          <dt>发起方</dt>
          <dd>
            {item.initiator === "model"
              ? "模型提出"
              : item.initiator === "host"
                ? "工作台宿主发起"
                : item.initiator ?? "未知"}
          </dd>
        </dl>
      </section>

      <section>
        <h3>时间与技术状态</h3>
        <dl className="facts">
          <dt>技术状态</dt>
          <dd>
            {operationStateLabel(item.state)} (<code>{item.state}</code>)
          </dd>
          <dt>开始时间</dt>
          <dd>{formatTime(item.started_at)}</dd>
          <dt>结束时间</dt>
          <dd>{item.ended_at ? formatTime(item.ended_at) : "未记录 / 仍在进行"}</dd>
          <dt>耗时</dt>
          <dd>{formatDuration(item.started_at, item.ended_at)}</dd>
          {item.note && (
            <>
              <dt>宿主说明</dt>
              <dd>{item.note}</dd>
            </>
          )}
        </dl>
      </section>

      {(item.kind === "model" || Object.keys(details).length > 0) && (
        <section>
          <h3>调用元数据</h3>
          <dl className="facts">
            {reportedModel !== null && (
              <>
                <dt>实际报告模型</dt>
                <dd>
                  <code>{reportedModel}</code>
                </dd>
              </>
            )}
            {finishReason !== null && (
              <>
                <dt>finish_reason</dt>
                <dd>
                  <code>{finishReason}</code>
                </dd>
              </>
            )}
            {typeof details.seconds === "number" && (
              <>
                <dt>模型请求耗时</dt>
                <dd>{details.seconds.toFixed(2)} s</dd>
              </>
            )}
            {typeof details.tool_calls === "number" && (
              <>
                <dt>提出工具调用数</dt>
                <dd>{details.tool_calls}</dd>
              </>
            )}
            {typeof details.core_decision === "string" && (
              <>
                <dt>Core hook 决策</dt>
                <dd>
                  <code>{details.core_decision}</code>
                </dd>
              </>
            )}
            {usage && (
              <>
                <dt>用量统计 (usage)</dt>
                <dd>
                  <pre className="structured-pre">{formatValue(usage)}</pre>
                </dd>
              </>
            )}
          </dl>
          {Object.keys(details).some(
            (k) => !["reported_model", "finish_reason", "seconds", "tool_calls", "core_decision", "usage"].includes(k),
          ) && (
            <StructuredDataView
              data={Object.fromEntries(
                Object.entries(details).filter(
                  ([k]) =>
                    !["reported_model", "finish_reason", "seconds", "tool_calls", "core_decision", "usage"].includes(k),
                ),
              )}
              title="其余元数据"
            />
          )}
        </section>
      )}

      {item.error !== null && item.error !== undefined && (
        <section>
          <h3>技术错误记录</h3>
          <StructuredDataView data={item.error} />
        </section>
      )}

      <section>
        <h3>输入摘要</h3>
        <StructuredDataView
          data={item.input}
          emptyText="未记录输入（可能为无参数，或服务重启前缺失起始事件）"
        />
      </section>

      <section>
        <h3>输出摘要</h3>
        <StructuredDataView
          data={item.output}
          kind={item.kind}
          emptyText={item.state === "STARTED" ? "运行中，尚无输出。" : "未记录输出。"}
        />
      </section>
    </div>
  );
}
