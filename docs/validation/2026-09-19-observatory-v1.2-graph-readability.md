# BioHarness Web Observatory V1.2 Graph Readability — 2026-09-19

Status: pre-merge validation evidence for the read-only observatory UI refinement.

## Scope

This change is intentionally limited to task-graph readability:

- keep the workflow left-to-right;
- make the current BioHarness stage visually explicit;
- distinguish attention/failed nodes from normal stages;
- default the React Flow viewport to the current stage instead of shrinking a long chain to fit;
- add a pannable/zoomable minimap for whole-chain context;
- keep the existing fit-all control for returning to the complete route;
- preserve the read-only authority boundary and existing node-detail behavior.

No BioHarness mutation API, provider execution, policy action, memory promotion, or publication behavior is added.

## TDD

The focused graph test was extended first to require:

- the node matching `task.stage` to receive `node-current`;
- the current node to show the Chinese `当前阶段` badge;
- an attention node to retain a distinct attention class.

Implementation then added the minimal graph and styling changes.

## Remote verification

Target host: `fwq10ys`.

Frontend, executed in the existing Node 22 development image:

- 4 test files passed;
- 11 tests passed;
- strict TypeScript build passed;
- Vite production build passed;
- 197 modules transformed.

Backend regression, executed in the existing Python 3.12 development image with the repository mounted read-only:

- 23 passed;
- 1 skipped.

Production image build:

- tag: `bioharness-web:observatory-v1.2-test`
- image: `sha256:6e36cd7f81bd92250443a2b16a2c2445d74526ded47b3b86e1c37ef48612ca5a`

## Expected UI behavior

For normal browser rendering with ResizeObserver support:

- the initial viewport centers on the stage represented by `task.stage`;\n- switching to another task remounts the flow viewport and refocuses that task's current stage, while same-task SSE refreshes do not intentionally reset the viewport;
- the full workflow remains visible in the lower-left minimap;
- the standard lower-right controls can fit the complete route;
- current-stage and problem-stage visual signals remain independent, so a current stage that also needs attention can show both semantics.

The non-ReactFlow fallback remains horizontally scrollable and carries the same current-stage and problem-node semantics.
