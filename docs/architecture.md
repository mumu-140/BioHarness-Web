# BioHarness Web Observatory Architecture

BioHarness Web is a disposable, read-only observability layer.

    BioHarness Core
          |
          v
    PostgreSQL
          |
          | SELECT-only role
          v
    BioHarness Web backend
      - read repository
      - deterministic projection
      - REST API
      - SSE invalidations
          |
          v
    React client
      - task sidebar
      - task-stage graph
      - node detail drawer

## Authority boundary

BioHarness Core remains authoritative for scientific tasks, authorization,
execution, artifacts, validation and memory. BioHarness Web does not expose
create, retry, cancel, reconcile, approve, publish or mutation APIs.

The backend is the only browser-facing component with database access. The
browser never receives SQL credentials.

## Projection boundary

The UI consumes stable Web models rather than BioHarness table rows:

- TaskSummary
- TaskGraph
- TaskNode
- TaskEdge
- NodeDetail

The graph is stage-level. Low-level RunEvent records are drill-down evidence,
not top-level graph nodes.

## Memory honesty

A MemoryCandidate does not mean a task used memory. V1 marks memory as used
only when a persisted task context references it. If retrieval telemetry was
not persisted, the UI does not infer or fabricate it.

## Real-time behavior

/api/stream emits small SSE invalidation events. The client refetches the
affected task projection. If streaming is interrupted, the last graph remains
visible and the UI marks it stale/disconnected.
