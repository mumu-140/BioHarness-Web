import { useEffect, useState } from "react";

import type {
  Attempt,
  ContextData,
  InvocationItem,
  ModuleServerObservation,
  NowData,
  RoutesData,
  ScopeNode,
  TreeData,
} from "../api/types";
import useSnapshot from "../hooks/useSnapshot";
import {
  actionLabel,
  formatTime,
  formatValue,
  kindLabel,
  phaseLabel,
  reviewLabel,
  statusLabel,
} from "../labels";
import EvidenceList from "./EvidenceList";
import InvocationInspector from "./InvocationInspector";
import ModuleInspector from "./ModuleInspector";
import SnapshotNotice from "./SnapshotNotice";

const ROUTE_LIMIT = 100; // the most Project Governance returns in one call

export type InspectedTarget =
  | { kind: "invocation"; item: InvocationItem; contextRequestId: string | null }
  | { kind: "module"; server: ModuleServerObservation };

interface InspectorProps {
  workspace: string;
  tree: TreeData | null;
  now: NowData | null;
  scopeId: string | null;
  requestId?: string | null;
  stepId: string | null;
  runtimeEnabled?: boolean;
  inspectedTarget?: InspectedTarget | null;
  invocations?: InvocationItem[];
  onSelectScope?: (id: string) => void;
  onSelectRequest?: (requestId: string, scopeId: string | null, projectId: string | null) => void;
  onSelectStep?: (stepId: string) => void;
  onInspectInvocation?: (item: InvocationItem, contextRequestId: string | null) => void;
  onClearInspected?: () => void;
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
      {attempts.map((attempt) => {
        const hasDeclaredConditions =
          attempt.declared_conditions !== null &&
          attempt.declared_conditions !== undefined &&
          (typeof attempt.declared_conditions !== "object" ||
            Object.keys(attempt.declared_conditions as object).length > 0);
        return (
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
              {hasDeclaredConditions && (
                <Fact label="声明条件" value={attempt.declared_conditions} />
              )}
              <Fact
                label="执行是否经独立验证"
                value={attempt.execution_verified ? "是(记录)" : "否:为提交方报告,未经独立验证"}
              />
            </dl>
            {attempt.condition_gaps && attempt.condition_gaps.length > 0 && (
              <p className="notice is-warning">
                条件缺口: {attempt.condition_gaps.join("；")}
              </p>
            )}
            <EvidenceList workspace={workspace} evidence={attempt.evidence} />
          </li>
        );
      })}
    </ol>
  );
}

function History({
  workspace,
  scopeId,
  filter,
  includeDescendants = false,
  includeRelated = false,
}: {
  workspace: string;
  scopeId: string;
  filter(attempt: Attempt): boolean;
  includeDescendants?: boolean;
  includeRelated?: boolean;
}) {
  // Project Governance returns submissions oldest first, at most ROUTE_LIMIT per
  // call. When a scope has more, the most recent page is read instead of the first.
  const first = useSnapshot<RoutesData>(workspace, "routes", {
    scope_id: scopeId,
    limit: ROUTE_LIMIT,
    include_descendants: includeDescendants || undefined,
    include_related: includeRelated || undefined,
  });
  const total = first.data?.data?.attempt_count ?? 0;
  const latest = useSnapshot<RoutesData>(
    workspace,
    "routes",
    total > ROUTE_LIMIT
      ? {
          scope_id: scopeId,
          limit: ROUTE_LIMIT,
          offset: total - ROUTE_LIMIT,
          include_descendants: includeDescendants || undefined,
          include_related: includeRelated || undefined,
        }
      : null,
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
          {data.included_scope_ids && data.included_scope_ids.length > 1 && (
            <p className="muted">包含研究范围: {data.included_scope_ids.join("、")}</p>
          )}
          {data.note && <p className="muted">{data.note}</p>}
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

function GovernanceContextBlock({
  workspace,
  scopeId,
  requestId,
  onSelectScope,
  onSelectRequest,
  compact = false,
}: {
  workspace: string;
  scopeId: string;
  requestId?: string | null;
  onSelectScope?: (id: string) => void;
  onSelectRequest?: (requestId: string, scopeId: string | null, projectId: string | null) => void;
  compact?: boolean;
}) {
  const ctx = useSnapshot<ContextData>(workspace, "context", {
    scope_id: scopeId,
    ...(requestId ? { request_id: requestId } : {}),
  });
  const data = ctx.data?.ok ? ctx.data.data : null;
  const shared = data?.shared;
  const docsEntries = Object.entries(shared?.documents ?? {});

  return (
    <section className="context-section" aria-label="范围上下文">
      <h3>Project Governance 上下文</h3>
      <SnapshotNotice
        name="范围上下文"
        snapshot={ctx.data}
        error={ctx.error}
        loading={ctx.isLoading}
      />
      {data && (
        <>
          {data.selected_request && (
            <div className="context-card">
              <strong>请求归属核对</strong>
              <dl className="facts">
                <Fact label="请求" value={data.selected_request.request_id} />
                <Fact label="状态" value={statusLabel(data.selected_request.request_status)} />
                <Fact
                  label="目标来源"
                  value={
                    data.selected_request.goal_source?.kind
                      ? `${data.selected_request.goal_source.kind} (v${data.selected_request.mainline_version ?? 0})`
                      : undefined
                  }
                />
              </dl>
              {data.selected_request.changed_scope_goals &&
                data.selected_request.changed_scope_goals.length > 0 && (
                  <p className="notice is-warning">
                    祖先目标版本自绑定后有变化:{" "}
                    {data.selected_request.changed_scope_goals
                      .map((g) => `${g.scope_id} (v${g.bound_version} → v${g.current_version})`)
                      .join("、")}
                  </p>
                )}
            </div>
          )}

          {!compact && shared && (
            <>
              <dl className="facts">
                {shared.scope?.goal_source && (
                  <Fact
                    label="范围目标来源"
                    value={`${shared.scope.goal_source.kind ?? "未提供"} · ${shared.scope.goal_source.request_id ?? ""}`}
                  />
                )}
                {shared.submission_count !== undefined && (
                  <Fact label="范围总提交数" value={shared.submission_count} />
                )}
                {data.shared_sha256 && (
                  <Fact label="上下文摘要" value={data.shared_sha256.slice(0, 16) + "…"} />
                )}
              </dl>

              {shared.ancestors && shared.ancestors.length > 0 && (
                <div className="context-links">
                  <span className="muted">上级范围: </span>
                  {shared.ancestors.map((anc) => (
                    <button
                      type="button"
                      key={anc.scope_id}
                      className="ghost-btn"
                      onClick={() => onSelectScope?.(anc.scope_id)}
                    >
                      {anc.scope_id}
                    </button>
                  ))}
                </div>
              )}

              {shared.children && shared.children.length > 0 && (
                <div className="context-links">
                  <span className="muted">下级分支 ({shared.child_count ?? shared.children.length}): </span>
                  {shared.children.map((child) => (
                    <button
                      type="button"
                      key={child.scope_id}
                      className="ghost-btn"
                      onClick={() => onSelectScope?.(child.scope_id)}
                    >
                      {child.scope_id}
                    </button>
                  ))}
                </div>
              )}

              {shared.requests && shared.requests.length > 0 && (
                <div className="context-links">
                  <span className="muted">范围内请求: </span>
                  {shared.requests.map((req) => (
                    <button
                      type="button"
                      key={req.request_id}
                      className="ghost-btn"
                      onClick={() =>
                        onSelectRequest?.(
                          req.request_id,
                          req.scope_id ?? scopeId,
                          shared.scope?.path?.[0] ?? null,
                        )
                      }
                    >
                      {req.request_id} ({statusLabel(req.request_status)})
                    </button>
                  ))}
                </div>
              )}

              {shared.unavailable_related_ids && shared.unavailable_related_ids.length > 0 && (
                <p className="muted">
                  不可达或不在本视图的相关请求 ID: {shared.unavailable_related_ids.join("、")}
                </p>
              )}

              {docsEntries.length > 0 && (
                <details>
                  <summary>范围索引文档 ({docsEntries.length})</summary>
                  <pre>{formatValue(shared.documents)}</pre>
                </details>
              )}
            </>
          )}

          {(data.scope_guidance || data.note || data.view_semantics) && (
            <details className="context-guidance">
              <summary>Governance 说明与边界提示</summary>
              {data.scope_guidance && <p className="muted">{data.scope_guidance}</p>}
              {data.note && <p className="muted">{data.note}</p>}
              {data.view_semantics && <p className="muted">{data.view_semantics}</p>}
            </details>
          )}
        </>
      )}
    </section>
  );
}

function ScopeDetail({
  workspace,
  node,
  tree,
  requestId,
  onSelectScope,
  onSelectRequest,
}: {
  workspace: string;
  node: ScopeNode;
  tree: TreeData;
  requestId: string | null;
  onSelectScope?: (id: string) => void;
  onSelectRequest?: (requestId: string, scopeId: string | null, projectId: string | null) => void;
}) {
  const [includeDescendants, setIncludeDescendants] = useState(false);
  const [includeRelated, setIncludeRelated] = useState(false);

  const changes = (tree.goal_version_changes ?? []).filter((item) => item.scope_id === node.scope_id);
  const members = new Set((node.requests ?? []).map((ref) => ref.request_id));
  const related = (tree.related_requests ?? []).filter(
    (item) => members.has(item.source_request_id) || members.has(item.target_request_id),
  );
  const belongsToScope = Boolean(requestId && members.has(requestId));
  const sharedEvidence = (tree.shared_evidence ?? []).filter((entry) =>
    entry.references.some((ref) => members.has(ref.request_id)),
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

      <GovernanceContextBlock
        workspace={workspace}
        scopeId={node.scope_id}
        requestId={belongsToScope ? requestId : null}
        onSelectScope={onSelectScope}
        onSelectRequest={onSelectRequest}
      />

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

      {sharedEvidence.length > 0 && (
        <section>
          <h3>跨请求共享证据引用 ({sharedEvidence.length})</h3>
          <p className="muted">仅表示不同请求引用了相同内容哈希的证据，不自动代表当前问题有效。</p>
          <ul className="shared-evidence-list">
            {sharedEvidence.map((entry) => (
              <li key={entry.sha256}>
                <code>sha256 {entry.sha256.slice(0, 16)}…</code>
                <span>
                  {" "}
                  · 引用请求:{" "}
                  {[...new Set(entry.references.map((r) => r.request_id))].join("、")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3>此范围的历史提交</h3>
        <div className="routes-toggles">
          <label>
            <input
              type="checkbox"
              checked={includeDescendants}
              onChange={(e) => setIncludeDescendants(e.target.checked)}
            />
            包含子分支提交
          </label>
          <label>
            <input
              type="checkbox"
              checked={includeRelated}
              onChange={(e) => setIncludeRelated(e.target.checked)}
            />
            包含相关请求提交
          </label>
        </div>
        <History
          workspace={workspace}
          scopeId={node.scope_id}
          filter={() => true}
          includeDescendants={includeDescendants}
          includeRelated={includeRelated}
        />
      </section>
    </>
  );
}

function StepDetail({
  workspace,
  now,
  stepId,
  scopeId,
  onSelectScope,
  onSelectRequest,
  onSelectStep,
}: {
  workspace: string;
  now: NowData;
  stepId: string;
  scopeId: string | null;
  onSelectScope?: (id: string) => void;
  onSelectRequest?: (requestId: string, scopeId: string | null, projectId: string | null) => void;
  onSelectStep?: (stepId: string) => void;
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
        <Fact label="前置需求" value={step.needs?.join("、")} />
        <dt>依赖步骤</dt>
        <dd>
          {step.depends_on?.length ? (
            <span className="dep-chips">
              {step.depends_on.map((dep) => (
                <button
                  type="button"
                  key={dep}
                  className="ghost-btn"
                  onClick={() => onSelectStep?.(dep)}
                >
                  {dep}
                </button>
              ))}
            </span>
          ) : (
            "未提供"
          )}
        </dd>
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
      {scopeId && (
        <GovernanceContextBlock
          workspace={workspace}
          scopeId={scopeId}
          requestId={now.request_id}
          onSelectScope={onSelectScope}
          onSelectRequest={onSelectRequest}
          compact
        />
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

function RequestDetail({
  workspace,
  now,
  scopeId,
  onSelectScope,
  onSelectRequest,
  onSelectStep,
}: {
  workspace: string;
  now: NowData;
  scopeId: string | null;
  onSelectScope?: (id: string) => void;
  onSelectRequest?: (requestId: string, scopeId: string | null, projectId: string | null) => void;
  onSelectStep?: (stepId: string) => void;
}) {
  return (
    <>
      <h2>请求详情 · {now.request_id}</h2>
      <dl className="facts">
        <Fact label="状态与动作" value={`${phaseLabel(now.phase)} · ${actionLabel(now.action)}`} />
        <Fact label="所属范围" value={scopeId ?? "未归属"} />
        <Fact label="问题类型" value={now.question_type} />
        <Fact label="建议工具" value={now.call?.tool} />
        <dt>当前焦点步骤</dt>
        <dd>
          {now.step ? (
            onSelectStep ? (
              <button type="button" className="ghost-btn" onClick={() => onSelectStep(now.step!.id)}>
                {now.step.id}
              </button>
            ) : (
              now.step.id
            )
          ) : (
            "未提供"
          )}
        </dd>
      </dl>

      {now.step && (
        <p className="muted">点击流程图中任意步骤节点可查看该步骤的方法、参数和独立证据。</p>
      )}

      {scopeId ? (
        <>
          <GovernanceContextBlock
            workspace={workspace}
            scopeId={scopeId}
            requestId={now.request_id}
            onSelectScope={onSelectScope}
            onSelectRequest={onSelectRequest}
          />
          <section>
            <h3>此请求的提交与已有证据</h3>
            <History
              workspace={workspace}
              scopeId={scopeId}
              filter={(attempt) => attempt.request_id === now.request_id}
            />
          </section>
        </>
      ) : (
        <p className="notice">
          此请求未归属研究范围。Project Governance 只提供已归属请求的上下文与提交历史，Core 的 science_now
          不返回逐次提交与证据列表。
        </p>
      )}
    </>
  );
}

export default function Inspector({
  workspace,
  tree,
  now,
  scopeId,
  requestId = null,
  stepId,
  runtimeEnabled = false,
  inspectedTarget = null,
  invocations = [],
  onSelectScope,
  onSelectRequest,
  onSelectStep,
  onInspectInvocation,
  onClearInspected,
}: InspectorProps) {
  const [mode, setMode] = useState<"research" | "module">("research");

  useEffect(() => {
    if (inspectedTarget) setMode("module");
  }, [inspectedTarget]);

  useEffect(() => {
    if (stepId) setMode("research");
  }, [stepId]);

  useEffect(() => {
    if (!inspectedTarget) setMode("research");
  }, [inspectedTarget, scopeId, now?.request_id]);

  const node = tree?.nodes.find((item) => item.scope_id === scopeId) ?? null;
  const showTabs = runtimeEnabled || inspectedTarget !== null;

  return (
    <aside className="inspector" aria-label="检查器">
      {showTabs && (
        <div className="inspector-tabs" role="tablist" aria-label="检查器模式">
          <button
            type="button"
            role="tab"
            aria-selected={mode === "research"}
            className={mode === "research" ? "is-active" : ""}
            onClick={() => setMode("research")}
          >
            科研详情
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "module"}
            className={mode === "module" ? "is-active" : ""}
            onClick={() => setMode("module")}
          >
            Module 与调用
          </button>
        </div>
      )}

      {mode === "module" && showTabs ? (
        inspectedTarget?.kind === "invocation" ? (
          <InvocationInspector
            item={inspectedTarget.item}
            conversationRequestId={inspectedTarget.contextRequestId}
            onBack={() => {
              onClearInspected?.();
              setMode("research");
            }}
          />
        ) : inspectedTarget?.kind === "module" ? (
          <ModuleInspector
            server={inspectedTarget.server}
            invocations={invocations}
            onInspectInvocation={(item) =>
              onInspectInvocation?.(item, now?.request_id ?? requestId ?? null)
            }
            onBack={() => {
              onClearInspected?.();
              setMode("research");
            }}
          />
        ) : (
          <div className="inspector-empty">
            <p className="muted">
              在下方“执行轨迹与 Module 观察”中选择一条调用记录或一个 Module 服务器，即可在此查看结构化输入输出、来源、错误与观察时间。
            </p>
          </div>
        )
      ) : (
        <>
          {now && stepId ? (
            <StepDetail
              workspace={workspace}
              now={now}
              stepId={stepId}
              scopeId={scopeId}
              onSelectScope={onSelectScope}
              onSelectRequest={onSelectRequest}
              onSelectStep={onSelectStep}
            />
          ) : now ? (
            <RequestDetail
              workspace={workspace}
              now={now}
              scopeId={scopeId}
              onSelectScope={onSelectScope}
              onSelectRequest={onSelectRequest}
              onSelectStep={onSelectStep}
            />
          ) : node && tree ? (
            <ScopeDetail
              workspace={workspace}
              node={node}
              tree={tree}
              requestId={requestId}
              onSelectScope={onSelectScope}
              onSelectRequest={onSelectRequest}
            />
          ) : (
            <p className="muted">选择一个研究范围或计划步骤以查看详情。</p>
          )}
          {now && (
            <p className="muted inspector-foot">
              历史计划版本与步骤复用失效标记没有公开读取接口,此处不显示。Core 报告保留的历史提交数:
              {now.retained_historical_submissions ?? "未提供"}。
            </p>
          )}
        </>
      )}
    </aside>
  );
}
