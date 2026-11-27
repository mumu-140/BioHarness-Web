/**
 * Read-only directed research plan canvas built with @xyflow/react 13.0.3 + @dagrejs/dagre 2.0.0
 * and dsh-context-inspired calm status node presentation (not upstream LibreChat code).
 *
 * Strictly maps Core `plan.steps` and `depends_on` edges (supporting arbitrary multi-predecessor
 * DAGs) without substituting Agent ancestry or inferring scientific eligibility client-side.
 */
import React, { memo, useMemo } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import type { PlanStep, StepProgress } from './bioharness';
import { cn } from '~/utils';

const NODE_WIDTH = 244;
const NODE_HEIGHT = 96;

export interface PlanStepNodeData extends Record<string, unknown> {
  step: PlanStep;
  status: string | null;
  attempts: number | null;
  isCurrent: boolean;
  isSelected: boolean;
  onInspect: (stepId: string) => void;
}

const STATUS_TONE: Record<string, string> = {
  DONE: 'border-teal-500/70 bg-teal-50/70 dark:bg-teal-950/40',
  PASSED: 'border-teal-500/70 bg-teal-50/70 dark:bg-teal-950/40',
  ACTIVE: 'border-blue-500/80 bg-blue-50/80 dark:bg-blue-950/40',
  IN_PROGRESS: 'border-blue-500/80 bg-blue-50/80 dark:bg-blue-950/40',
  BLOCKED: 'border-amber-500/80 bg-amber-50/80 dark:bg-amber-950/40',
  FAILED: 'border-red-500/80 bg-red-50/80 dark:bg-red-950/40',
  PENDING: 'border-border-medium bg-surface-primary',
};

const PlanStepNode = memo(function PlanStepNode({ data }: NodeProps<Node<PlanStepNodeData>>) {
  const { step, status, attempts, isCurrent, isSelected, onInspect } = data;
  const tone = STATUS_TONE[status ?? ''] ?? 'border-border-medium bg-surface-primary';
  const depsCount = step.depends_on?.length ?? 0;

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`bh-plan-node-${step.id}`}
      onClick={() => onInspect(step.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onInspect(step.id);
        }
      }}
      className={cn(
        'flex h-[96px] w-[244px] cursor-pointer flex-col justify-between rounded-xl border px-3 py-2 text-left shadow-xs transition-shadow hover:shadow-md focus:outline-hidden focus:ring-2',
        tone,
        isSelected && 'ring-2 ring-blue-500',
        isCurrent && 'ring-1 ring-blue-400/70',
      )}
    >
      <Handle type="target" position={Position.Left} className="!bg-border-heavy !h-2 !w-2" />
      <div className="flex items-center justify-between gap-1.5">
        <span className="text-text-primary truncate font-mono text-xs font-semibold">
          {step.id}
        </span>
        <span className="bg-surface-hover text-text-secondary shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium">
          {status ?? step.kind}
        </span>
      </div>
      <p className="text-text-secondary line-clamp-2 text-[11px] leading-snug">
        {step.objective || step.method || 'No objective recorded'}
      </p>
      <div className="text-text-tertiary flex items-center justify-between text-[10px]">
        <span>{step.kind}</span>
        <span>
          {depsCount > 0 ? `${depsCount} dep${depsCount > 1 ? 's' : ''}` : 'root'}
          {attempts !== null && attempts > 0 ? ` · ${attempts} att` : ''}
        </span>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-border-heavy !h-2 !w-2" />
    </div>
  );
});

const NODE_TYPES = { planStep: PlanStepNode };

/** Deterministic Dagre 2.0.0 multi-predecessor DAG layout for Core `plan.steps`. */
export function layoutPlanGraph(
  steps: PlanStep[],
  progressSteps: StepProgress[] | undefined,
  currentStepId: string | null,
  selectedStepId: string | null,
  onInspect: (stepId: string) => void,
): { nodes: Array<Node<PlanStepNodeData>>; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 32, ranksep: 64, marginx: 24, marginy: 24 });

  const progressById = new Map<string, StepProgress>();
  for (const item of progressSteps ?? []) {
    progressById.set(item.id, item);
  }
  const stepIds = new Set(steps.map((s) => s.id));

  for (const step of steps) {
    g.setNode(step.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }

  const edges: Edge[] = [];
  for (const step of steps) {
    for (const dep of step.depends_on ?? []) {
      if (!stepIds.has(dep) || dep === step.id) {
        continue;
      }
      g.setEdge(dep, step.id);
      edges.push({
        id: `${dep}->${step.id}`,
        source: dep,
        target: step.id,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
        animated: currentStepId === step.id,
      });
    }
  }

  dagre.layout(g);

  const nodes: Array<Node<PlanStepNodeData>> = steps.map((step) => {
    const pos = g.node(step.id);
    const prog = progressById.get(step.id);
    return {
      id: step.id,
      type: 'planStep',
      position: {
        x: (pos?.x ?? 0) - NODE_WIDTH / 2,
        y: (pos?.y ?? 0) - NODE_HEIGHT / 2,
      },
      draggable: false,
      selectable: true,
      data: {
        step,
        status: prog?.status ?? null,
        attempts: typeof prog?.attempts === 'number' ? prog.attempts : null,
        isCurrent: currentStepId === step.id,
        isSelected: selectedStepId === step.id,
        onInspect,
      },
    };
  });

  return { nodes, edges };
}

export interface BioHarnessPlanGraphProps {
  steps: PlanStep[];
  progressSteps?: StepProgress[];
  currentStepId: string | null;
  selectedStepId: string | null;
  onSelectStep: (stepId: string) => void;
  fullscreen: boolean;
}

const BioHarnessPlanGraph = memo(function BioHarnessPlanGraph({
  steps,
  progressSteps,
  currentStepId,
  selectedStepId,
  onSelectStep,
  fullscreen,
}: BioHarnessPlanGraphProps) {
  const { nodes, edges } = useMemo(
    () => layoutPlanGraph(steps, progressSteps, currentStepId, selectedStepId, onSelectStep),
    [steps, progressSteps, currentStepId, selectedStepId, onSelectStep],
  );

  return (
    <div
      data-testid="bh-plan-graph-canvas"
      className={cn(
        'border-border-light bg-surface-primary/40 w-full overflow-hidden rounded-xl border',
        fullscreen ? 'h-[calc(100vh-140px)]' : 'h-[520px] min-h-[380px]',
      )}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={true}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_event, node) => onSelectStep(node.id)}
      >
        <Background gap={18} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
});

export default BioHarnessPlanGraph;
