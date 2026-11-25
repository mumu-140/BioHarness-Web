import type { NowData } from "../api/types";
import { actionLabel, phaseLabel } from "../labels";

/** What Core currently holds for the selected request, in Core's own words. */
export default function NowPanel({ now }: { now: NowData }) {
  const requirements = now.mainline?.requirements;
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

      {now.instruction && (
        <>
          <h3>Core 当前指示{now.call?.tool ? " → " + now.call.tool : ""}</h3>
          <p className="now-instruction">{now.instruction}</p>
        </>
      )}

      {now.waiting_for_user && (
        <p className="notice">等待用户答复:{now.waiting_for_user.question ?? "未提供"}</p>
      )}
      {now.mainline_amendment_pending && (
        <p className="notice">
          主线修订 {now.mainline_amendment_pending.id} 待用户本人确认,尚未生效:
          {now.mainline_amendment_pending.reason}
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
        <details>
          <summary>
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
