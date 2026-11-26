import type { InvocationItem, ModuleServerObservation } from "../api/types";
import { formatTime, moduleStateLabel, operationStateLabel } from "../labels";
import StructuredDataView from "./StructuredDataView";

interface ModuleInspectorProps {
  server: ModuleServerObservation;
  invocations: InvocationItem[];
  onInspectInvocation(item: InvocationItem): void;
  onBack?: () => void;
}

export default function ModuleInspector({
  server,
  invocations,
  onInspectInvocation,
  onBack,
}: ModuleInspectorProps) {
  const listed = server.tools ?? [];
  const offered = server.offered_tools ?? [];
  const conflicts =
    server.state === "LISTED" && server.tools && server.offered_tools
      ? listed.filter((tool) => !offered.includes(tool))
      : [];

  // Match strictly by the server field returned in observed invocations; never guess by tool name.
  const serverCalls = invocations.filter((item) => item.server === server.server);

  return (
    <div className="module-invocation-inspector">
      <header className="inspector-subhead">
        <div>
          <p className="eyebrow">Module 工具服务器检查（观察投影）</p>
          <h2>{server.server}</h2>
        </div>
        {onBack && (
          <button type="button" className="ghost-btn" onClick={onBack}>
            返回科研详情
          </button>
        )}
      </header>

      <div className="badge-row">
        <span className={"chip trace-chip is-" + server.state.toLowerCase()}>
          {moduleStateLabel(server.state)}
        </span>
        <span className="chip">{server.configured ? "当前配置中" : "未在当前配置"}</span>
        {conflicts.length > 0 && <span className="chip is-warn">存在 {conflicts.length} 个工具名冲突</span>}
      </div>

      <p className="notice">
        这里展示本对话最近一次工具发现观察到的服务器状态。LISTED 不代表服务器此刻仍在线、已被调用或科研结果有效；配置变更后需重新运行才会再次发现。
      </p>

      <section>
        <h3>发现观察记录</h3>
        <dl className="facts">
          <dt>服务器标识</dt>
          <dd>
            <code>{server.server}</code>
          </dd>
          <dt>观察状态</dt>
          <dd>
            {moduleStateLabel(server.state)} (<code>{server.state}</code>)
          </dd>
          <dt>观察时间</dt>
          <dd>{server.observed_at ? formatTime(server.observed_at) : "尚未观察"}</dd>
          <dt>观察所属运行</dt>
          <dd>{server.run_id ? <code>{server.run_id}</code> : "无"}</dd>
          <dt>Module 版本</dt>
          <dd>未知（公开发现投影未返回版本）</dd>
        </dl>
      </section>

      {server.state === "NOT_OBSERVED" && (
        <p className="notice">
          此服务器已配置，但尚未在本对话中执行过工具发现。配置名本身不证明工具可用或可连接。
        </p>
      )}

      {server.state === "UNAVAILABLE" && (
        <section>
          <h3>发现失败信息</h3>
          <StructuredDataView
            data={server.error ?? { message: "工具发现失败，未返回详细错误。" }}
          />
        </section>
      )}

      {server.state === "LISTED" && (
        <>
          <section>
            <h3>实际发现的工具 ({listed.length})</h3>
            {listed.length === 0 ? (
              <p className="muted">服务器未列出任何工具。</p>
            ) : (
              <ul className="tool-tag-list">
                {listed.map((tool) => {
                  const conflicted = conflicts.includes(tool);
                  return (
                    <li key={tool} className={conflicted ? "tool-tag is-conflict" : "tool-tag"}>
                      <code>{tool}</code>
                      <span>{conflicted ? " · 名称冲突未提供" : " · 已提供"}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <h3>本轮实际提供给模型的工具 ({offered.length})</h3>
            {offered.length === 0 ? (
              <p className="muted">排除名称冲突后，没有向模型提供工具。</p>
            ) : (
              <ul className="tool-tag-list">
                {offered.map((tool) => (
                  <li key={tool} className="tool-tag">
                    <code>{tool}</code>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {conflicts.length > 0 && (
            <p className="notice is-warning">
              工具名冲突：<code>{conflicts.join("、")}</code> 与 Core 保留调用或其他先前服务器重名，本轮未向模型提供。
            </p>
          )}
        </>
      )}

      <section>
        <h3>本对话中该服务器的实际调用 ({serverCalls.length})</h3>
        {serverCalls.length === 0 ? (
          <p className="muted">在已加载的调用记录中，尚未观察到该服务器的工具调用。</p>
        ) : (
          <ol className="server-calls">
            {serverCalls.map((call) => (
              <li key={call.id}>
                <button
                  type="button"
                  className="server-call-btn"
                  onClick={() => onInspectInvocation(call)}
                >
                  <code>{call.name}</code>
                  <span className={"trace-state is-" + call.state.toLowerCase()}>
                    {operationStateLabel(call.state)}
                  </span>
                  <span className="muted">{formatTime(call.started_at)}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
