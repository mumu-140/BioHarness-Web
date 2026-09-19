# BioHarness Web Observatory V1.4 — Execution History Timeline

Status: pre-merge validation evidence for the execution-node history view.

## Scope

This refinement keeps the main task graph stage-level and adds a compact execution timeline only inside the execution-node detail drawer.

The timeline uses already persisted observatory data:

- `summary.attempt_history`;
- `summary.current_attempt`;
- persisted RunEvents matched by `run_attempt_id`.

It does not invent hidden reasoning, infer provider-internal state, or create synthetic graph nodes.

## Readable behavior

For an execution with multiple attempts, the drawer shows:

- `尝试 1`, `尝试 2`, ... in chronological order;
- the external execution name when present;
- localized attempt state;
- submit and latest reconciliation timestamps;
- `当前尝试` on the current attempt;
- a visible `再次尝试` transition between attempts;
- up to four persisted event labels associated with each attempt.

Example readable path:

`尝试 1 · 失败 → 再次尝试 → 尝试 2 · 当前尝试 · 需要人工核验`

Low-level events remain evidence within the attempt card and in the existing recent-events section; they are not promoted to top-level task-graph nodes.

## Compatibility behavior

If an older or partial detail payload contains `current_attempt` but no `attempt_history`, the existing generic human-readable rendering is preserved. This prevents the execution identity from disappearing for incomplete/legacy projections.

## TDD

Initial focused implementation produced two RED regressions:

1. the dedicated timeline hid the existing `当前尝试` / `外部执行名称` readable labels;
2. execution detail payloads with `current_attempt` but without `attempt_history` lost their execution identity in the drawer.

The fix:

- moved the readable labels into the attempt card;
- suppresses the generic attempt blocks only when a non-empty timeline is actually available.

## Remote verification

Target host: `fwq10ys`.

Frontend:

- 4 test files passed;
- 13 tests passed;
- TypeScript build passed;
- Vite production build passed;
- 197 modules transformed.

Backend regression:

- 24 passed;
- 1 environment-dependent database test skipped.

No backend schema or projection contract change is required for V1.4.

## Safety boundary

No task mutation, execution control, provider call, policy action, memory promotion, publication action, or database write capability is added.
