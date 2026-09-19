import {
  Background,
  Controls,
  MarkerType,
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

export function horizontalPosition(index: number) {
  return { x: index * 300, y: 120 };
}

function GraphNodeLabel({ node }: { node: TaskNode }) {
  return (
    <div className="flow-node-content">
      <span className="flow-node-type">{stageLabel(node.type)}</span>
      <strong>{nodeTitle(node)}</strong>
      {node.label && node.label !== nodeTitle(node) && (
        <code className="flow-node-technical">{node.label}</code>
      )}
      <span className={"flow-node-status status-" + node.status.toLowerCase()}>
        {statusLabel(node.status)}
      </span>
    </div>
  );
}

function toFlowNodes(graph: TaskGraphModel): Node[] {
  return graph.nodes.map((node, index) => ({
    id: node.id,
    position: horizontalPosition(index),
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    data: { label: <GraphNodeLabel node={node} /> },
    className: "flow-node node-" + node.status.toLowerCase(),
  }));
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
  return (
    <div className="graph-fallback">
      {graph.nodes.map((node, index) => (
        <div key={node.id} className="fallback-step">
          {index > 0 && (
            <span className="fallback-arrow" aria-hidden="true">→</span>
          )}
          <button
            type="button"
            className={"fallback-node node-" + node.status.toLowerCase()}
            onClick={() => onSelectNode(node.id)}
          >
            <span>{stageLabel(node.type)}</span>
            <strong>{nodeTitle(node)}</strong>
            {node.label && node.label !== nodeTitle(node) && (
              <code>{node.label}</code>
            )}
            <em>{statusLabel(node.status)}</em>
          </button>
        </div>
      ))}
    </div>
  );
}

export default function TaskGraph({
  graph,
  onSelectNode,
}: TaskGraphProps) {
  const canRenderFlow = typeof globalThis.ResizeObserver !== "undefined";

  return (
    <div
      className="task-graph-frame"
      aria-label="任务流程图"
      data-direction="horizontal"
    >
      <div className="graph-hint">
        横向流程 · 拖动空白处平移 · 使用右下角控件缩放或适配全部节点
      </div>

      {canRenderFlow ? (
        <ReactFlow
          nodes={toFlowNodes(graph)}
          edges={toFlowEdges(graph)}
          fitView
          fitViewOptions={{ padding: 0.18, maxZoom: 0.9 }}
          minZoom={0.35}
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
          <Controls showInteractive={false} />
        </ReactFlow>
      ) : (
        <FallbackGraph graph={graph} onSelectNode={onSelectNode} />
      )}
    </div>
  );
}
