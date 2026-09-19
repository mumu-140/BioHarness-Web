import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";

import type { TaskGraphModel, TaskNode } from "../api/types";
import { nodeTitle, stageLabel, statusLabel } from "../presentation";

interface TaskGraphProps {
  graph: TaskGraphModel;
  onSelectNode(nodeId: string): void;
}

type WorkflowPhase = "prepare" | "execute" | "verify";

function phaseForNode(node: TaskNode): WorkflowPhase {
  if (node.type === "EXECUTION" || node.type === "COLLECTION") {
    return "execute";
  }
  if (node.type === "VALIDATION" || node.type === "RESULT") {
    return "verify";
  }
  return "prepare";
}

export function horizontalPosition(index: number) {
  return { x: index * 300, y: 120 };
}

function currentNodeId(graph: TaskGraphModel): string | null {
  return (
    graph.nodes.find((node) => node.type === graph.task.stage)?.id ??
    graph.nodes.find((node) => node.status === "ACTIVE")?.id ??
    graph.nodes.find((node) => node.status === "ATTENTION")?.id ??
    graph.nodes[0]?.id ??
    null
  );
}

function nodeClassName(node: TaskNode, isCurrent: boolean): string {
  const classes = [
    "flow-node",
    "node-" + node.status.toLowerCase(),
    "phase-" + phaseForNode(node),
  ];
  if (isCurrent) classes.push("node-current");
  if (node.status === "ATTENTION" || node.status === "FAILED") {
    classes.push("node-problem");
  }
  return classes.join(" ");
}

function GraphNodeLabel({
  node,
  isCurrent,
}: {
  node: TaskNode;
  isCurrent: boolean;
}) {
  return (
    <div className="flow-node-content">
      <div className="flow-node-heading">
        <span className="flow-node-type">{stageLabel(node.type)}</span>
        {isCurrent && <span className="current-stage-badge">当前阶段</span>}
      </div>
      <strong>{nodeTitle(node)}</strong>
      {node.label && node.label !== nodeTitle(node) && (
        <code className="flow-node-technical">{node.label}</code>
      )}
      {node.annotation && (
        <span className="flow-node-annotation">{node.annotation}</span>
      )}
      {node.warning && (
        <span className="flow-node-warning">{node.warning}</span>
      )}
      <span className={"flow-node-status status-" + node.status.toLowerCase()}>
        {statusLabel(node.status)}
      </span>
    </div>
  );
}

function toFlowNodes(graph: TaskGraphModel): Node[] {
  const currentId = currentNodeId(graph);
  return graph.nodes.map((node, index) => {
    const isCurrent = node.id === currentId;
    return {
      id: node.id,
      position: horizontalPosition(index),
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: { label: <GraphNodeLabel node={node} isCurrent={isCurrent} /> },
      className: nodeClassName(node, isCurrent),
    };
  });
}

function toFlowEdges(graph: TaskGraphModel): Edge[] {
  return graph.edges.map((edge, index) => ({
    id: "edge-" + index + "-" + edge.source + "-" + edge.target,
    source: edge.source,
    target: edge.target,
    markerEnd: { type: MarkerType.ArrowClosed },
    className: "flow-edge",
  }));
}

function FallbackGraph({
  graph,
  onSelectNode,
}: TaskGraphProps) {
  const currentId = currentNodeId(graph);

  return (
    <div className="graph-fallback">
      {graph.nodes.map((node, index) => {
        const isCurrent = node.id === currentId;
        return (
          <div key={node.id} className="fallback-step">
            {index > 0 && (
              <span className="fallback-arrow" aria-hidden="true">→</span>
            )}
            <button
              type="button"
              className={"fallback-node " + nodeClassName(node, isCurrent)}
              onClick={() => onSelectNode(node.id)}
            >
              <div className="flow-node-heading">
                <span>{stageLabel(node.type)}</span>
                {isCurrent && <span className="current-stage-badge">当前阶段</span>}
              </div>
              <strong>{nodeTitle(node)}</strong>
              {node.label && node.label !== nodeTitle(node) && (
                <code>{node.label}</code>
              )}
              {node.annotation && (
                <span className="flow-node-annotation">{node.annotation}</span>
              )}
              {node.warning && (
                <span className="flow-node-warning">{node.warning}</span>
              )}
              <em>{statusLabel(node.status)}</em>
            </button>
          </div>
        );
      })}
    </div>
  );
}

export default function TaskGraph({
  graph,
  onSelectNode,
}: TaskGraphProps) {
  const canRenderFlow = typeof globalThis.ResizeObserver !== "undefined";
  const flowNodes = toFlowNodes(graph);
  const currentId = currentNodeId(graph);
  const currentFlowNode = currentId
    ? flowNodes.find((node) => node.id === currentId)
    : undefined;

  return (
    <div
      className="task-graph-frame"
      aria-label="任务流程图"
      data-direction="horizontal"
    >
      <div className="phase-legend" aria-label="流程分区">
        <span className="phase-chip phase-prepare">准备与解析</span>
        <span className="phase-chip phase-execute">执行与收集</span>
        <span className="phase-chip phase-verify">验证与结果</span>
      </div>
      <div className="graph-hint">
        默认定位当前阶段 · 左下角小地图查看全链路 · 右下角控件可显示全部
      </div>

      {canRenderFlow ? (
        <ReactFlow
          key={graph.task.id}
          nodes={flowNodes}
          edges={toFlowEdges(graph)}
          fitView
          fitViewOptions={{
            nodes: currentFlowNode ? [currentFlowNode] : undefined,
            padding: 1.4,
            minZoom: 0.55,
            maxZoom: 0.9,
          }}
          minZoom={0.25}
          maxZoom={1.35}
          panOnScroll
          zoomOnScroll={false}
          zoomOnPinch
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          onNodeClick={(_, node) => onSelectNode(node.id)}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} size={1} />
          <MiniMap
            pannable
            zoomable
            position="bottom-left"
            className="workflow-minimap"
          />
          <Controls
            showInteractive={false}
            fitViewOptions={{ padding: 0.18, maxZoom: 0.9 }}
          />
        </ReactFlow>
      ) : (
        <FallbackGraph graph={graph} onSelectNode={onSelectNode} />
      )}
    </div>
  );
}
