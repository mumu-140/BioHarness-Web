import { type FormEvent, useState } from "react";

import type { OpenData, RecordRef, ScopeNode, Snapshot, TreeData } from "../api/types";
import { statusLabel } from "../labels";

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
}: {
  node: ScopeNode;
  props: NavigatorProps;
}) {
  return (
    <li style={{ paddingLeft: (node.path.length - 1) * 14 }}>
      <button
        type="button"
        className={"nav-scope " + (props.scopeId === node.scope_id ? "is-selected" : "")}
        aria-current={props.scopeId === node.scope_id ? "true" : undefined}
        onClick={() => props.onSelectScope(node.scope_id)}
        title={node.objective}
      >
        <strong>{node.scope_id}</strong>
        <span>{node.request_count} 个请求</span>
      </button>
      <ul className="nav-requests">
        {(node.requests ?? []).map((ref) => (
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
  const tree = props.tree?.data;
  const projects = props.projects;
  const open = props.open?.data;

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

      {projects.length > 0 && (
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
      )}

      <section aria-label="科研树">
        <h2>科研树{tree?.project_id ? " · " + tree.project_id : ""}</h2>
        {tree && tree.nodes.length > 0 ? (
          <ul className="nav-tree">
            {tree.nodes.map((node) => (
              <ScopeRow key={node.scope_id} node={node} props={props} />
            ))}
          </ul>
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
              <ul className="nav-requests">
                {open.open_requests.map((item) => (
                  <li key={item.request_id}>
                    <button
                      type="button"
                      className={
                        "nav-request " + (props.requestId === item.request_id ? "is-selected" : "")
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
                      <code>{item.request_id}</code>
                      <span>{item.scope_id ?? "未归属研究范围"}</span>
                    </button>
                  </li>
                ))}
              </ul>
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
