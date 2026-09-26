> Historical source record migrated from `mumu-140/BioHarness@docs/bioharness-web-observatory-design:docs/superpowers/specs/2026-09-19-bioharness-web-observatory-design.md` on 2026-09-26.\n> This design specification predates the current BioHarness-Web V1.7 implementation and is preserved for design provenance; current behavior is defined by the live repository documentation and code.\n\n# BioHarness Web Observatory — Design Specification

Date: 2026-09-19  
Status: DESIGN REVIEW  
Target implementation repository: `mumu-140/BioHarness-Web`

## 1. Purpose

Build a small, independent, read-only Web interface for observing BioHarness scientific tasks.

The homepage has two primary regions:

1. a task list/sidebar on the left;
2. a dynamic task graph/route on the right.

Selecting a task replaces the graph with that task's current route. Selecting a graph node opens the detail for that node. Raw events, artifacts, validation records, memory records, and execution metadata are shown only after drilling into a node; they are not all rendered simultaneously on the homepage.

The Web application is an observer, not an authority plane.

BioHarness remains responsible for scientific state, authorization, execution, validation, and persistence.

## 2. Scope

### 2.1 V1 includes

- task sidebar;
- task status summary;
- one dynamic graph for the selected task;
- clickable graph nodes;
- node detail drawer;
- execution/event detail reached from a node;
- memory detail reached from a node;
- artifact/validation detail reached from a node;
- near-real-time updates through Server-Sent Events;
- explicit disconnected/stale state;
- read-only PostgreSQL access through a dedicated projection API;
- local/remote deployment independent from BioHarness Core.

### 2.2 V1 excludes

The Web UI MUST NOT:

- create a task;
- alter a TaskSpec;
- start a run;
- retry a run;
- cancel a run;
- reconcile a run;
- approve a policy decision;
- promote memory;
- publish canonical data;
- write BioHarness tables;
- write provider-owned scientific outputs.

These actions may be considered in a later version only through BioHarness application services, never by direct database mutation.

## 3. Architecture Decision

Use an independent observability service and UI:

```text
BioHarness
    |
    v
PostgreSQL
    |
    | dedicated read-only credentials
    v
BioHarness-Web
  +-- Projection API
  +-- Graph Builder
  +-- SSE Stream
  +-- Static Web UI
```

The Web application reads the existing BioHarness persistence model but translates it into a stable Web-specific projection.

The browser does not know BioHarness table structure.

The browser consumes only Web projection contracts such as:

- `TaskSummary`
- `TaskGraph`
- `TaskNode`
- `TaskEdge`
- `NodeDetail`
- `ActivityEvent`

This reduces coupling between BioHarness schema evolution and front-end code.

## 4. Why a Projection Layer

Directly exposing `run_specs`, `run_attempts`, `run_events`, `memory_candidates`, and other tables to the browser would make the UI depend on Core storage details.

Instead:

```text
BioHarness records
      |
      v
Projection Builder
      |
      +--> TaskSummary
      +--> TaskGraph
      +--> NodeDetail
      +--> ActivityEvent
```

The projection layer is disposable. Deleting BioHarness-Web MUST NOT affect BioHarness execution.

## 5. Reference Projects

The design borrows interaction patterns, not architecture, from existing observability/orchestration systems.

### Langfuse

Useful pattern:

- a trace is a unit of work;
- nested observations represent retrievals, tool calls, generations, and other steps;
- trace detail can be viewed as a tree/graph;
- selecting an observation reveals its metadata, inputs, outputs, and timing.

BioHarness adapts this idea to scientific work, but V1 must not invent internal model reasoning that BioHarness did not persist.

Reference:
- https://langfuse.com/docs/observability/overview
- https://langfuse.com/docs/observability/data-model

### Temporal

Useful pattern:

- workflow list first;
- workflow detail second;
- event history is drill-down evidence rather than the main homepage.

BioHarness uses the same principle for append-only RunEvents.

Reference:
- https://docs.temporal.io/

### Dagster

Useful pattern:

- graph-oriented execution overview;
- separate run/event detail;
- observability of execution without turning every low-level log entry into a graph node.

Reference:
- https://docs.dagster.io/

### Marquez / lineage-oriented UIs

Useful pattern:

- graph is the primary overview;
- node selection reveals metadata and lineage details.

BioHarness uses this pattern for scientific-task route visualization.

## 6. Main Page

V1 has one principal page.

```text
+--------------------------------------------------------------+
| BioHarness Observatory                           connected   |
+----------------+---------------------------------------------+
| TASKS          |                                             |
|                |        SELECTED TASK                        |
| Running        |                                             |
| > Genome TF    |   [Question]                                |
|                |        |                                    |
| Running        |        v                                    |
|   RNA-seq      |   [Resolve Data]                            |
|                |        |                                    |
| Finished       |        v                                    |
|   TF Ref       |   [Assessment]                              |
|                |        |                                    |
| Attention      |        v                                    |
|   Task X       |   [Execution]  RUNNING                     |
|                |        |                                    |
|                |        v                                    |
|                |   [Validation]                              |
|                |                                             |
+----------------+---------------------------------------------+
```

No global log pane, artifact pane, validation pane, or memory pane is permanently visible.

The page is optimized for answering:

1. What tasks exist?
2. What state is each task in?
3. What is the selected task doing now?
4. What happened at a specific stage?

## 7. Task Sidebar

Each task item contains only:

- title/question summary;
- coarse status;
- current/highest stage;
- last activity time;
- optional attention indicator.

Example:

```text
RUNNING
Genome-web TF reference
Execution · 14s ago
```

Task ordering:

1. needs attention;
2. active;
3. recently finished;
4. older finished.

The sidebar supports a small text filter and simple status filter in V1.

## 8. Graph Semantics

The graph represents scientific/workflow stages, not every database event.

V1 canonical node types:

- `TASK`
- `MEMORY`
- `DATA`
- `ASSESSMENT`
- `PLANNING`
- `POLICY`
- `EXECUTION`
- `COLLECTION`
- `VALIDATION`
- `RESULT`

Not every task needs every node.

Example:

```text
TASK
  |
  +--> DATA
  |
  +--> ASSESSMENT
          |
          v
       PLANNING
          |
          v
       POLICY
          |
          v
      EXECUTION
          |
          v
      COLLECTION
          |
          v
      VALIDATION
```

Future agent/memory-rich tasks may include:

```text
TASK -> MEMORY -> DATA -> ASSESSMENT -> ...
```

Low-level events such as `SubmissionIntentRecorded` and `ExternalProcessBound` are shown inside node detail, not promoted to graph nodes.

## 9. Node Status

Graph node states:

- `WAITING`
- `ACTIVE`
- `COMPLETED`
- `FAILED`
- `ATTENTION`
- `UNKNOWN`

Mapping examples:

- active RunAttempt -> EXECUTION / ACTIVE;
- FINISHED attempt with registered artifacts -> EXECUTION / COMPLETED;
- NEEDS_OPERATOR_RECONCILIATION -> EXECUTION / ATTENTION;
- validation FAIL -> VALIDATION / FAILED;
- unresolved fields -> TASK or DATA / ATTENTION.

Color must not be the only status signal; shape/icon/text must also carry status.

## 10. Node Detail

Clicking a node opens a right-side drawer.

The drawer has a single responsibility: explain the selected stage.

### Example: Execution

```text
Execution

Status
RUNNING

Provider
Genome-web

Attempt
bh-xxxx-1

Started
08:42:17

Runtime
Nextflow 25.10.4
MAFFT 7.526
IQ-TREE 3.1.2

Recent events
ExecutionStarted
ArtifactDiscovered
...

[Open event history]
[Open artifacts]
```

### Example: Memory

```text
Memory

Status
COMPLETED

Context snapshot
...

Memory refs
...

Candidates
...
```

V1 must distinguish between:

- persisted memory actually referenced by the task;
- memory candidates stored in the relevant project/scope;
- absent retrieval telemetry.

If BioHarness did not persist a retrieval event, the UI must not claim that a memory was "considered" or "rejected".

## 11. "Thinking" and Agent Activity

V1 MUST NOT expose or fabricate private chain-of-thought.

The UI may show persisted, auditable high-level phases such as:

- ASSESSING
- PLANNING
- RESOLVING_DATA
- AUTHORIZING
- EXECUTING
- COLLECTING
- VALIDATING
- RECONCILING

Future agent-runtime instrumentation may add explicit observation types:

- `AGENT`
- `RETRIEVAL`
- `TOOL`
- `MODEL`
- `DECISION`

These must be structured records emitted by the runtime, not inferred from hidden reasoning.

## 12. Projection Contracts

### 12.1 TaskSummary

```json
{
  "id": "uuid",
  "title": "Genome-web TF reference",
  "analysis_class": "tf_family_phylogeny_reference",
  "status": "RUNNING",
  "stage": "EXECUTION",
  "updated_at": "timestamp",
  "needs_attention": false
}
```

### 12.2 TaskGraph

```json
{
  "task": {},
  "nodes": [],
  "edges": [],
  "revision": "opaque-version"
}
```

### 12.3 TaskNode

```json
{
  "id": "execution:attempt-uuid",
  "type": "EXECUTION",
  "label": "Genome-web TF",
  "status": "ACTIVE",
  "started_at": "timestamp",
  "finished_at": null,
  "detail_ref": "/api/tasks/.../nodes/..."
}
```

### 12.4 NodeDetail

```json
{
  "node": {},
  "summary": {},
  "events": [],
  "evidence_refs": [],
  "links": []
}
```

The projection format is versioned independently from BioHarness database schema.

## 13. API

V1 API:

```text
GET /api/health

GET /api/tasks
GET /api/tasks/{task_id}

GET /api/tasks/{task_id}/graph
GET /api/tasks/{task_id}/nodes/{node_id}

GET /api/tasks/{task_id}/events
GET /api/tasks/{task_id}/artifacts
GET /api/tasks/{task_id}/validation
GET /api/tasks/{task_id}/memory

GET /api/stream
```

The browser never receives database credentials.

## 14. Real-Time Update Model

Use Server-Sent Events, not WebSocket, in V1.

Reason:

- data direction is primarily server -> browser;
- implementation is simpler;
- reconnect semantics are straightforward;
- no V1 browser command channel is required.

SSE events contain invalidation/update hints, not full database rows.

Example:

```text
event: task.updated
data: {"task_id":"...","revision":"..."}

event: run.event
data: {"task_id":"...","attempt_id":"...","sequence_no":8}
```

On receipt, the client refetches the affected projection.

Initial implementation may poll PostgreSQL at a modest interval inside the observatory service if no database notification mechanism is available. It must not modify BioHarness Core solely to make Web updates easier.

## 15. Data Access

Use a dedicated PostgreSQL role with SELECT-only permissions on the required BioHarness tables.

Required tables initially:

- `scientific_task_specs`
- `policy_decisions`
- `resolved_data_refs`
- `scientific_assessments`
- `resolved_configurations`
- `context_snapshots`
- `run_specs`
- `run_attempts`
- `run_events`
- `artifacts`
- `validation_reports`
- `validation_evaluations`
- `memory_candidates`

The role MUST NOT receive INSERT, UPDATE, DELETE, TRUNCATE, CREATE, or ownership privileges.

The Web service must also run transaction-level read-only sessions where supported.

## 16. Technology

Target repository:

`mumu-140/BioHarness-Web`

Recommended V1 stack:

### Backend

- Python 3.12+
- FastAPI
- SQLAlchemy
- Pydantic
- PostgreSQL read-only connection
- SSE endpoint

### Frontend

- React
- TypeScript
- Vite
- React Flow for task graph
- lightweight CSS/component primitives; no large design-system dependency required for V1

### Deployment

Single service/repository, two build stages:

```text
frontend build
      |
      v
static assets
      |
FastAPI serves API + static Web
```

V1 does not require Redis, Kafka, Celery, GraphQL, Next.js, or a second application database.

## 17. Repository Layout

Proposed:

```text
BioHarness-Web/
├── AGENTS.md
├── README.md
├── pyproject.toml
├── package.json
├── backend/
│   └── bioharness_web/
│       ├── api/
│       ├── projection/
│       ├── db/
│       ├── stream/
│       └── settings.py
├── frontend/
│   └── src/
│       ├── app/
│       ├── components/
│       ├── graph/
│       ├── api/
│       └── styles/
├── tests/
│   ├── backend/
│   ├── contract/
│   └── e2e/
├── docs/
│   ├── architecture.md
│   └── deployment.md
└── deploy/
    ├── Dockerfile
    └── compose.example.yml
```

Keep `AGENTS.md` short and operational; detailed architecture belongs in `docs/`.

## 18. Projection Rules

Projection logic must be deterministic and testable.

Examples:

- TaskSpec always creates TASK node.
- ResolvedDataRefs create one aggregate DATA node in V1.
- ScientificAssessment creates ASSESSMENT node.
- ResolvedConfiguration + RunSpec create PLANNING node.
- launch/read PolicyDecisions create POLICY detail; graph may aggregate them.
- latest relevant RunAttempt creates EXECUTION node.
- Artifact registration creates COLLECTION node.
- ValidationReports/Evaluation create VALIDATION node.
- ContextSnapshot memory_refs create MEMORY node when non-empty.
- standalone MemoryCandidates do not automatically imply that a task used memory.

Multiple attempts are not rendered as parallel top-level execution nodes by default. The graph shows the current/latest attempt; previous attempts are available in execution node detail.

## 19. Error and Stale-State Handling

The UI must distinguish:

- BioHarness task failure;
- observatory API failure;
- database unavailable;
- SSE disconnected;
- data stale.

If SSE disconnects:

- graph remains visible;
- connection indicator changes to disconnected;
- browser retries;
- a timestamp shows last successful refresh.

Observatory errors must never mutate or reconcile BioHarness state.

## 20. Security

V1 security rules:

- read-only DB credential;
- credential supplied through environment/secrets, never git;
- backend only is allowed to connect to PostgreSQL;
- no arbitrary SQL endpoint;
- no filesystem browsing endpoint;
- no artifact file download by arbitrary path in V1;
- IDs are validated as domain identifiers/UUIDs;
- JSON payloads are treated as data, not executable markup;
- raw provider command output is escaped before display.

If exposed beyond trusted lab networking, authentication must be added before deployment.

## 21. Testing

### Backend unit tests

- task status projection;
- graph node/edge generation;
- RunAttempt state mappings;
- previous-attempt behavior;
- validation outcome mappings;
- memory usage honesty;
- stale/disconnected metadata.

### Contract tests

Use frozen BioHarness fixture rows representing:

1. successful Genome-web TF task;
2. running task;
3. failed task;
4. NEEDS_OPERATOR_RECONCILIATION task;
5. task with no RunSpec yet;
6. task with memory_refs;
7. task with MemoryCandidates but no actual memory_refs.

### Frontend tests

- sidebar selection;
- graph updates on task change;
- node click opens detail;
- drawer closes without losing task selection;
- reconnect/stale indicator;
- empty state;
- failed/attention node rendering.

### Integration test

Run against a disposable PostgreSQL instance seeded with BioHarness-compatible rows.

The Web test suite MUST NOT require a live Genome-web workflow.

## 22. Deployment Model

Initial deployment target should be a host that can reach the BioHarness PostgreSQL database.

Recommended:

```text
Docker container
  BioHarness-Web
       |
       | read-only PostgreSQL role
       v
  BioHarness DB
```

Deployment must not mount BioHarness source or Genome-web scientific directories writable.

Configuration:

```text
BIOHARNESS_WEB_DATABASE_URL=
BIOHARNESS_WEB_HOST=
BIOHARNESS_WEB_PORT=
BIOHARNESS_WEB_POLL_INTERVAL_SECONDS=
```

A reverse proxy is optional for V1.

## 23. Acceptance Criteria

V1 is complete when:

1. opening the homepage shows task list on the left;
2. selecting a task renders a deterministic task graph on the right;
3. current running/failed/attention state is visible without opening logs;
4. clicking a node opens only that node's detail;
5. event/artifact/validation/memory detail is reachable through drill-down;
6. a new RunEvent becomes visible without full-page refresh;
7. disconnect/stale state is explicit;
8. the PostgreSQL role used by the app cannot mutate BioHarness;
9. stopping or deleting BioHarness-Web does not affect BioHarness execution;
10. no hidden reasoning is fabricated as "thinking";
11. existing BioHarness Core tests remain unchanged/green;
12. deployment uses an isolated container and read-only database credentials.

## 24. Deferred Work

Explicitly deferred:

- task creation and editing;
- approvals;
- retry/cancel/reconcile controls;
- production publication controls;
- advanced agent trace instrumentation;
- task-memory graph editing;
- arbitrary artifact browsing;
- user/role management;
- analytics dashboard;
- metrics warehouse;
- WebSocket;
- OpenTelemetry ingestion.

These may be added only after V1 proves the projection and interaction model.
