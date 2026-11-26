import type { NowData } from "../api/types";
import { actionLabel, formatTime, formatValue, kindLabel, phaseLabel } from "../labels";

interface NowPanelProps {
  now: NowData;
  onSelectStep?: (stepId: string) => void;
}

/** What Core currently holds for the selected request, in Core's own words. */
export default function NowPanel({ now, onSelectStep }: NowPanelProps) {
  const requirements = now.mainline?.requirements;
  const scopePath = Array.isArray(now.scope_context?.path)
    ? (now.scope_context.path as unknown[]).map(String).join(" / ")
    : typeof now.scope_context?.scope_id === "string"
      ? now.scope_context.scope_id
      : null;
  const hasCallArgs =
    now.call?.arguments && Object.keys(now.call.arguments).length > 0;
  const hasPlanExtra = Boolean(
    now.plan?.objective ||
      now.plan?.significance ||
      now.plan?.knowledge_gap ||
      now.plan?.expected_findings?.length ||
      now.plan?.limits?.length ||
      now.deviations?.length,
  );

  return (
    <section className="now-panel" aria-label="Core 当前状态">
      <div className="now-heading">
        <code>{now.request_id}</code>
        <span className="chip">{phaseLabel(now.phase)}</span>
        <span className="chip">{actionLabel(now.action)}</span>
        {now.progress && (
          <span className="chip">
            步骤 {now.progress.done}/{now.progress.total}
          </span>
        )}
        {now.question_type && <span className="chip">{now.question_type}</span>}
        {now.must_not_stop === true && (
          <span className="chip is-soft" title="Core 标记当前尚不可结束工作">
            must_not_stop
          </span>
        )}
        {scopePath && <span className="chip is-soft">范围 {scopePath}</span>}
      </div>

      <h3>原始问题</h3>
      <p className="now-question">{now.original_task_text ?? now.question ?? "未提供"}</p>

      {now.mainline ? (
        <>
          <h3>锁定主线 · v{now.mainline.version}</h3>
          <p>{now.mainline.purpose}</p>
          {requirements && (
            <ul className="requirements">
              {Object.entries(requirements).map(([id, text]) => (
                <li key={id}>
                  <strong>{id}</strong> {text}
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="muted">主线尚未锁定(Core 未返回 mainline)。</p>
      )}

      {(now.instruction || now.call || now.step) && (
        <div className="now-next-step">
          <h3>
            Core 当前指示{now.call?.tool ? " → " + now.call.tool : ""}
          </h3>
          {now.instruction && <p className="now-instruction">{now.instruction}</p>}
          {now.step && (
            <div className="now-focus-row">
              <span>
                当前焦点步骤: <code>{now.step.id}</code> ({kindLabel(now.step.kind)}
                {now.step.attempt ? ` · 第 ${now.step.attempt} 次尝试` : ""})
                {now.step.objective ? ` — ${now.step.objective}` : ""}
              </span>
              {onSelectStep && (
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => onSelectStep(now.step!.id)}
                >
                  查看步骤详情
                </button>
              )}
            </div>
          )}
          {now.also_available && now.also_available.length > 0 && (
            <p className="muted">
              Core 提示也可推进: {now.also_available.join("、")}
            </p>
          )}
          {now.optional_explore_steps && now.optional_explore_steps.length > 0 && (
            <p className="muted">
              可选探索步骤: {now.optional_explore_steps.join("、")}
            </p>
          )}
          {hasCallArgs && (
            <details>
              <summary>Core 指定调用参数 ({now.call?.tool})</summary>
              <pre>{formatValue(now.call?.arguments)}</pre>
            </details>
          )}
        </div>
      )}

      {hasPlanExtra && (
        <details className="now-plan-extra">
          <summary>当前计划补充说明与偏差记录</summary>
          <dl className="facts">
            {now.plan?.objective && (
              <>
                <dt>计划目标</dt>
                <dd>{now.plan.objective}</dd>
              </>
            )}
            {now.plan?.knowledge_gap && (
              <>
                <dt>研究缺口</dt>
                <dd>{now.plan.knowledge_gap}</dd>
              </>
            )}
            {now.plan?.significance && (
              <>
                <dt>科学意义</dt>
                <dd>{now.plan.significance}</dd>
              </>
            )}
            {now.plan?.expected_findings && now.plan.expected_findings.length > 0 && (
              <>
                <dt>预期发现</dt>
                <dd>{now.plan.expected_findings.join("；")}</dd>
              </>
            )}
            {now.plan?.limits && now.plan.limits.length > 0 && (
              <>
                <dt>已知限制</dt>
                <dd>{now.plan.limits.join("；")}</dd>
              </>
            )}
            {now.deviations && now.deviations.length > 0 && (
              <>
                <dt>记录的偏差</dt>
                <dd>
                  <pre>{formatValue(now.deviations)}</pre>
                </dd>
              </>
            )}
          </dl>
        </details>
      )}

      {now.waiting_for_user && (
        <p className="notice">
          等待用户答复{now.waiting_for_user.at ? ` (${formatTime(now.waiting_for_user.at)})` : ""}:
          {now.waiting_for_user.question ?? "未提供"}
        </p>
      )}
      {now.mainline_amendment_pending && (
        <p className="notice is-warning">
          主线修订 {now.mainline_amendment_pending.id} 待用户本人发送原文确认,尚未生效:
          {now.mainline_amendment_pending.reason}
          {now.mainline_amendment_pending.note ? `（${now.mainline_amendment_pending.note}）` : ""}
        </p>
      )}
      {now.unresolved_steps && now.unresolved_steps.length > 0 && (
        <p className="notice is-warning">
          未解决的步骤:{now.unresolved_steps.map((step) => step.id + "(" + step.status + ")").join("、")}
        </p>
      )}
      {now.open_concerns && now.open_concerns.length > 0 && (
        <details>
          <summary>评审未决意见 {now.open_concerns.length} 条(建议,不阻断)</summary>
          <ul>
            {now.open_concerns.map((item, index) => (
              <li key={index}>
                <strong>{item.about}</strong>:{item.concern}
              </li>
            ))}
          </ul>
        </details>
      )}
      {now.evidence_changed_since_submission && now.evidence_changed_since_submission.length > 0 && (
        <details open>
          <summary className="error-text">
            {now.evidence_changed_since_submission.length} 个已提交证据文件与提交时不同(Core 报告)
          </summary>
          <ul>
            {now.evidence_changed_since_submission.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
      )}

      {now.phase === "DELIVERED" && (
        <>
          <h3>交付{now.delivery_kind ? " · " + now.delivery_kind : ""}</h3>
          <p className="now-answer">{now.answer || "未提供"}</p>
          {now.limitations && now.limitations.length > 0 && (
            <ul>
              {now.limitations.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          )}
          {now.disclosure && <p className="notice">{now.disclosure}</p>}
          <p className="muted">
            Core 记录:科学结论未经独立验证(scientific_truth_verified=
            {String(now.scientific_truth_verified)}),执行未经独立验证(execution_verified=
            {String(now.execution_verified)})。
          </p>
        </>
      )}
    </section>
  );
}
