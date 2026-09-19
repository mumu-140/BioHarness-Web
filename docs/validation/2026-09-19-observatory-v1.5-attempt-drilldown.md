# BioHarness Web Observatory V1.5 — Attempt Drill-down

Status: pre-merge validation evidence for per-attempt execution inspection.

## Source audit

Before implementing the UI, the upstream BioHarness runtime contract was checked on `mumu-140/BioHarness@main`.

Relevant persisted semantics:

- `RunAttempt.capability_snapshot` records executor capabilities at attempt allocation time;
- `RunAttempt.binding` records the external/local execution binding when available;
- `RunAttempt.observed_runtime_environment` and `observed_resource_allocation` are persisted attempt-scoped runtime observations;
- `RunEvent.payload` is persisted evidence, not transient UI state;
- `ReconciliationService` writes `ReconciliationRequired` / `ReconciliationResolved` payloads with:
  - `actor`
  - `process_probe`
  - `executor_evidence`
- `ExecutionEvidence` contains:
  - `active`
  - `terminal_outcome`
  - `exit_code`
  - `evidence`

Therefore the V1.5 UI can explain reconciliation from persisted BioHarness evidence without inventing provider-internal state or hidden reasoning.

## Scope

V1.5 keeps the main task graph and the V1.4 attempt timeline compact.

Each attempt now has an explicit `展开详情` control. Only one attempt drill-down is expanded at a time.

The expanded panel shows, when persisted:

- executor capability snapshot, including logs / trace / poll / cancellation / disconnect reconciliation support;
- observed runtime environment;
- observed resource allocation;
- execution binding;
- all persisted events belonging to that attempt, ordered by `sequence_no`;
- event timestamp and raw event type;
- human-readable reconciliation explanation for `ReconciliationRequired`;
- the actual reconciliation evidence fields;
- raw persisted event payload behind an expandable `原始 payload` disclosure.

No RunEvent is promoted into the top-level task graph.

## Projection change

The Web read-only projection now keeps attempt-scoped persisted fields in each `attempt_history` item:

- `executor_namespace`
- `capability_snapshot`
- `binding`
- `observed_runtime_environment`
- `observed_resource_allocation`

This is additive. Existing attempt-history fields remain unchanged.

## Reconciliation wording

The UI does not claim a hidden causal reason.

For a `ReconciliationRequired` event where:

- process probe is unavailable;
- executor `active` is unknown;
- terminal outcome is unknown;
- exit code is unknown;

the UI renders:

`自动探测无法确认执行终态`

and immediately shows the underlying persisted probe/executor evidence. Other `ReconciliationRequired` payloads use the more general wording:

`自动核验未能确认确定的执行终态`

## TDD

RED was verified remotely first:

- frontend attempt-drilldown test failed because no attempt expand control existed;
- backend projection test failed with missing `capability_snapshot` in `attempt_history`.

After implementation, the full suite passed.

## Remote verification

Target host: `fwq10ys`.

Frontend:

- 4 test files passed;
- 14 tests passed;
- TypeScript build passed;
- Vite production build passed;
- 197 modules transformed.

Backend:

- 25 tests passed;
- 1 environment-dependent database test skipped.

## Safety boundary

The observatory remains read-only.

V1.5 adds no task mutation, execution control, provider invocation, reconciliation action, policy action, memory mutation, publication action, or database write capability.


## Post-merge deployment evidence

Merged `main` revision:

`b2dba2a36840dfa1639ece55d9e5ced817420f5f`

Deployment reused the already-validated V1.4 runtime dependencies and overlaid only the tested V1.5 backend source and frontend static bundle:

- base runtime image: `bioharness-web:observatory-v1.4`;
- overlay explicitly copies `/app/backend` and `/app/static`;
- `PYTHONPATH=/app/backend` keeps the tested backend source authoritative over the installed base package;
- no dependency version changed;
- overlay image build ran with `--network none`.

Deployed V1.5 image:

`sha256:5c58c79202c5d6bb857482c759ead675da5f4a8ac77848c41cbab1978278204f`

Pre-production smoke on `127.0.0.1:18081`:

- `/api/health` -> 200;
- `/api/tasks` -> 200;
- production bundle contained `展开详情`, `事件时间线`, `核验依据`, `原始 payload`, and `执行器能力`;
- a live execution-node detail contained all new attempt-history projection keys:
  - `capability_snapshot`
  - `binding`
  - `observed_runtime_environment`
  - `observed_resource_allocation`
- container root filesystem remained read-only.

Production replacement on `fwq10ys`:

- bind remains `127.0.0.1:18080`;
- `/api/health` -> 200;
- `/api/tasks` -> 200;
- live execution detail confirmed `PROJECTION_KEYS_OK=true`;
- deployed image matches the V1.5 image digest above;
- root filesystem remains read-only;
- rollback container retained as `bioharness-web-observatory-prev-v14-b2dba2a`.
