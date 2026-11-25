import { describe, expect, it } from "vitest";

import { layoutGraph } from "./layout";

const node = (id: string) => ({ id, width: 200, height: 80 });

describe("layoutGraph", () => {
  it("places a step after the step it depends on", () => {
    const positions = layoutGraph(
      [node("b"), node("a"), node("c")],
      [
        { source: "a", target: "b" },
        { source: "b", target: "c" },
      ],
      "LR",
    );
    expect(positions.get("a")!.x).toBeLessThan(positions.get("b")!.x);
    expect(positions.get("b")!.x).toBeLessThan(positions.get("c")!.x);
  });

  it("lays a tree out top to bottom", () => {
    const positions = layoutGraph([node("root"), node("child")], [{ source: "root", target: "child" }], "TB");
    expect(positions.get("root")!.y).toBeLessThan(positions.get("child")!.y);
  });

  it("ignores an edge that names a node which is not present", () => {
    const alone = layoutGraph([node("a")], [], "LR");
    const positions = layoutGraph([node("a")], [{ source: "missing", target: "a" }], "LR");
    // the unknown node neither becomes part of the layout nor moves the real one
    expect(positions).toEqual(alone);
    expect(Number.isFinite(positions.get("a")!.x)).toBe(true);
  });
});
