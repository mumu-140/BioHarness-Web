import { type FormEvent, useMemo, useState } from "react";

import type { OpenData, RecordRef, ScopeNode, Snapshot, TreeData } from "../api/types";
import { formatTime, statusLabel } from "../labels";

interface NavigatorProps {
  workspaces: string[];
  workspace: string | null;
  onSelectWorkspace(id: string): void;
  tree: Snapshot<TreeData> | undefined;
  /** Root scopes offered by Project Governance when the workspace has several. */
  projects: ScopeNode[];
  open: Snapshot<OpenData> | undefined;
  projectId: string | null;
  onSelectProject(id: string | null): void;
  scopeId: string | null;
  onSelectScope(id: string): void;
  requestId: string | null;
  onSelectRequest(requestId: string, scopeId: string | null, projectId: string | null): void;
}

function requestState(ref: RecordRef): string {
  return ref.delivery_kind
    ? statusLabel(ref.request_status) + " · " + ref.delivery_kind
    : statusLabel(ref.request_status);
}

function ScopeRow({
  node,
  props,
  goalChangedScopes,
  query,
}: {
  node: ScopeNode;
  props: NavigatorProps;
  goalChangedScopes: Set<string>;
  query: string;
}) {
  const requests = (node.requests ?? []).filter((ref) => {
    if (!query) return true;
    return (
      ref.request_id.toLowerCase().includes(query) ||
      node.scope_id.toLowerCase().includes(query) ||
      node.objective.toLowerCase().includes(query)
    );
  });

  return (
    <li style={{ paddingLeft: (node.path.length - 1) * 14 }}>
      <button
        type="button"
        className={"nav-scope " + (props.scopeId === node.scope_id ? "is-selected" : "")}
        aria-current={props.scopeId === node.scope_id ? "true" : undefined}
        onClick={() => props.onSelectScope(node.scope_id)}
        title={node.objective}
      >
        <div className="nav-scope-main">
          <strong>{node.scope_id}</strong>
          <small className="nav-scope-objective">{node.objective}</small>
        </div>
        <div className="nav-scope-meta">
          <span>{node.request_count} 个请求</span>
          {goalChangedScopes.has(node.scope_id) && (
            <span className="nav-change-mark" title="存在目标版本差异">
              版本差异
            </span>
          )}
        </div>
      </button>
      <ul className="nav-requests">
        {requests.map((ref) => (
          <li key={ref.request_id}>
            <button
              type="button"
              className={"nav-request " + (props.requestId === ref.request_id ? "is-selected" : "")}
              aria-current={props.requestId === ref.request_id ? "true" : undefined}
              onClick={() => props.onSelectRequest(ref.request_id, node.scope_id, node.path[0])}
            >
              <code>{ref.request_id}</code>
              <span>{requestState(ref)}</span>
            </button>
          </li>
        ))}
      </ul>
    </li>
  );
}

export default function Navigator(props: NavigatorProps) {
  const [manualId, setManualId] = useState("");
  const [filterText, setFilterText] = useState("");
  const tree = props.tree?.data;
  const projects = props.projects;
  const open = props.open?.data;
  const query = filterText.trim().toLowerCase();

  const goalChangedScopes = useMemo(
    () =>
      new Set(
        (tree?.goal_version_changes ?? [])
          .map((item) => item.scope_id)
          .filter((id): id is string => typeof id === "string"),
      ),
    [tree?.goal_version_changes],
  );

  const visibleScopes = useMemo(() => {
    if (!tree?.nodes) return [];
    if (!query) return tree.nodes;
    return tree.nodes.filter(
      (node) =>
        node.scope_id.toLowerCase().includes(query) ||
        node.objective.toLowerCase().includes(query) ||
        (node.requests ?? []).some((r) => r.request_id.toLowerCase().includes(query)),
    );
  }, [tree?.nodes, query]);

  const visibleOpen = useMemo(() => {
    const items = open?.open_requests ?? [];
    if (!query) return items;
    return items.filter(
      (item) =>
        item.request_id.toLowerCase().includes(query) ||
        (item.question ?? "").toLowerCase().includes(query) ||
        (item.scope_id ?? "").toLowerCase().includes(query),
    );
  }, [open?.open_requests, query]);

  function openManual(event: FormEvent) {
    event.preventDefault();
    const id = manualId.trim();
    if (id) props.onSelectRequest(id, null, null);
  }

  return (
    <aside className="navigator" aria-label="科研项目导航">
      <header>
        <p className="eyebrow">BioHarness</p>
        <h1>科研工作台</h1>
      </header>

      <label className="nav-field">
        工作区
        <select
          value={props.workspace ?? ""}
          onChange={(event) => props.onSelectWorkspace(event.target.value)}
        >
          {!props.workspace && <option value="">请选择工作区</option>}
          {props.workspaces.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </label>

      {projects.length > 0 ? (
        <label className="nav-field">
          科研项目
          <select
            value={props.projectId ?? ""}
            onChange={(event) => props.onSelectProject(event.target.value || null)}
          >
            <option value="">{props.projectId ? "返回项目列表" : "请选择项目"}</option>
            {projects.map((project) => (
              <option key={project.scope_id} value={project.scope_id}>
                {project.scope_id}
              </option>
            ))}
          </select>
        </label>
      ) : (
        tree?.project_id && (
          <div className="nav-field">
            <span>科研项目</span>
            <strong className="nav-project-fixed">{tree.project_id}</strong>
          </div>
        )
      )}

      <label className="nav-field">
        筛选范围与请求
        <input
          type="search"
          aria-label="筛选范围与请求"
          value={filterText}
          placeholder="输入范围、请求 ID 或问题关键词…"
          onChange={(event) => setFilterText(event.target.value)}
        />
      </label>

      <section aria-label="科研树">
        <h2>科研树{tree?.project_id ? " · " + tree.project_id : ""}</h2>
        {tree && tree.nodes.length > 0 ? (
          visibleScopes.length > 0 ? (
            <ul className="nav-tree">
              {visibleScopes.map((node) => (
                <ScopeRow
                  key={node.scope_id}
                  node={node}
                  props={props}
                  goalChangedScopes={goalChangedScopes}
                  query={query}
                />
              ))}
            </ul>
          ) : (
            <p className="nav-empty">没有匹配“{filterText.trim()}”的研究范围。</p>
          )
        ) : (
          <p className="nav-empty">
            {props.tree?.ok === false
              ? "Project Governance 未返回科研树"
              : projects.length > 0
                ? "请选择一个项目"
                : props.tree
                  ? "此工作区没有已声明的研究范围"
                  : "未读取"}
          </p>
        )}
      </section>

      <section aria-label="开放请求">
        <h2>Core 开放请求</h2>
        {open ? (
          open.open_requests.length > 0 ? (
            <>
              <p className="nav-hint">
                Core 列出 {open.open_requests.length} 个开放请求,需明确选择,不会自动选定。
                {open.may_be_incomplete &&
                  " Core 一次最多列出这么多,可能还有未列出的,请按 ID 打开。"}
                {open.may_be_incomplete && open.source_message && " Core 原文:" + open.source_message}
              </p>
              {visibleOpen.length > 0 ? (
                <ul className="nav-requests nav-open-list">
                  {visibleOpen.map((item) => (
                    <li key={item.request_id}>
                      <button
                        type="button"
                        className={
                          "nav-request nav-open-item " +
                          (props.requestId === item.request_id ? "is-selected" : "")
                        }
                        title={item.question}
                        onClick={() =>
                          props.onSelectRequest(
                            item.request_id,
                            item.scope_id ?? null,
                            item.project_id ?? null,
                          )
                        }
                      >
                        <div className="nav-open-top">
                          <code>{item.request_id}</code>
                          <span>{item.scope_id ?? "未归属研究范围"}</span>
                        </div>
                        {item.question && (
                          <small className="nav-open-question">{item.question}</small>
                        )}
                        {item.updated_at && (
                          <small className="nav-open-time">更新 {formatTime(item.updated_at)}</small>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="nav-empty">没有匹配“{filterText.trim()}”的开放请求。</p>
              )}
            </>
          ) : (
            <p className="nav-empty">
              {open.core_state_present ? "没有开放请求" : "此工作区尚无 Core 记录"}
            </p>
          )
        ) : (
          <p className="nav-empty">
            {props.open?.ok === false ? "Core 未返回开放请求列表" : "未读取"}
          </p>
        )}
        <form className="nav-manual" onSubmit={openManual}>
          <label htmlFor="manual-request">按 request_id 打开</label>
          <div>
            <input
              id="manual-request"
              value={manualId}
              placeholder="sci-…"
              onChange={(event) => setManualId(event.target.value)}
            />
            <button type="submit" disabled={!manualId.trim()}>
              打开
            </button>
          </div>
          <p className="nav-hint">已交付的未归属请求没有公开的列举接口,只能按 ID 打开。</p>
        </form>
      </section>
    </aside>
  );
}
