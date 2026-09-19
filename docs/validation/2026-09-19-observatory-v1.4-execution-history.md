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


## Post-merge deployment evidence

Merged `main` revision:

`568dde04ec59c3fb02b561998038435f4c619d7c`

Deployment reused the already-validated V1.3 runtime dependencies and overlaid only the tested V1.4 frontend static bundle:

- base runtime image: `bioharness-web:observatory-v1.3`;
- no backend source or dependency version changed in V1.4;
- overlay build ran with `--network none`.

Deployed V1.4 image:

`sha256:a9dc9a0d4f0360ce9f26614220d4916ccc6005fc9a2487a0de0c32d7e95b4adf`

Pre-production smoke on `127.0.0.1:18081`:

- `/api/health` -> 200;
- `/api/tasks` -> 200;
- production bundle contained `执行历史`, `再次尝试`, `当前尝试`, and `外部执行名称`;
- container root filesystem remained read-only.

Production replacement on `fwq10ys`:

- bind remains `127.0.0.1:18080`;
- `/api/health` -> 200;
- `/api/tasks` -> 200;
- deployed image matches the V1.4 image digest above;
- root filesystem remains read-only;
- rollback container retained as `bioharness-web-observatory-prev-v13-568dde0`.
