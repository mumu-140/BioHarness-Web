import {
  Background,
  Controls,
  MarkerType,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";

import type {
  NodeStatus,
  TaskGraphModel,
  TaskNode,
} from "../api/types";

interface TaskGraphProps {
  graph: TaskGraphModel;
  onSelectNode(nodeId: string): void;
}

function statusLabel(status: NodeStatus): string {
  if (status === "ACTIVE") return "RUNNING";
  if (status === "ATTENTION") return "NEEDS ATTENTION";
  return status;
}

function GraphNodeLabel({ node }: { node: TaskNode }) {
  return (
    <div className="flow-node-content">
      <span className="flow-node-type">{node.type}</span>
      <strong>{node.label}</strong>
      <span className={"flow-node-status status-" + node.status.toLowerCase()}>
        {statusLabel(node.status)}
      </span>
    </div>
  );
}

function toFlowNodes(graph: TaskGraphModel): Node[] {
  return graph.nodes.map((node, index) => ({
    id: node.id,
    position: { x: 260, y: index * 150 },
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

export default function TaskGraph({
  graph,
  onSelectNode,
}: TaskGraphProps) {
  const canRenderFlow = typeof globalThis.ResizeObserver !== "undefined";

  if (!canRenderFlow) {
    return (
      <div className="graph-fallback" aria-label="Task graph">
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
              <span>{node.type}</span>
              <strong>{node.label}</strong>
              <em>{statusLabel(node.status)}</em>
            </button>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="task-graph" aria-label="Task graph">
      <ReactFlow
        nodes={toFlowNodes(graph)}
        edges={toFlowEdges(graph)}
        fitView
        fitViewOptions={{ padding: 0.25 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        onNodeClick={(_, node) => onSelectNode(node.id)}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
