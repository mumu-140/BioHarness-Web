# BioHarness Web Observatory V1.3 — 2026-09-19

Status: pre-merge validation evidence for phase grouping and execution-context readability.

## Scope

This refinement keeps the graph stage-level and read-only.

It adds:

- three visual workflow phases: `准备与解析`, `执行与收集`, `验证与结果`;
- matching phase accents on stage nodes;
- typed execution context on the existing execution node:
  - `attempt_number`
  - `attempt_count`
  - `attention_reason`
- Chinese rendering of retry context and reconciliation warnings in the frontend.

It intentionally does **not** turn individual RunEvents or historical attempts into graph nodes. Historical attempts remain drill-down detail, consistent with the repository rule that the main graph stays stage-level.

## Typed boundary

The backend API remains presentation-neutral for execution context.

Example machine-readable projection:

```json
{
  "attempt_number": 2,
  "attempt_count": 2,
  "attention_reason": "reconciliation_required"
}
```

The frontend renders this as:

`第 2 次尝试 · 共 2 次`

and:

`需要人工核验`

This avoids embedding Chinese UI copy into the backend persistence/projection contract.

## TDD and remote verification

Target host: `fwq10ys`.

Frontend:

- 4 test files passed;
- 12 tests passed;
- strict TypeScript build passed;
- Vite production build passed;
- 197 modules transformed.

Backend:

- 24 tests passed;
- 1 environment-dependent database test skipped.

## Container build note

A clean production Docker build was attempted after the source tests passed.

The build reached dependency-install layers and failed inside Docker BuildKit during `npm ci` with:

`npm error Exit handler never called!`

The Python dependency-install layer was canceled when the parallel frontend layer failed.

This is classified as an execution-environment/dependency-install failure rather than a source regression because:

- the same frontend dependency tree was already present in the approved Node 22 development image;
- `npm test -- --run` passed there;
- `npm run build` passed there;
- backend regression passed independently.

Deployment, if performed before the clean dependency build path is repaired, must reuse the already-validated V1.2 runtime dependencies and overlay only the tested backend source and frontend static bundle. That workaround must stay deployment-local and must not weaken the repository Dockerfile contract.

## Safety boundary

No mutation endpoint, provider execution, policy approval, memory promotion, canonical publication, or database write capability is added.
