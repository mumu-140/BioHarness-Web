# BioHarness Web Observatory

A small, independent, read-only Web interface for observing BioHarness
scientific tasks.

## V1

The homepage intentionally stays simple:

- task list/sidebar on the left;
- dynamic task-stage graph on the right;
- click a graph node to open that node's detail drawer;
- SSE refreshes changed tasks without turning the page into a log console.

The graph shows scientific/workflow stages such as Data, Assessment, Planning,
Execution, Collection and Validation. Raw events, artifacts and memory records
are drill-down detail.

## Safety boundary

BioHarness remains the authority plane. This app has no task creation, start,
retry, cancel, reconcile, approval, memory promotion or publication endpoint.
The database role must be SELECT-only with default_transaction_read_only = on.

## Development

Backend:

    pytest -q

Frontend:

    cd frontend
    npm ci
    npm test -- --run
    npm run build

Production image:

    docker build -f deploy/Dockerfile -t bioharness-web:observatory-v1 .

See docs/architecture.md and docs/deployment.md.
