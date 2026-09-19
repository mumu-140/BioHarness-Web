# BioHarness Web Observatory V1 Validation — 2026-09-19

Status: executable V1 acceptance evidence for the read-only observatory only.

## Revisions

- BioHarness-Web implementation revision: `923d7de30e18263d9b2aa0931505fa4ea7d0e5fe`
- BioHarness merged main containing the reference execution model: `e827add23b4640478dd291409e66175309be6c39`
- Genome-web TF live3 source data was produced during the audited BioHarness reference acceptance before squash merge; the acceptance implementation revision recorded for that run was `5e9b52c99c8c9e09494d5aed1394a5368d4a09a5`.
- Genome-web audited provider revision for that source run: `05072cbbcd533ca59afa13996d8d0edd8f939c6e`

The Web validation reads the already-isolated BioHarness `live3` acceptance database. It does not execute Genome-web and does not write provider scientific outputs.

## Isolation and deployment

Allowed deployment/write root: `/home/yangs/software/BioHarness-Web/**`

Deployment host: `fwq10ys`

Final container: `bioharness-web-observatory`

Final image: `sha256:5d93d2d3c45e7a0472b5253ddff5e3e7f9e0f149caaa293c1c7d015f80e6a3e7`

Server binding: `127.0.0.1:18080 -> container 8080`

The container is run with:

- `--read-only`
- a small `/tmp` tmpfs
- no writable BioHarness source mount
- no writable Genome-web source/data mount
- no provider scientific-output mount
- PostgreSQL access only through the dedicated Web role

The previous deployment container is retained stopped as `bioharness-web-observatory-prev-14b0df9` for rollback.

Client access is through an SSH tunnel. The verified Mac listener is `127.0.0.1:18080 -> fwq10ys 127.0.0.1:18080`.

## Database authority boundary

Database source for V1 demonstration:

- container: `bioharness-p0-postgres-live3`
- database: `bioharness_live3`
- Web role: `bioharness_web`

Observed:

- `SHOW default_transaction_read_only` -> `on`
- `SELECT count(*) FROM scientific_task_specs` -> `2`
- `CREATE TABLE observatory_write_probe(id integer)` -> rejected with `cannot execute CREATE TABLE in a read-only transaction`

The role was granted CONNECT, schema USAGE, and SELECT. CREATE and table write privileges were revoked.

The backend additionally executes `SET TRANSACTION READ ONLY` for each projection read transaction.

## TDD evidence

The read-only database contract was proven with the same test in both directions:

- admin connection RED: `default_transaction_read_only = off`
- dedicated Web role GREEN: test passed

Final review defects were also fixed through RED -> GREEN:

1. terminal execution `finished_at` incorrectly used submission time;
2. SSE invalidation revision used only `TaskSummary`, so pure RunEvent changes could be missed;
3. an already-open node detail drawer did not refetch on `task.updated`;
4. Memory detail exposed unrelated global `MemoryCandidate` rows.

Observed RED failures were preserved during execution; each focused regression then passed after the minimal fix.

## Final automated verification

Backend: `24 passed in 0.85s`

Frontend:

- 4 test files passed
- 9 tests passed
- strict TypeScript build passed
- Vite production build passed
- 196 modules transformed

Production frontend dependency audit: `npm audit --omit=dev --audit-level=moderate` -> `found 0 vulnerabilities`

Production Docker image build: PASS, image ID recorded above.

## Live smoke verification

`GET /api/health`: `{"status":"ok","service":"BioHarness Observatory"}`

`GET /api/tasks`:

- returned 2 actual BioHarness acceptance tasks;
- the negative cross-UID resolution task projects as WAITING / TASK;
- the successful Genome-web TF reference task projects as FINISHED / VALIDATION.

Successful task graph: `TASK -> DATA -> ASSESSMENT -> PLANNING -> POLICY -> EXECUTION -> COLLECTION -> VALIDATION`

Execution node:

- state: `FINISHED`
- event count exposed in detail: `37`
- terminal `finished_at`: `2026-09-18T17:44:46.620680Z`
- this matches the persisted last reconciliation time rather than submission time

SSE: `GET /api/stream` emitted `task.updated` invalidations for both tasks. The 4-second curl probe ended with timeout code 28 because SSE is intentionally a long-lived connection; data was received before timeout.

Mac tunnel smoke:

- local listener exists on `127.0.0.1:18080`
- local `/api/health` returned status `ok`
- local `/` returned `<title>BioHarness Observatory</title>`

## Whole-branch review

Reviewed specifically for:

- write-capable database code;
- direct Python imports from BioHarness Core;
- Genome-web/provider source coupling;
- unsafe HTML/eval/XSS surfaces;
- fabricated private reasoning or memory usage;
- SSE lifecycle/refetch semantics;
- task graph aggregation semantics.

Observed static checks:

- no production INSERT/UPDATE/DELETE/TRUNCATE/DDL statements;
- no `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or `new Function`;
- no imports from BioHarness Core packages;
- no direct Genome-web source coupling in backend/frontend;
- no database URL/password exposed by frontend/API health surface.

Important findings were fixed in the single final review fix pass described above.

## V1 scope

V1 provides:

- left task sidebar;
- selected task dynamic stage graph;
- node click -> detail drawer;
- task/status filtering;
- read-only event/artifact/validation/memory drill-down;
- SSE invalidation-driven refresh;
- explicit stale/disconnected state;
- one-container deployment.

V1 intentionally does not provide:

- task creation or editing;
- start/retry/cancel/reconcile controls;
- policy approval;
- memory promotion;
- canonical publication;
- private chain-of-thought display;
- arbitrary server filesystem browsing;
- direct provider execution.

BioHarness remains the authority plane. BioHarness-Web remains a disposable observer.
