import { useMemo } from "react";

import type { NowData } from "../api/types";
import { kindLabel, reviewLabel, statusLabel } from "../labels";
import GraphCanvas, { type CanvasEdge, type CanvasNode } from "./GraphCanvas";

interface WorkflowGraphProps {
  now: NowData;
  selectedStepId: string | null;
  onSelectStep(id: string): void;
}

/**
 * The current Core plan: one node per step, one edge per declared depends_on.
 * Status, review and "current" come from Core's answer; nothing is derived here.
 */
export default function WorkflowGraph({ now, selectedStepId, onSelectStep }: WorkflowGraphProps) {
  const steps = now.plan?.steps ?? [];
  const { nodes, edges } = useMemo(() => {
    const progress = new Map((now.progress?.steps ?? []).map((item) => [item.id, item]));
    const available = new Set(now.also_available ?? []);
    const nodes: CanvasNode[] = steps.map((step) => {
      const state = progress.get(step.id);
      const current = now.step?.id === step.id;
      return {
        id: step.id,
        className:
          "step-node status-" + (state?.status ?? "unknown").toLowerCase() + (current ? " is-current" : ""),
        content: (
          <div className="node-body">
            <div className="node-heading">
              <span className="node-kind">{kindLabel(step.kind)}</span>
              {current && <span className="badge">Core 当前步骤</span>}
              {available.has(step.id) && <span className="badge is-soft">Core:也可进行</span>}
            </div>
            <strong>{step.id}</strong>
            <span className="node-text">{step.objective ?? "未提供"}</span>
            <span className="node-meta">
              {state ? statusLabel(state.status) : "状态未提供"}
              {state ? " · 尝试 " + state.attempts + " · " + reviewLabel(state.review) : ""}
              {step.serves?.length ? " · 服务 " + step.serves.join("、") : ""}
            </span>
          </div>
        ),
      };
    });
    const edges: CanvasEdge[] = steps.flatMap((step) =>
      (step.depends_on ?? []).map((dependency) => ({ source: dependency, target: step.id })),
    );
    return { nodes, edges };
  }, [steps, now.progress, now.step, now.also_available]);

  if (steps.length === 0) {
    return <p className="empty-state">Core 尚未持有此请求的计划。</p>;
  }
  return (
    <GraphCanvas
      label="科研流程图"
      nodes={nodes}
      edges={edges}
      direction="LR"
      selectedId={selectedStepId}
      onSelect={onSelectStep}
    />
  );
}
