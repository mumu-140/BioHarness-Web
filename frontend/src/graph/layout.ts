import dagre from "@dagrejs/dagre";

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
}

export interface LayoutEdge {
  source: string;
  target: string;
}

/** Top-left positions for a directed layout. Edges naming an absent node are ignored. */
export function layoutGraph(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  direction: "LR" | "TB",
): Map<string, { x: number; y: number }> {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({ rankdir: direction, nodesep: 36, ranksep: 72, marginx: 24, marginy: 24 });
  graph.setDefaultEdgeLabel(() => ({}));
  const known = new Set(nodes.map((node) => node.id));
  for (const node of nodes) graph.setNode(node.id, { width: node.width, height: node.height });
  for (const edge of edges) {
    if (known.has(edge.source) && known.has(edge.target)) graph.setEdge(edge.source, edge.target);
  }
  dagre.layout(graph);
  const positions = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    const placed = graph.node(node.id);
    positions.set(node.id, { x: placed.x - node.width / 2, y: placed.y - node.height / 2 });
  }
  return positions;
}
