import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { type ReactNode, useMemo } from "react";

import { layoutGraph } from "../graph/layout";

export interface CanvasNode {
  id: string;
  content: ReactNode;
  className?: string;
}

export interface CanvasEdge {
  source: string;
  target: string;
  /** Dashed edges are contextual links, never prerequisites. */
  contextual?: boolean;
  label?: string;
}

interface GraphCanvasProps {
  label: string;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  direction: "LR" | "TB";
  selectedId: string | null;
  onSelect(id: string): void;
  nodeWidth?: number;
  nodeHeight?: number;
}

type CardData = { content: ReactNode; direction: "LR" | "TB" };

/**
 * Structural edges enter and leave along the layout direction. Contextual
 * links use two extra handles on the side, so they never lie on top of a
 * structural edge between the same two nodes.
 */
function CardNode({ data }: NodeProps<Node<CardData>>) {
  const horizontal = data.direction === "LR";
  const side = horizontal ? Position.Bottom : Position.Right;
  const offset = (share: string) => (horizontal ? { left: share } : { top: share });
  return (
    <>
      <Handle type="target" position={horizontal ? Position.Left : Position.Top} isConnectable={false} />
      {data.content}
      <Handle type="source" position={horizontal ? Position.Right : Position.Bottom} isConnectable={false} />
      <Handle type="source" id="context-out" position={side} style={offset("35%")} isConnectable={false} />
      <Handle type="target" id="context-in" position={side} style={offset("65%")} isConnectable={false} />
    </>
  );
}

const NODE_TYPES = { card: CardNode };

export default function GraphCanvas({
  label,
  nodes,
  edges,
  direction,
  selectedId,
  onSelect,
  nodeWidth = 240,
  nodeHeight = 116,
}: GraphCanvasProps) {
  const flowNodes = useMemo<Node[]>(() => {
    const positions = layoutGraph(
      nodes.map((node) => ({ id: node.id, width: nodeWidth, height: nodeHeight })),
      edges.filter((edge) => !edge.contextual),
      direction,
    );
    return nodes.map((node) => ({
      id: node.id,
      type: "card",
      position: positions.get(node.id) ?? { x: 0, y: 0 },
      data: { content: node.content, direction },
      // Fixed size: the layout, the canvas and the minimap all use the same box.
      width: nodeWidth,
      height: nodeHeight,
      className:
        "graph-node " + (node.className ?? "") + (node.id === selectedId ? " is-selected" : ""),
    }));
  }, [nodes, edges, direction, selectedId, nodeWidth, nodeHeight]);

  const flowEdges = useMemo<Edge[]>(
    () =>
      edges.map((edge, index) => ({
        id: `e${index}-${edge.source}-${edge.target}`,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        sourceHandle: edge.contextual ? "context-out" : undefined,
        targetHandle: edge.contextual ? "context-in" : undefined,
        markerEnd: edge.contextual ? undefined : { type: MarkerType.ArrowClosed },
        className: edge.contextual ? "graph-edge is-contextual" : "graph-edge",
      })),
    [edges],
  );

  // React Flow needs a measured viewport; without one (tests, very old
  // browsers) the same nodes are offered as a plain list.
  if (typeof globalThis.ResizeObserver === "undefined") {
    return (
      <div className="graph-fallback" aria-label={label}>
        {nodes.map((node) => (
          <button
            type="button"
            key={node.id}
            className={
              "graph-node " + (node.className ?? "") + (node.id === selectedId ? " is-selected" : "")
            }
            aria-pressed={node.id === selectedId}
            onClick={() => onSelect(node.id)}
          >
            {node.content}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="graph-canvas" aria-label={label}>
      <ReactFlow
        // A different set of nodes is a different graph: mount it afresh so it is fitted to the view.
        key={nodes.map((node) => node.id).join("\u0000")}
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.2}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        onNodeClick={(_, node) => onSelect(node.id)}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} />
        <MiniMap pannable zoomable position="bottom-right" nodeColor="#9fb3c8" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
