import type { Attempt, NowData, RoutesData, ScopeNode, TreeData } from "../api/types";
import useSnapshot from "../hooks/useSnapshot";
import { formatTime, formatValue, kindLabel, reviewLabel, statusLabel } from "../labels";
import EvidenceList from "./EvidenceList";
import SnapshotNotice from "./SnapshotNotice";

const ROUTE_LIMIT = 100; // the most Project Governance returns in one call

interface InspectorProps {
  workspace: string;
  tree: TreeData | null;
  now: NowData | null;
  scopeId: string | null;
  stepId: string | null;
}

function Fact({ label, value }: { label: string; value: unknown }) {
  const text = formatValue(value);
  return (
    <>
      <dt>{label}</dt>
      <dd>{text.includes("\n") ? <pre>{text}</pre> : text}</dd>
    </>
  );
}

function Attempts({
  workspace,
  attempts,
  complete,
}: {
  workspace: string;
  attempts: Attempt[];
  complete: boolean;
}) {
  if (attempts.length === 0) {
    return (
      <p className="muted">
        {complete ? "没有记录的提交。" : "在已读取的提交中没有符合的记录;更早的提交未读取。"}
      </p>
    );
  }
  return (
    <ol className="attempts">
      {attempts.map((attempt) => (
        <li key={attempt.request_id + "/" + attempt.submission_index}>
          <header>
            <strong>
              提交 #{attempt.submission_index} · {attempt.step_id}
            </strong>
            <span className="chip">{statusLabel(attempt.submission_status)}</span>
            <code>{attempt.request_id}</code>
          </header>
          <p>{attempt.summary || "未提供摘要"}</p>
          <dl className="facts">
            <Fact label="时间" value={formatTime(attempt.at)} />
            <Fact label="计划版本" value={attempt.plan_version} />
            <Fact label="实际方法" value={attempt.method_used} />
            <Fact
              label="实际参数"
              value={Object.keys(attempt.parameters_used ?? {}).length ? attempt.parameters_used : null}
            />
            <Fact
              label="执行是否经独立验证"
              value={attempt.execution_verified ? "是(记录)" : "否:为提交方报告,未经独立验证"}
            />
          </dl>
          <EvidenceList workspace={workspace} evidence={attempt.evidence} />
        </li>
      ))}
    </ol>
  );
}

function History({
  workspace,
  scopeId,
  filter,
}: {
  workspace: string;
  scopeId: string;
  filter(attempt: Attempt): boolean;
}) {
  // Project Governance returns submissions oldest first, at most ROUTE_LIMIT per
  // call. When a scope has more, the most recent page is read instead of the first.
  const first = useSnapshot<RoutesData>(workspace, "routes", { scope_id: scopeId, limit: ROUTE_LIMIT });
  const total = first.data?.data?.attempt_count ?? 0;
  const latest = useSnapshot<RoutesData>(
    workspace,
    "routes",
    total > ROUTE_LIMIT ? { scope_id: scopeId, limit: ROUTE_LIMIT, offset: total - ROUTE_LIMIT } : null,
  );
  const routes = total > ROUTE_LIMIT ? latest : first;
  const data = routes.data?.data;
  const complete = !!data && data.attempt_count <= data.attempts.length;
  return (
    <>
      <SnapshotNotice
        name="提交历史"
        snapshot={routes.data}
        error={routes.error}
        loading={routes.isLoading}
      />
      {data && (
        <>
          {!complete && (
            <p className="notice">
              此范围共 {data.attempt_count} 条提交,这里只读取了最近的 {data.attempts.length} 条。
            </p>
          )}
          <Attempts workspace={workspace} attempts={data.attempts.filter(filter)} complete={complete} />
        </>
      )}
    </>
  );
}

function ScopeDetail({ workspace, node, tree }: { workspace: string; node: ScopeNode; tree: TreeData }) {
  const changes = (tree.goal_version_changes ?? []).filter((item) => item.scope_id === node.scope_id);
  const members = new Set((node.requests ?? []).map((ref) => ref.request_id));
  const related = (tree.related_requests ?? []).filter(
    (item) => members.has(item.source_request_id) || members.has(item.target_request_id),
  );
  return (
    <>
      <h2>研究范围 · {node.scope_id}</h2>
      <dl className="facts">
        <Fact label="路径" value={node.path.join(" / ")} />
        <Fact label="目标" value={node.objective} />
        <Fact label="主线版本" value={node.mainline_version || "未锁定"} />
        <Fact label="起始请求" value={node.origin.request_id} />
        <Fact label="请求数" value={node.request_count} />
      </dl>
      {changes.length > 0 && (
        <section>
          <h3>目标版本差异</h3>
          <p className="muted">
            {tree.review_note ?? "记录的目标版本与绑定时不同,提示复核,不代表结果失效。"}
          </p>
          <ul>
            {changes.map((item) => (
              <li key={item.request_id}>
                <code>{item.request_id}</code>:
                {item.changed_scope_goals
                  .map((goal) => `${goal.scope_id} 绑定 v${goal.bound_version},当前 v${goal.current_version}`)
                  .join(";")}
              </li>
            ))}
          </ul>
        </section>
      )}
      {related.length > 0 && (
        <section>
          <h3>明确记录的相关请求</h3>
          <p className="muted">相关链接是背景参考,不是前置条件,也不是证据。</p>
          <ul>
            {related.map((item) => (
              <li key={item.source_request_id + item.target_request_id}>
                <code>{item.source_request_id}</code> → <code>{item.target_request_id}</code>
                {!item.target_available && "(目标不在本项目视图内)"}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h3>此范围的历史提交</h3>
        <History workspace={workspace} scopeId={node.scope_id} filter={() => true} />
      </section>
    </>
  );
}

function StepDetail({
  workspace,
  now,
  stepId,
  scopeId,
}: {
  workspace: string;
  now: NowData;
  stepId: string;
  scopeId: string | null;
}) {
  const step = now.plan?.steps.find((item) => item.id === stepId);
  if (!step) return <p className="muted">当前计划中没有步骤 {stepId}。</p>;
  const state = now.progress?.steps.find((item) => item.id === stepId);
  const current = now.step?.id === stepId ? now.step : null;
  return (
    <>
      <h2>步骤 · {step.id}</h2>
      <dl className="facts">
        <Fact label="类型" value={kindLabel(step.kind)} />
        <Fact label="目标" value={step.objective} />
        <Fact label="服务的 Requirement" value={step.serves?.join("、")} />
        <Fact label="理由" value={step.why} />
        <Fact label="依赖步骤" value={step.depends_on?.join("、")} />
        <Fact label="声明方法" value={step.method} />
        <Fact label="声明参数" value={step.parameters} />
        <Fact label="交付物" value={step.deliverable} />
        <Fact label="检查" value={step.check} />
        <Fact label="Core 记录状态" value={state ? statusLabel(state.status) : null} />
        <Fact label="尝试次数" value={state?.attempts} />
        <Fact label="评审" value={state ? reviewLabel(state.review) : null} />
      </dl>
      {current?.last_review && (
        <section>
          <h3>最近一次评审意见(建议,不阻断)</h3>
          <pre>{formatValue(current.last_review)}</pre>
        </section>
      )}
      <section>
        <h3>此步骤的提交与证据</h3>
        {scopeId ? (
          <History
            workspace={workspace}
            scopeId={scopeId}
            filter={(attempt) => attempt.request_id === now.request_id && attempt.step_id === stepId}
          />
        ) : (
          <p className="notice">
            此请求未归属研究范围。Project Governance 只提供已归属请求的提交历史,Core 的 science_now
            不返回逐次提交与证据,因此这里无法显示。
          </p>
        )}
      </section>
    </>
  );
}

export default function Inspector({ workspace, tree, now, scopeId, stepId }: InspectorProps) {
  const node = tree?.nodes.find((item) => item.scope_id === scopeId) ?? null;
  return (
    <aside className="inspector" aria-label="检查器">
      {now && stepId ? (
        <StepDetail workspace={workspace} now={now} stepId={stepId} scopeId={scopeId} />
      ) : node && tree ? (
        <ScopeDetail workspace={workspace} node={node} tree={tree} />
      ) : (
        <p className="muted">选择一个研究范围或计划步骤以查看详情。</p>
      )}
      {now && (
        <p className="muted inspector-foot">
          历史计划版本与步骤复用失效标记没有公开读取接口,此处不显示。Core 报告保留的历史提交数:
          {now.retained_historical_submissions ?? "未提供"}。
        </p>
      )}
    </aside>
  );
}
