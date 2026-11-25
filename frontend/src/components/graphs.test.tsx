import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NowData, TreeData } from "../api/types";
import { NOW, TREE } from "../test/fixtures";
import type { CanvasEdge, CanvasNode } from "./GraphCanvas";
import ResearchTreeGraph from "./ResearchTreeGraph";
import WorkflowGraph from "./WorkflowGraph";

// The canvas itself is exercised in a real browser (tests/browser). Here the
// question is which nodes and edges each view derives from the owner's answer.
const drawn: { nodes: CanvasNode[]; edges: CanvasEdge[]; direction: string }[] = [];

vi.mock("./GraphCanvas", () => ({
  default: (props: { nodes: CanvasNode[]; edges: CanvasEdge[]; direction: string }) => {
    drawn.push(props);
    return null;
  },
}));

const last = () => drawn[drawn.length - 1];
const plain = (edges: CanvasEdge[]) =>
  edges.map((edge) => [edge.source, edge.target, edge.contextual ? "context" : "structure"]);

beforeEach(() => {
  drawn.length = 0;
});

describe("ResearchTreeGraph", () => {
  it("draws one structural edge per recorded parent and related links as context only", () => {
    render(<ResearchTreeGraph tree={TREE as TreeData} selectedScopeId={null} onSelectScope={() => {}} />);
    expect(last().direction).toBe("TB");
    expect(last().nodes.map((node) => node.id)).toEqual(["dap", "dap-branch"]);
    expect(plain(last().edges)).toEqual([
      ["dap", "dap-branch", "structure"],
      ["dap-branch", "dap", "context"],
    ]);
  });

  it("draws no edge for a related request that is not in this project view", () => {
    const tree = {
      ...TREE,
      related_requests: [
        { source_request_id: "sci-2", target_request_id: "sci-elsewhere", type: "RELATED", target_available: false },
      ],
    } as TreeData;
    render(<ResearchTreeGraph tree={tree} selectedScopeId={null} onSelectScope={() => {}} />);
    expect(plain(last().edges)).toEqual([["dap", "dap-branch", "structure"]]);
  });
});

describe("WorkflowGraph", () => {
  it("draws exactly the declared depends_on edges, from prerequisite to dependent step", () => {
    render(<WorkflowGraph now={NOW as NowData} selectedStepId={null} onSelectStep={() => {}} />);
    expect(last().direction).toBe("LR");
    expect(last().nodes.map((node) => node.id)).toEqual(["inputs", "call"]);
    expect(plain(last().edges)).toEqual([["inputs", "call", "structure"]]);
  });

  it("adds no edge between steps that declare no dependency", () => {
    const now = {
      ...NOW,
      plan: { ...NOW.plan, steps: NOW.plan.steps.map((step) => ({ ...step, depends_on: undefined })) },
    } as NowData;
    render(<WorkflowGraph now={now} selectedStepId={null} onSelectStep={() => {}} />);
    expect(last().edges).toEqual([]);
  });
});
