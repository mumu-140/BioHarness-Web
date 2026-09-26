> Historical source record migrated from `mumu-140/BioHarness@docs/bioharness-web-observatory-design:docs/superpowers/plans/2026-09-19-bioharness-web-observatory.md` on 2026-09-26.\n> This implementation plan predates the current BioHarness-Web V1.7 implementation and is preserved for design provenance; current behavior is defined by the live repository documentation and code.\n\n# BioHarness Web Observatory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy an independent, read-only BioHarness Web Observatory with a task sidebar, dynamic task graph, clickable node detail drawer, and SSE-driven refresh.

**Architecture:** Create a separate repository, `mumu-140/BioHarness-Web`, containing a FastAPI read-projection service and a React/Vite frontend. The backend is the only component allowed to connect to BioHarness PostgreSQL, using SELECT-only credentials; it projects BioHarness persistence records into stable Web contracts and emits SSE invalidation hints. The frontend renders a task list plus React Flow graph and fetches node details only when the user drills in.

**Tech Stack:** Python 3.12+, FastAPI, SQLAlchemy 2.x, psycopg 3, Pydantic 2.x, React 19, TypeScript, Vite, @xyflow/react, Vitest, React Testing Library, pytest, Docker.

**Spec:** `docs/superpowers/specs/2026-09-19-bioharness-web-observatory-design.md`

## Global Constraints

- Target implementation repository: `mumu-140/BioHarness-Web`.
- V1 is strictly read-only: no create/start/retry/cancel/reconcile/approve/promote/publish/write action.
- Browser never receives PostgreSQL credentials and never speaks SQL.
- Backend uses a dedicated SELECT-only PostgreSQL role and read-only transactions.
- The Web app must remain disposable: stopping/deleting it must not affect BioHarness execution.
- Main page contains only task sidebar + selected task graph; node details are drill-down.
- Low-level RunEvents remain node detail/history and are not promoted to top-level graph nodes.
- V1 must not fabricate or expose private chain-of-thought.
- Runtime freshness is delivered with SSE; WebSocket, Redis, Kafka, Celery, GraphQL, Next.js, and a second app database are out of scope.
- Deployment must not mount BioHarness source or Genome-web scientific directories writable.
- Initial deployment is internal/lab-only and uses environment-provided secrets.
- Implementation and deployment work must not modify BioHarness canonical tables or provider scientific outputs.
- On `fwq10ys`, all deployment writes stay under `/home/yangs/software/BioHarness-Web/**`; no host-level package/glibc replacement.

## Review Focus

1. **A task exists before any RunSpec/RunAttempt exists** — sidebar must still show it and graph must render a TASK node without crashing. Task 2 adds this contract case.
2. **Multiple attempts exist for one RunSpec** — graph shows only latest/current execution node while node detail exposes attempt history in deterministic order. Task 3 tests this.
3. **MemoryCandidate exists but task has no `ContextSnapshot.memory_refs`** — UI must not claim memory was used. Task 3 tests this honesty boundary.
4. **SSE connection drops or database becomes temporarily unavailable** — current graph remains visible, stale/disconnected state is explicit, and reconnect resumes invalidations. Tasks 4 and 6 test this.
5. **Malformed/unknown JSONB payload fields from a newer BioHarness revision** — projection ignores unknown fields and emits safe fallback labels/status rather than 500. Task 2 tests forward-tolerant parsing.

---

## File Structure

The implementation repository will be created with the following responsibilities:

```text
BioHarness-Web/
├── AGENTS.md                         # short day-to-day repo rules
├── README.md                         # operator/user quick start
├── .gitignore
├── pyproject.toml                    # backend/test dependencies
├── backend/
│   └── bioharness_web/
│       ├── __init__.py
│       ├── app.py                    # FastAPI composition only
│       ├── settings.py               # environment validation
│       ├── db.py                     # read-only engine/session
│       ├── models.py                 # Web projection contracts
│       ├── repository.py             # typed read queries
│       ├── projection.py             # BioHarness rows -> Web contracts
│       ├── service.py                # query orchestration
│       ├── stream.py                 # SSE invalidation source
│       └── api.py                    # HTTP route definitions
├── frontend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── api/client.ts
│       ├── api/types.ts
│       ├── hooks/useTaskStream.ts
│       ├── components/TaskSidebar.tsx
│       ├── components/TaskGraph.tsx
│       ├── components/NodeDetailDrawer.tsx
│       ├── components/ConnectionBadge.tsx
│       └── styles.css
├── tests/
│   ├── backend/
│   │   ├── conftest.py
│   │   ├── test_settings.py
│   │   ├── test_projection_tasks.py
│   │   ├── test_projection_graph.py
│   │   ├── test_node_detail.py
│   │   ├── test_api.py
│   │   └── test_stream.py
│   └── contract/
│       └── fixtures.py
├── frontend/
│   └── src/
│       ├── App.test.tsx
│       ├── components/TaskSidebar.test.tsx
│       ├── components/TaskGraph.test.tsx
│       └── components/NodeDetailDrawer.test.tsx
├── docs/
│   ├── architecture.md
│   └── deployment.md
└── deploy/
    ├── Dockerfile
    ├── nginx.conf
    └── compose.example.yml
```

### Task 1: Bootstrap the independent repository and read-only settings boundary

**Files:**
- Create: `AGENTS.md`
- Create: `README.md`
- Create: `.gitignore`
- Create: `pyproject.toml`
- Create: `backend/bioharness_web/__init__.py`
- Create: `backend/bioharness_web/settings.py`
- Create: `tests/backend/test_settings.py`
- Create: `frontend/package.json`
- Create: `frontend/tsconfig.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/index.html`

**Interfaces:**
- Consumes: environment variable `BIOHARNESS_WEB_DATABASE_URL`.
- Produces: `Settings.from_env() -> Settings` with validated PostgreSQL URL, poll interval, host, port, and app name.

- [ ] **Step 1: Create `mumu-140/BioHarness-Web` and feature branch**

Create the repository with README disabled so scaffold commits are deterministic. Create branch `feat/observatory-v1` from the initial scaffold commit.

- [ ] **Step 2: Write the failing settings tests**

```python
from bioharness_web.settings import Settings


def test_database_url_is_required(monkeypatch):
    monkeypatch.delenv("BIOHARNESS_WEB_DATABASE_URL", raising=False)
    with pytest.raises(ValueError, match="BIOHARNESS_WEB_DATABASE_URL"):
        Settings.from_env()


def test_non_postgresql_url_is_rejected(monkeypatch):
    monkeypatch.setenv("BIOHARNESS_WEB_DATABASE_URL", "sqlite:///tmp/x.db")
    with pytest.raises(ValueError, match="PostgreSQL"):
        Settings.from_env()


def test_poll_interval_has_safe_floor(monkeypatch):
    monkeypatch.setenv(
        "BIOHARNESS_WEB_DATABASE_URL",
        "postgresql+psycopg://web@db/bioharness",
    )
    monkeypatch.setenv("BIOHARNESS_WEB_POLL_INTERVAL_SECONDS", "0")
    with pytest.raises(ValueError, match="poll interval"):
        Settings.from_env()
```

- [ ] **Step 3: Run the tests and verify RED**

Run:

```bash
pytest tests/backend/test_settings.py -q
```

Expected: collection/import failure because `bioharness_web.settings` does not exist yet.

- [ ] **Step 4: Implement minimal settings**

```python
from dataclasses import dataclass
import os


@dataclass(frozen=True)
class Settings:
    database_url: str
    host: str = "0.0.0.0"
    port: int = 8080
    poll_interval_seconds: float = 2.0
    app_name: str = "BioHarness Observatory"

    @classmethod
    def from_env(cls) -> "Settings":
        database_url = os.environ.get("BIOHARNESS_WEB_DATABASE_URL", "").strip()
        if not database_url:
            raise ValueError("BIOHARNESS_WEB_DATABASE_URL is required")
        if not database_url.startswith(("postgresql://", "postgresql+psycopg://")):
            raise ValueError("BioHarness Web requires PostgreSQL")
        poll = float(os.environ.get("BIOHARNESS_WEB_POLL_INTERVAL_SECONDS", "2"))
        if poll < 0.5:
            raise ValueError("poll interval must be >= 0.5 seconds")
        return cls(
            database_url=database_url,
            host=os.environ.get("BIOHARNESS_WEB_HOST", "0.0.0.0"),
            port=int(os.environ.get("BIOHARNESS_WEB_PORT", "8080")),
            poll_interval_seconds=poll,
        )
```

- [ ] **Step 5: Run settings tests and full backend suite**

Run:

```bash
pytest -q
```

Expected: PASS.

- [ ] **Step 6: Add minimal frontend package manifest**

Use React/Vite with only:

```json
{
  "dependencies": {
    "@xyflow/react": "^12.8.4",
    "react": "^19.1.1",
    "react-dom": "^19.1.1"
  },
  "devDependencies": {
    "@testing-library/react": "^16.3.0",
    "@testing-library/user-event": "^14.6.1",
    "@types/react": "^19.1.10",
    "@types/react-dom": "^19.1.7",
    "@vitejs/plugin-react": "^5.0.4",
    "jsdom": "^26.1.0",
    "typescript": "^5.9.2",
    "vite": "^7.1.7",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "chore: bootstrap BioHarness Observatory"
```

### Task 2: Implement read-only database access and task/sidebar projection

**Files:**
- Create: `backend/bioharness_web/db.py`
- Create: `backend/bioharness_web/models.py`
- Create: `backend/bioharness_web/repository.py`
- Create: `backend/bioharness_web/projection.py`
- Create: `tests/contract/fixtures.py`
- Create: `tests/backend/test_projection_tasks.py`

**Interfaces:**
- Consumes: BioHarness P0 table payloads as JSON dictionaries.
- Produces:
  - `TaskSummary`
  - `TaskStatus`
  - `TaskStage`
  - `BioHarnessReadRepository.list_task_records() -> list[TaskRecord]`
  - `project_task_summary(record: TaskRecord) -> TaskSummary`

- [ ] **Step 1: Write failing projection tests**

Cover:

```python
def test_task_without_runs_still_projects():
    summary = project_task_summary(task_only_record())
    assert summary.status == "WAITING"
    assert summary.stage == "TASK"


def test_attention_sorts_before_running_then_recent_finished():
    summaries = project_task_summaries(mixed_task_records())
    assert [item.status for item in summaries[:3]] == [
        "ATTENTION",
        "RUNNING",
        "FINISHED",
    ]


def test_unknown_future_payload_fields_are_ignored():
    record = task_only_record(extra_payload={"future_field": {"x": 1}})
    summary = project_task_summary(record)
    assert summary.title


def test_question_is_used_as_safe_title_when_no_explicit_title():
    summary = project_task_summary(task_only_record(question="How does X respond?"))
    assert summary.title == "How does X respond?"
```

- [ ] **Step 2: Run tests and verify RED**

```bash
pytest tests/backend/test_projection_tasks.py -q
```

Expected: FAIL because projection types/functions do not exist.

- [ ] **Step 3: Implement stable Web contracts**

Use Pydantic models with `extra="ignore"` for forward tolerance:

```python
class TaskStatus(StrEnum):
    WAITING = "WAITING"
    RUNNING = "RUNNING"
    FINISHED = "FINISHED"
    FAILED = "FAILED"
    ATTENTION = "ATTENTION"


class TaskStage(StrEnum):
    TASK = "TASK"
    DATA = "DATA"
    ASSESSMENT = "ASSESSMENT"
    PLANNING = "PLANNING"
    POLICY = "POLICY"
    EXECUTION = "EXECUTION"
    COLLECTION = "COLLECTION"
    VALIDATION = "VALIDATION"
    RESULT = "RESULT"


class TaskSummary(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: UUID
    title: str
    analysis_class: str
    status: TaskStatus
    stage: TaskStage
    updated_at: datetime
    needs_attention: bool
```

- [ ] **Step 4: Implement repository with transaction-level read-only semantics**

Connection hook/session behavior must execute:

```sql
SET TRANSACTION READ ONLY;
```

Repository SQL must be explicit SELECT-only SQLAlchemy Core queries. No ORM `add`, `flush`, `commit`, or mutation method is exposed.

- [ ] **Step 5: Add a regression test proving mutation methods do not exist**

```python
def test_repository_exposes_no_mutation_api(repository):
    forbidden = {"add", "save", "delete", "update", "commit"}
    assert forbidden.isdisjoint(set(dir(repository)))
```

- [ ] **Step 6: Run backend suite**

```bash
pytest -q
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend tests
git commit -m "feat: project BioHarness tasks read-only"
```

### Task 3: Build deterministic task graph and drill-down node detail

**Files:**
- Modify: `backend/bioharness_web/models.py`
- Modify: `backend/bioharness_web/repository.py`
- Modify: `backend/bioharness_web/projection.py`
- Create: `backend/bioharness_web/service.py`
- Create: `tests/backend/test_projection_graph.py`
- Create: `tests/backend/test_node_detail.py`

**Interfaces:**
- Consumes: `TaskRecord` with task, refs, assessment, configuration, context, RunSpecs, attempts, events, artifacts, validation, memory.
- Produces:
  - `TaskGraph(nodes: list[TaskNode], edges: list[TaskEdge], revision: str)`
  - `NodeDetail`
  - `ObservatoryService.get_task_graph(task_id: UUID)`
  - `ObservatoryService.get_node_detail(task_id: UUID, node_id: str)`

- [ ] **Step 1: Write failing graph tests for canonical stage aggregation**

```python
def test_successful_tf_task_builds_stage_graph():
    graph = project_task_graph(successful_genome_web_fixture())
    assert [node.type for node in graph.nodes] == [
        "TASK",
        "DATA",
        "ASSESSMENT",
        "PLANNING",
        "POLICY",
        "EXECUTION",
        "COLLECTION",
        "VALIDATION",
    ]
    assert graph.nodes[-1].status == "COMPLETED"


def test_low_level_run_events_are_not_graph_nodes():
    graph = project_task_graph(successful_genome_web_fixture())
    node_types = {node.type for node in graph.nodes}
    assert "SubmissionIntentRecorded" not in node_types
    assert "ExternalProcessBound" not in node_types
```

- [ ] **Step 2: Add failing multi-attempt and memory-honesty tests**

```python
def test_latest_attempt_is_primary_and_history_is_in_detail():
    record = task_with_attempts(states=["FAILED", "RUNNING"])
    graph = project_task_graph(record)
    execution = graph.node_by_type("EXECUTION")
    assert execution.status == "ACTIVE"
    detail = project_node_detail(record, execution.id)
    assert [x["attempt_number"] for x in detail.summary["attempt_history"]] == [1, 2]


def test_memory_candidate_without_context_ref_does_not_create_used_memory_node():
    graph = project_task_graph(task_with_unreferenced_memory_candidate())
    assert "MEMORY" not in {node.type for node in graph.nodes}


def test_context_memory_refs_create_memory_node():
    graph = project_task_graph(task_with_context_memory_refs())
    assert "MEMORY" in {node.type for node in graph.nodes}
```

- [ ] **Step 3: Run graph/detail tests and verify RED**

```bash
pytest tests/backend/test_projection_graph.py tests/backend/test_node_detail.py -q
```

Expected: FAIL due missing graph/detail implementation.

- [ ] **Step 4: Implement deterministic graph builder**

Node IDs are stable strings such as:

```text
task
memory
data
assessment
planning
policy
execution:<attempt-id>
collection:<attempt-id>
validation:<evaluation-id-or-attempt-id>
```

Edges follow displayed scientific stage order, not database foreign-key order.

- [ ] **Step 5: Implement node detail by node type**

Execution detail includes:

- provider/executor namespace;
- current attempt;
- attempt history;
- capability snapshot;
- runtime environment;
- recent RunEvents;
- artifact count.

Memory detail includes only context memory refs as “used”; other candidates are clearly labeled “available candidates”.

- [ ] **Step 6: Run full backend suite**

```bash
pytest -q
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend tests
git commit -m "feat: add task graph and node projections"
```

### Task 4: Add HTTP API, health and SSE invalidation stream

**Files:**
- Create: `backend/bioharness_web/api.py`
- Create: `backend/bioharness_web/stream.py`
- Create: `backend/bioharness_web/app.py`
- Create: `tests/backend/test_api.py`
- Create: `tests/backend/test_stream.py`

**Interfaces:**
- Consumes: `ObservatoryService`.
- Produces:
  - `GET /api/health`
  - `GET /api/tasks`
  - `GET /api/tasks/{task_id}`
  - `GET /api/tasks/{task_id}/graph`
  - `GET /api/tasks/{task_id}/nodes/{node_id}`
  - `GET /api/tasks/{task_id}/events`
  - `GET /api/tasks/{task_id}/artifacts`
  - `GET /api/tasks/{task_id}/validation`
  - `GET /api/tasks/{task_id}/memory`
  - `GET /api/stream`

- [ ] **Step 1: Write failing API contract tests**

```python
def test_tasks_endpoint_returns_projection(client):
    response = client.get("/api/tasks")
    assert response.status_code == 200
    assert response.json()[0]["stage"] == "EXECUTION"


def test_unknown_task_is_404(client):
    response = client.get(f"/api/tasks/{uuid4()}/graph")
    assert response.status_code == 404


def test_health_never_leaks_database_url(client):
    body = client.get("/api/health").json()
    assert "database_url" not in body
    assert "password" not in json.dumps(body).lower()
```

- [ ] **Step 2: Write failing SSE tests**

```python
def test_stream_emits_task_updated_invalidation():
    event = build_invalidation(previous, current)
    assert event.event == "task.updated"
    assert event.data == {
        "task_id": str(current.id),
        "revision": current.revision,
    }


def test_database_poll_failure_emits_stale_state_without_crashing_stream():
    state = stream_state_after_poll_error(RuntimeError("db unavailable"))
    assert state.connected is True
    assert state.stale is True
```

- [ ] **Step 3: Run tests and verify RED**

```bash
pytest tests/backend/test_api.py tests/backend/test_stream.py -q
```

- [ ] **Step 4: Implement API and SSE**

Use `text/event-stream`; SSE sends small invalidations only. The server computes an opaque revision from max timestamps/event sequence numbers and polls at configured interval.

Emit:

```text
event: task.updated
data: {"task_id":"...","revision":"..."}

event: observatory.stale
data: {"stale":true,"at":"..."}
```

- [ ] **Step 5: Run backend suite**

```bash
pytest -q
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend tests
git commit -m "feat: expose observatory API and SSE"
```

### Task 5: Implement the homepage shell, task sidebar and dynamic React Flow graph

**Files:**
- Create: `frontend/src/main.tsx`
- Create: `frontend/src/App.tsx`
- Create: `frontend/src/api/types.ts`
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/components/TaskSidebar.tsx`
- Create: `frontend/src/components/TaskGraph.tsx`
- Create: `frontend/src/components/ConnectionBadge.tsx`
- Create: `frontend/src/styles.css`
- Create: `frontend/src/App.test.tsx`
- Create: `frontend/src/components/TaskSidebar.test.tsx`
- Create: `frontend/src/components/TaskGraph.test.tsx`

**Interfaces:**
- Consumes: REST `TaskSummary[]`, `TaskGraph`.
- Produces: selected-task state, two-column homepage, React Flow node-selection callback.

- [ ] **Step 1: Write failing sidebar/App tests**

```tsx
it("renders task list on the left and graph for selected task", async () => {
  render(<App api={fakeApi} />);
  expect(await screen.findByText("Genome-web TF reference")).toBeInTheDocument();
  expect(await screen.findByText("Execution")).toBeInTheDocument();
});


it("selecting another task replaces the graph", async () => {
  render(<App api={fakeApi} />);
  await user.click(await screen.findByText("RNA-seq task"));
  expect(await screen.findByText("Resolve data")).toBeInTheDocument();
});
```

- [ ] **Step 2: Write failing graph status tests**

```tsx
it("shows active and attention states with text, not color alone", () => {
  render(<TaskGraph graph={graphWithActiveAndAttention} onSelectNode={() => {}} />);
  expect(screen.getByText("RUNNING")).toBeInTheDocument();
  expect(screen.getByText("NEEDS ATTENTION")).toBeInTheDocument();
});
```

- [ ] **Step 3: Run frontend tests and verify RED**

```bash
cd frontend
npm test -- --run
```

Expected: FAIL because components do not exist.

- [ ] **Step 4: Implement layout and graph**

Desktop V1 layout:

```css
.app {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  height: 100vh;
}

.task-sidebar {
  border-right: 1px solid var(--border);
  overflow: auto;
}

.graph-shell {
  min-width: 0;
  position: relative;
}
```

Graph nodes remain visually quiet and stage-oriented. Do not expose raw JSON on the graph.

- [ ] **Step 5: Run tests and production build**

```bash
npm test -- --run
npm run build
```

Expected: PASS and Vite build exit 0.

- [ ] **Step 6: Commit**

```bash
git add frontend
git commit -m "feat: add task sidebar and live graph"
```

### Task 6: Add node detail drawer and resilient SSE refresh

**Files:**
- Create: `frontend/src/components/NodeDetailDrawer.tsx`
- Create: `frontend/src/hooks/useTaskStream.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/styles.css`
- Create: `frontend/src/components/NodeDetailDrawer.test.tsx`
- Modify: `frontend/src/App.test.tsx`

**Interfaces:**
- Consumes: `NodeDetail`, `/api/stream` invalidations.
- Produces: lazy node-detail fetch, drawer visibility, connection/stale state and targeted refetch.

- [ ] **Step 1: Write failing drawer tests**

```tsx
it("opens only the selected node detail", async () => {
  render(<App api={fakeApi} />);
  await user.click(await screen.findByText("Genome-web TF"));
  expect(await screen.findByRole("dialog")).toHaveTextContent("Execution");
  expect(screen.queryByText("All artifacts")).not.toBeInTheDocument();
});


it("closing drawer preserves selected task", async () => {
  render(<App api={fakeApi} />);
  await user.click(await screen.findByText("Genome-web TF"));
  await user.click(screen.getByRole("button", { name: "Close details" }));
  expect(screen.getByText("Genome-web TF reference")).toHaveAttribute("aria-current", "true");
});
```

- [ ] **Step 2: Write failing reconnect/stale tests**

Use an injectable EventSource factory.

```tsx
it("marks data stale when stream errors but keeps graph visible", async () => {
  const stream = fakeStream();
  render(<App api={fakeApi} eventSourceFactory={() => stream} />);
  stream.emitError();
  expect(await screen.findByText("Disconnected · showing last update")).toBeInTheDocument();
  expect(screen.getByText("Genome-web TF")).toBeInTheDocument();
});


it("refetches selected task after task.updated", async () => {
  // assert graph endpoint call count increments after SSE invalidation
});
```

- [ ] **Step 3: Run tests and verify RED**

```bash
cd frontend
npm test -- --run
```

- [ ] **Step 4: Implement lazy drawer and SSE hook**

Do not preload all node details. `useTaskStream` reconnects through browser EventSource behavior and records `lastSuccessfulUpdate`.

- [ ] **Step 5: Run frontend tests + build**

```bash
npm test -- --run
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add frontend
git commit -m "feat: add node drill-down and live refresh"
```

### Task 7: Package one-container deployment and enforce database read-only credentials

**Files:**
- Create: `deploy/Dockerfile`
- Create: `deploy/nginx.conf`
- Create: `deploy/compose.example.yml`
- Create: `docs/deployment.md`
- Create: `docs/architecture.md`
- Modify: `README.md`
- Create: `tests/backend/test_readonly_database.py`

**Interfaces:**
- Consumes: built frontend and FastAPI backend.
- Produces: one deployable container on port 8080 and deployment instructions for SELECT-only DB role.

- [ ] **Step 1: Write failing integration test for read-only database role**

Against disposable PostgreSQL:

```python
def test_web_role_can_select_but_cannot_mutate(db_admin, web_engine):
    with web_engine.connect() as conn:
        assert conn.execute(text("select count(*) from scientific_task_specs")).scalar() >= 0
        with pytest.raises(DBAPIError):
            conn.execute(text(
                "insert into scientific_task_specs (id, revision, payload, created_at) "
                "values (gen_random_uuid(), 1, '{}'::jsonb, now())"
            ))
```

- [ ] **Step 2: Run integration test and verify RED before role grants are applied**

Expected: test cannot yet establish the intended dedicated role contract.

- [ ] **Step 3: Add documented role creation SQL**

```sql
CREATE ROLE bioharness_web LOGIN PASSWORD '<secret>';
GRANT CONNECT ON DATABASE bioharness TO bioharness_web;
GRANT USAGE ON SCHEMA public TO bioharness_web;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO bioharness_web;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO bioharness_web;
ALTER ROLE bioharness_web SET default_transaction_read_only = on;
```

Do not grant table ownership or write privileges.

- [ ] **Step 4: Build Docker image**

Multi-stage Dockerfile:

```dockerfile
FROM node:22-bookworm-slim AS frontend
WORKDIR /src/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim AS runtime
WORKDIR /app
COPY pyproject.toml ./
COPY backend ./backend
RUN pip install --no-cache-dir .
COPY --from=frontend /src/frontend/dist ./static
ENV BIOHARNESS_WEB_HOST=0.0.0.0
ENV BIOHARNESS_WEB_PORT=8080
CMD ["uvicorn", "bioharness_web.app:app", "--host", "0.0.0.0", "--port", "8080"]
```

FastAPI serves `/api/*`; static fallback serves the SPA.

- [ ] **Step 5: Run all tests/builds fresh**

```bash
pytest -q
cd frontend && npm test -- --run && npm run build
docker build -f deploy/Dockerfile -t bioharness-web:observatory-v1 .
```

All commands must exit 0.

- [ ] **Step 6: Deploy internally on fwq10ys under the allowed root only**

Allowed write root:

```text
/home/yangs/software/BioHarness-Web/**
```

Create a dedicated deployment directory under that root only. Do not modify `/home/yangs/software/Genome-web/**` or account/system directories.

Create/use a SELECT-only PostgreSQL role for the BioHarness database. For the initial demonstration deployment, point at the isolated BioHarness acceptance database if no persistent production BioHarness database has yet been designated.

Run the container on the existing lab Docker host with an explicitly chosen host port and no privileged mode.

- [ ] **Step 7: Verify deployed behavior**

Verify:

```bash
curl -fsS http://127.0.0.1:<port>/api/health
curl -fsS http://127.0.0.1:<port>/api/tasks
curl -N --max-time 5 http://127.0.0.1:<port>/api/stream
```

Open the Web UI through the authorized network/tunnel and verify:

- task sidebar visible;
- selecting a task changes graph;
- successful Genome-web acceptance task displays deterministic route;
- clicking EXECUTION opens drawer;
- graph remains visible if SSE is interrupted;
- DB role cannot INSERT/UPDATE/DELETE.

- [ ] **Step 8: Commit deployment and docs**

```bash
git add deploy docs README.md tests/backend/test_readonly_database.py
git commit -m "feat: package and document observatory deployment"
```

### Task 8: Final review, PR and deployment evidence

**Files:**
- Create: `docs/validation/2026-09-19-observatory-v1.md`
- Modify only if review finds defects: files owned by the defect.

**Interfaces:**
- Consumes: complete feature branch and deployed internal instance.
- Produces: evidence record and merge-ready PR; no merge without explicit user approval.

- [ ] **Step 1: Run fresh full verification**

```bash
pytest -q
cd frontend && npm test -- --run && npm run build
docker build -f deploy/Dockerfile -t bioharness-web:observatory-v1 .
```

Capture exact counts and exit codes.

- [ ] **Step 2: Verify deployment evidence**

Record:

- BioHarness-Web commit SHA;
- BioHarness main schema revision used;
- read-only role verification;
- Docker image ID;
- deployment host/port;
- health/tasks/SSE smoke results;
- screenshot/manual UI checks if available;
- no writes outside allowed root.

- [ ] **Step 3: Perform whole-branch review**

Review specifically for:

- accidental write-capable DB code;
- hidden coupling to BioHarness internal Python package;
- graph projection semantic errors;
- fabricated memory/thinking status;
- XSS/raw provider text handling;
- SSE reconnect leaks;
- oversized frontend/backend dependencies.

Critical/Important findings receive one RED → GREEN fix pass.

- [ ] **Step 4: Create PR**

PR title:

```text
feat: add BioHarness Web Observatory V1
```

PR description must list what is implemented, what remains explicitly out of scope, exact test/build evidence, and deployment evidence.

Do not merge without explicit user approval.
