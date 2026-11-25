import { useMemo } from "react";

import type { TreeData } from "../api/types";
import GraphCanvas, { type CanvasEdge, type CanvasNode } from "./GraphCanvas";

interface ResearchTreeGraphProps {
  tree: TreeData;
  selectedScopeId: string | null;
  onSelectScope(id: string): void;
}

/**
 * Scopes and their recorded parents. A dashed line marks scopes joined by an
 * explicit RELATED link between two of their requests: context, not a
 * prerequisite and not an execution order.
 */
export default function ResearchTreeGraph({
  tree,
  selectedScopeId,
  onSelectScope,
}: ResearchTreeGraphProps) {
  const { nodes, edges } = useMemo(() => {
    const changed = new Set((tree.goal_version_changes ?? []).map((item) => item.scope_id));
    const scopeOf = new Map<string, string>();
    for (const node of tree.nodes) {
      for (const ref of node.requests ?? []) scopeOf.set(ref.request_id, node.scope_id);
    }
    const nodes: CanvasNode[] = tree.nodes.map((node) => ({
      id: node.scope_id,
      className: "scope-node",
      content: (
        <div className="node-body">
          <div className="node-heading">
            <span className="node-kind">{node.parent_scope_id ? "研究分支" : "项目"}</span>
            {changed.has(node.scope_id) && (
              <span className="badge is-soft" title="记录的目标版本与绑定时不同:提示复核,不代表结果失效">
                目标版本有差异
              </span>
            )}
          </div>
          <strong>{node.scope_id}</strong>
          <span className="node-text">{node.objective}</span>
          <span className="node-meta">
            {node.request_count} 个请求
            {node.mainline_version ? " · 主线 v" + node.mainline_version : " · 主线未锁定"}
          </span>
        </div>
      ),
    }));
    const edges: CanvasEdge[] = tree.nodes
      .filter((node) => node.parent_scope_id)
      .map((node) => ({ source: node.parent_scope_id as string, target: node.scope_id }));
    const linked = new Set<string>();
    for (const relation of tree.related_requests ?? []) {
      const source = scopeOf.get(relation.source_request_id);
      const target = scopeOf.get(relation.target_request_id);
      if (!source || !target || source === target) continue;
      const key = source + "\u0000" + target;
      if (linked.has(key)) continue;
      linked.add(key);
      edges.push({ source, target, contextual: true, label: "相关请求" });
    }
    return { nodes, edges };
  }, [tree]);

  if (tree.nodes.length === 0) {
    return <p className="empty-state">没有可显示的研究范围。</p>;
  }
  return (
    <GraphCanvas
      label="科研树"
      nodes={nodes}
      edges={edges}
      direction="TB"
      selectedId={selectedScopeId}
      onSelect={onSelectScope}
    />
  );
}
