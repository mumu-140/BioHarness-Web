# BioHarness Research Workspace — Architecture

**Status: target architecture baseline, 2026-11-25; W1 read side (section 10.3) and W2 native runtime (section 10.4) implemented 2026-11-26.** This document defines the intended V2 product. Sections 10.3 and 10.4 describe W1/W2; section 10.5 describes the integrated W3 observation surface and common inspectors, jointly checked on synthetic Linux workspaces; real domain-Module acceptance remains open. An isolated Linux check additionally completed one live-provider synthetic EXPLAIN cycle through the public Core and Project Governance interfaces, with two explicit resumptions after provider failures. A later integrated live-provider browser check completed a fresh synthetic EXPLAIN in one run, with a browser reload preserving the same request, actual Governance tools and offline restart/readback. Neither check establishes sustained reliability or real-project/scientific-quality acceptance.

## 1. Product purpose

BioHarness Research Workspace is the first-party user-facing scientific workspace for BioHarness. It gives a researcher one place to understand a long-running project, inspect its scientific branches, conduct work through direct model APIs and configured Modules, and trace results back to evidence.

The central object is the evolving research process. Chat is an interaction surface within that process, not the project's storage model or navigation structure.

The product is a research project and branch navigator; a dynamic scientific workflow canvas; a direct model API host that follows BioHarness Core; an integration surface for external scientific Modules; an evidence, result and provenance inspector; and a persistent workspace that can later be packaged as a Desktop application.

It is not a replacement for Core, a new scientific database, a generic workflow engine, a coding-agent wrapper or a full laboratory information management system.

## 2. System responsibilities

The runtime relationship is:

- Researcher → BioHarness-Web UI.
- Web → direct model provider APIs.
- Web → BioHarness Core through its public Host interface.
- Web → BioHarness-Modules through configured public MCP/CLI/API interfaces.
- Modules and Core → existing research workspaces, data locations and HPC.
- BioHarness-Eval → independent evaluation.

### BioHarness Core

Core remains the only scientific mainline. It owns the original request, scientific objective, locked requirements, plan versions, current next action, advisory reviews, submissions, evidence references and delivery.

The Web application uses Core's current five Agent-facing calls through the supported Host boundary. The initial adapter should evaluate the existing bioharness-host CLI as the simplest public integration; stdio MCP is an alternative. The implementation must not import private Core Python packages or read/write Core persistence files as a substitute for the public contract.

The Web backend is a first-party host of the Core workflow. It supplies the model and configured tools that the existing Core contract expects an Agent host to supply. This does not move scientific authority into Web.

### BioHarness-Modules

Modules own concrete scientific capabilities and their domain-specific knowledge. Web discovers and invokes only configured public interfaces such as MCP tools and documented CLIs. Core resource entries provide usage guidance; the Web runtime separately verifies that the referenced tool is available.

Project Governance is the current source for research-tree, scope-context, route-comparison and evidence-reference queries. Memory remains the authority for its T1/T2/T3 records and retrieval behavior. Literature, Scientific Review, Statistics and domain-specific analysis modules retain their own scientific logic.

### BioHarness-Web

Web owns researcher-facing interaction, native user-message/session custody, direct model API calls, context assembly, streaming, request-scoped model/tool execution, configured tool routing, technical execution/recovery, observed operational events, visual projections and UI preferences. These are host responsibilities, not scientific orchestration. Core alone determines scientific progression; the owning module alone supplies its domain logic (including Statistics report binding).

Web does not own scientific truth, a parallel research plan, a second Memory, a second project tree or a separate scientific verdict engine. It never reproduces Core's step eligibility, dependency, requirement coverage, goal-amendment or delivery checks. No independent Research Workspace client/package is developed in Modules; this repository is the sole product.

### BioHarness-Eval

Eval remains independent. It is not a production runtime dependency.

## 3. Native API research cycle

1. The user submits the original research question in Web.
2. Web calls Core science_begin with the original text before performing research work.
3. Core returns the request identity, provisional scientific guidance, current rules and next action.
4. The configured model API receives the original question, Core guidance, relevant project context and available Module resources.
5. The model proposes a plan. Web submits that proposal through Core science_plan; Core returns its review and first actionable step.
6. Web calls science_now when recovering state or when the next action is uncertain. Core, not a Web-owned workflow state, determines what happens next.
7. The model works on the current step and calls configured MCP/CLI/API tools through the Web runtime.
8. Web collects actual tool outputs and evidence references. The model prepares a step report; Web submits it through science_submit.
9. Core reviews the submitted work and determines the next action. The loop continues, asks the user when necessary, revises the plan when appropriate, or reaches delivery.
10. Web submits the final answer through science_deliver and renders the recorded delivery and limitations.

The model may propose scientific reasoning and tool use. Core controls the persisted scientific plan and progression. Mainline changes retain Core's existing trusted native-user-message confirmation path; the Web host must preserve the actual user message and verify the supported host seam in W0. A model or tool cannot confirm a change on the user's behalf. No sixth model-callable Core tool is assumed. The channel is Core's generic Agent-host hook CLI, driven by the Web backend as itself with a server-generated session per conversation and no impersonated Agent host (decision and limits in the plan, W2; mechanics in section 10.4).

Core advisor feedback is advice, not a blocking gate. A missing or failed advisor is shown as unreviewed, not converted into a new approval state. The existing Scientific Review runtime currently uses an external reviewer runner; W0 verifies the seam for direct model API review inside that module, and W2 integrates the minimum compatible adapter if needed. No second review controller is built in Web.

## 4. Core and Module integration

### Core Host adapter

The adapter invokes only supported public Core calls, passes the original user question verbatim to intake, retains and explicitly passes request_id for every continuation, parses the structured Core response and follows its instruction/action/call, recovers through science_now after restart or interrupted execution, and preserves must_not_stop, wait-for-user and partial-delivery semantics.

The initial implementation compares supported CLI and stdio MCP transports under the installed Core version. W0 records exact public calls, schemas, workspace selection, request discovery limits, revision/error semantics, recovery, and trusted user-message confirmation. No new Core REST API, event bus or private import is assumed. Use actual supported request discovery; a Governance tree does not enumerate all unscoped requests, and a native MCP process ID is not an Agent session identity. CLI and MCP behave differently when request_id is omitted, so every continuation and every mutating call passes it explicitly. The one deliberate exception is the read-only open-request listing, which asks science_now without one precisely to obtain Core's own list (section 10.3); its answer is never used as a selection.

### Module tool adapters

The runtime may expose configured tools through MCP or documented CLI/API adapters. The tool list sent to a model is an ephemeral view of the configured runtime, not a second scientific Capability Registry.

A resource declaration does not install a tool, grant filesystem access or prove that the tool works. Host configuration identifies the actual adapter, command/server and workspace. Module-specific instructions and schemas remain with the module.

First integration candidates:

- Project Governance: project tree, context, routes and evidence.
- Memory: FAST/STANDARD retrieval, T1/T2/T3 expansion and explicit use feedback (DEEP and TaskMemoryGraph once the module exposes them publicly).
- Literature: paper search and fetch with source-backed records.
- Scientific Review: existing Core advisor bridge and review records.
- Statistics: biological/statistical method guidance, grouping and denominator semantics.
- Domain workflows: selected real capabilities such as DAP-seq, Genome-web TF or RNA-seq after their current public contracts are verified.

No module is assumed available merely because it appears in the repository index.

## 5. Four distinct scientific views

These views are related, but must not be collapsed into one graph.

### 5.1 Research Tree

The project-level tree answers: **What is the long-term research goal, and how are its questions and branches related?**

It is based on explicit Project Governance scope records and request references. Show research scopes and parent-child relationships, original goal and locked mainline, current and historical requests, explicit related-request edges, goal-version differences, current branch and recent activity, and historical routes when requested.

An unscoped Core request remains unscoped. The UI must not invent a project or silently bind a request to the most recently viewed scope. If multiple open requests exist, the researcher selects the intended request explicitly.

Governance is read-only, recomputed from Core records, not a project lifecycle or state machine. Scope ancestry, related-request edges and recorded goal-version differences are context, not execution gates. A goal-version difference prompts evidence review; it is not proof of a changed scientific premise or invalid result. Do not introduce cross-request hard dependencies or automatic SUPERSEDED states. Cross-request reuse requires actual evidence references and scientific applicability checks.

### 5.2 Scientific Workflow

The workflow view answers: **How is this specific scientific question being addressed now?**

Generate it from the selected Core request and current plan: objective and requirements, plan steps and serves links, dependencies and optional exploration steps, declared method/parameters/deliverables/checks, recorded submissions and unresolved steps, plan revisions and invalidated downstream reuse.

The graph is dynamic. It must not impose a fixed biological workflow template. It shows the scientific plan and recorded progress, not every low-level event. Step state, within-plan depends_on and reuse invalidation are projected from authoritative Core responses/records exposed by public interfaces; Web does not independently evaluate these rules. Missing history stays unavailable until an existing supported read path is verified. At Core 0.2.0 that covers plan revisions, reuse invalidation and the submissions of unscoped requests.

### 5.3 Evidence and Provenance

The evidence view answers: **What data, sources, methods and observed outputs support this result?**

Connect inputs and data versions to tool invocations; methods, versions and parameters to result artifacts; tool outputs to Core submissions; cited sources to claims or method rationale; and validation records to results or findings.

Only explicit or otherwise source-backed relationships may be shown as established edges. Co-occurrence or model-generated association is not a causal or evidential relationship. Candidate relationships must be visually distinguished. Missing links remain unknown.

### 5.4 Execution Trace

The execution view answers: **What did the Web runtime and its configured tools actually do?**

Show observed model provider/model, request timing, token usage when supplied, tool name/adapter, redacted arguments, start/end and exit status, bounded output summaries, artifact references, errors, retries, interruption and recovery.

Do not show private chain-of-thought or fabricate internal reasoning. An observed tool call is not scientific validation. Core's execution_verified=false disclosure must not be contradicted by the UI.

## 6. Main workspace interaction

The owner finalized the separated-page design on 2026-11-27 and deferred further visual optimization. The custom four-zone UI is retired; conversation and research workflow occupy separate primary pages, following `dsh-context`'s page organization. The accepted layout and fixed mature reuse selections, including LibreChat as the complete application foundation, are recorded in [the sole roadmap, §17.4–17.5](plans/2026-11-25-research-workspace-v2.md#174-upstream-based-ui-replacement-design-2026-11-27). No hand-built foundation or complex interaction component. Roadmap §17.4 step 1 has completed exact source acquisition, package/license verification, an isolated original-lock npm dry-run and the full 236-test Python baseline; no replacement dependencies were installed and no replacement application was built. Implementation steps 2–5 and browser acceptance remain open.

- **Shared navigation:** one adopted application sidebar, explicit service/workspace selection, arbitrary-depth Governance scope tree, request history and Unscoped Requests. The request header shows the readable question and breadcrumb above **Conversation / Research workflow / Evidence** tabs. Execution records are an auxiliary page reached from the header. Scientific, execution and connection states stay distinct, but appear contextually rather than as a wall of status cards. The read-only Attention Stream aggregates existing `A#`, `WAIT_FOR_USER`, `begin_reconcile` and `goal_version_changes`; clicking only navigates.
- **Conversation:** an independent message/composer page with native-user response items, actual model messages, concise invocation summaries and evidence links. No permanent graph, evidence sidebar or execution log. Scope, Request, Conversation, Run and Operation remain distinct; one conversation binds to one request. Unsupported donor actions are removed, and navigation never silently changes that binding.
- **Research workflow:** one full-width Core plan, adapting dsh-context's separate views and selection treatment without copying its dense dashboard. No permanent step inspector, evidence card column or lower event panel. Selecting a step opens a detail subpage in place of the canvas; returning restores its viewport. Local detail sections separate method, inputs/outputs and recorded evidence. Upstream Agent ancestry is not a scientific dependency; multiple `depends_on` predecessors must be represented faithfully.
- **Execution records:** a request-level auxiliary list/detail page, independent of the mounted conversation component. Attach an event to a step only with a trusted host-recorded link and owner-confirmed matching plan version; otherwise keep it at Request level. Pagination, actual returned timestamps and recovery outcomes remain explicit. An execution record is not scientific validation.
- **Evidence:** a dedicated list → single-item detail route, not a permanently open pane. Data, Methods, Results, Evidence, Comparison and Findings remain eventual content dimensions, not six empty panels. Request and Scope history remain distinct, with bounded pagination and partial/unavailable disclosure. Previews use the complete workspace/request/submission/evidence/SHA-256 anchor, verify the live file and disclose historical drift.

Route switches, back/forward and reload preserve explicit request context, drafts, selections and return positions; they do not cancel work or trigger scientific actions. “Discuss this step” prepares a visible editable reference without sending it or changing Core's next step. Narrow screens use a navigation drawer and a dependency-labelled step list with an optional fullscreen graph; details take the primary area instead of stacking sheets. Default to plain scientific language with IDs, JSON and diagnostics collapsed, automatically exposing relevant details on `partial`, `failed` or `UNKNOWN`. A 503 retains the last confirmed snapshot with its timestamp and refresh action. Token/cost/context charts require actual recorded inputs and never expose private reasoning.

The [static design boards](plans/research-workspace-ui-design.html) illustrate this refinement using diagram-design and hello-ui guidance. They are design-only artifacts, not the replacement application; no application build is authorized by the current design request.

## 7. Module-specific inspectors

A generic JSON viewer is insufficient. Use small domain-specific renderers over module outputs.

| Module | Important visible information |
|---|---|
| Project Governance | scopes, goals, branches, prior routes, explicit related requests, evidence references |
| Memory | T1 themes, T2 memories, T3 sources, retrieval depth, applicability gaps, conflicts and explicit use feedback; relation paths when publicly returned |
| Literature | query, source/database, search time, paper, abstract, DOI/URL, fetch/validation record and limitations; passages when publicly returned |
| Scientific Review | intake guidance, plan/work/delivery review, concerns, unreviewed status and response |
| Statistics | experimental unit, data grain, grouping variables, combinations, numerator/denominator, background, test/model, effect size and multiple-testing correction |
| Analysis / Workflow | inputs, software/version, parameters, actual invocation, outputs, logs, failure and recovery |
| Model Runtime | provider/model, request timing, token/cost metadata when available, tool calls and transport errors |

The UI renders what the module actually returns. It does not recreate module algorithms in TypeScript. Statistics report binding invokes the existing module renderer/verifier and displays its structured result, evidence and report; numerical consistency is distinct from scientific correctness.

### Common inspector and optional domain renderers

W0 defines a minimal common invocation projection: service/workspace and explicit request/step association when known; operation and tool/module identity and version when supplied; observed phase, start/end, status/error; bounded redacted input/output references and evidence anchors. Preserve actual source and missing fields. Internal phases, snapshots, consumption and validation are displayed only when the owner or runtime records them. The common inspector handles unknown modules; high-value domain renderers are ordinary optional UI components selected by supported output type/version. No new module schema, registry, plugin SDK or mandatory internal instrumentation is required.

## 8. Direct model API runtime

The first runtime is a small request-scoped loop in the Python backend, not a general-purpose Agent framework.

It provides direct provider API clients, backend-only credentials, provider/model selection from trusted configuration, streaming responses, structured tool-call handling, configured MCP/CLI adapters, interruption and recovery, bounded context construction and operational trace events.

Provider adapters remain thin. Prefer official provider SDKs or documented OpenAI-compatible endpoints. Do not require a hosted gateway, proprietary Agent product or external Agent process. W0 chooses the first provider set based on actual APIs and available credentials.

Do not pass all historical conversations or entire datasets to a model by default. Supply the original question, current Core instruction, relevant scope/context, current step, available resource instructions and evidence needed for that step. Memory retrieval depth and source expansion follow the Memory module's own interface.

## 9. Persistence and event model

There is one authority for each kind of data:

- Core request/plan/submission/delivery: Core workspace records. The current FileScienceStore uses one JSON request, per-request file locking and atomic replacement, revisions, and a separate scope-declaration lock. There is no Core SQLite/PostgreSQL database. Public calls remain the authority; stale concurrent changes require refresh/reconciliation.
- Project tree and route projections: Project Governance over Core records.
- Memory content, relations and usage feedback: Memory module store.
- Literature and scientific source material: the source/module that provides it, with references returned to Core.
- Scientific files and results: configured project/HPC/data locations.
- UI preferences: Web user/workspace settings.
- Model/tool operational trace: Web runtime telemetry, explicitly non-authoritative for scientific task state.

W1 read-side requires no Web persistence database. W2 uses a single local SQLite technical ledger for durable operation identity and conversation association, with bounded operational trace; reuse upstream thread-store primitives if compatible. This is justified by ambiguous-start/restart recovery and atomic identity uniqueness, not a scientific state store. It never becomes a scientific task or project database. Memory SQLite is owned by Memory, not Web. Governance reads are not transactional cross-request snapshots; refresh when needed and report partial/stale/unreadable data rather than infer state.

A visual graph is a projection, not a new source of truth. Every node/edge carries a source reference or an explicit unknown/candidate status.

## 10. Shared projection, realtime and execution lifecycle

### 10.1 One update path for W1 and W2

Use HTTP request/response for user actions and SSE for server-to-client invalidation and streaming. Both W1 read-side projections and W2 live actions use the same public-query adapter and update path.

- Read current snapshots from Core public calls and Governance/Module public queries. Associate each snapshot with service/workspace, explicit request identity when applicable, and available source revision or opaque projection version. Keep scientific state distinct from technical events.
- Web emits observed model/tool events and projection invalidations; refresh after Core mutations and poll supported queries at a measured interval to notice external writers. No Core event bus or direct file watching is required.
- W0 defines initial snapshot, event identity/order, duplicate/out-of-order handling, targeted refetch, reconnect and full resync when replay is unavailable. UI shows last successful snapshot and stale/disconnected state. No event is proof of a change unless supported by the source.
- Render current plan and scope from the refreshed authoritative projection; do not infer scientific status from streaming tokens, timestamps, tool exit or SSE delivery.

### 10.2 Technical execution lifecycle (W0 contract)

Browser/HTTP/SSE lifetime is separate from model/tool operation lifetime. A long bioinformatics operation runs in a backend-managed worker or a configured existing external executor; closing the browser is not a cancellation. W0 selects the smallest supported mechanism; no scheduler or queue product is assumed.

- Persist enough technical identity to correlate and recover in-flight work (service/workspace, explicit Core request, step/plan reference when available, operation ID, external job/process handle when supported, timestamps, observed outcome and output references). This is operational metadata, not a second scientific task record.
- Recover by re-reading Core through science_now and querying/reconciling the executor's actual state. Core recovery does not prove that a remote process is still running or reattachable. Report unknown outcomes honestly and inspect before retrying.
- Separate connection loss, provider timeout, process failure, partial output, Core WAIT_FOR_USER, cancellation requested, cancellation confirmed, and scientific delivery. Cancel only a supported identified operation on actual user request; stopping a stream does not stop remote computation.
- Prevent duplicate starts/submissions after ambiguous network errors. Use host operation correlation and provider idempotency only when supported. An unbound science_begin can create a new request on replay; recover its identity or flag uncertainty. On STATE_CHANGED refresh science_now; do not retry stale mutations blindly.
- On successful actual execution, return source-linked outputs and evidence through the existing science_submit path. No fabricated completion on timeout or loss of a transport.

W0 must record a bounded lifecycle contract and validation cases before W1, including same-request concurrency, cross-session recovery, timeout with unknown outcome, reconnect, user confirmation and long-operation result handoff. Implementation and fault-injection acceptance are W2.

### 10.3 Implemented read side (W1)

The backend holds no scientific state and no database. It is configured with explicit workspace ids mapped to server directories, the two CLI commands and one service access token; it binds loopback unless configured otherwise.

- `GET /api/workspaces/{workspace}/views/{view}` returns one snapshot. Views: `now` (Core science_now for an exact request_id), `open` (the open requests Core itself names when science_now is asked without a request_id; never a selection), and Governance `tree`, `context`, `routes`, `evidence`. Each CLI is run with fixed argv, without a shell, with a timeout, an output-size bound, a concurrency bound and an environment reduced to what a process needs to start (no service token, no provider credential, no inherited BIOHARNESS_* override). Core receives its arguments as JSON on stdin; Governance takes flags only. Core is not called for a workspace whose `.bioharness` state directories do not all exist, because the Core CLI would create them.
- A snapshot carries service, workspace, view, selector, owner and interface, observation time, the owner's data or refusal, the version the owner exposes (Governance view_sha256/shared_sha256; none for Core), an opaque content digest, Core's shortening note and Governance warnings. The digest answers "same or different", never "newer". It is taken over the bounded answer, so a change confined to text Core omitted is not detected.
- `GET /api/workspaces/{workspace}/stream` is the SSE channel. The server polls the watched views and sends the digest it observed; the browser refetches when it differs from the snapshot it holds. Events carry no scientific data. Governance is polled every interval and Core every third interval.
- `GET /api/workspaces/{workspace}/evidence-preview` takes the exact recorded anchor, has Governance resolve it, and only then reads the recorded file if it lies inside a configured root and outside any Core state directory; the check is repeated on the opened file. The file content is shown as recorded and is not rewritten. It reports recorded-reference match, Core snapshot integrity and whether the current file still matches, as three separate facts. This implemented interface is bounded text, not a binary/range or structured-table service: binary previews are unavailable, large text may be excerpted and direct hashing has a 64 MiB bound. Extend the Web read adapter only for actual selected-viewer needs, retaining authentication, exact-anchor resolution, safe opened-file custody and explicit drift/unverified/partial status as specified in the sole roadmap §17.5.
- `GET/HEAD /api/workspaces/{workspace}/evidence-content` and `GET /api/workspaces/{workspace}/evidence-table` extend that same authenticated exact-anchor, workspace-containment and SHA-256 verification boundary to byte-range verified PDF/image/code/HTML delivery (`206`, `ETag`/`If-Range`, `409 EVIDENCE_CONTENT_DRIFT`, HTML forced to `text/plain` on the API origin) and bounded CSV/TSV pagination (`total_rows: null` when truncated, `sort_scope: "loaded_rows_only"`).
- Every data route requires the access token (bearer header, or an HttpOnly session cookie obtained by signing in). The read side has no write route. The only routes that start or change anything belong to the native runtime (10.4) and exist only when it is configured.
- The historical W1 frontend kept selection in React state, SWR snapshots and separate React Flow canvases. The adopted frontend replaces that presentation and query cache with the fixed donor routing/React Query and rc-tree/React Flow/Dagre selection in §11 and the sole roadmap. Preserve explicit service/workspace/request/selector identity, snapshot invalidation and only source-returned parent scopes, related context and declared depends_on. Step status, review label and the current step remain Core-returned facts.

### 10.4 Implemented native runtime (W2)

Enabled only when a model endpoint and a ledger file are configured; the read side works without it.

- **Conversation and request.** A conversation belongs to exactly one Core request. For a new question the host, not the model, calls `science_begin` with the user's text exactly as sent and the scope the user chose. An existing request is continued only by its explicit id, confirmed by a real `science_now`. When Core answers `science_begin` with a request that already existed (without a session it does so for an identical question when exactly one request is open), the host does not adopt it: the user attaches it. A refused `science_begin` created nothing and the question can be sent again. The association is set once and never changed; after delivery a follow-up is a new conversation.
- **Loop.** Each model request carries a short technical preamble, Core's research rules and Core's latest answer for the request. The model is offered Core's own definitions of `science_now`, `science_plan`, `science_submit` and `science_deliver` (read from Core's MCP tool list) and the tools of configured stdio MCP servers, nothing else. The host sets the conversation's request on every Core call, executes the call through the public CLI and returns Core's answer to the model with no field added, removed or reinterpreted (configured directories are relabelled). A provider turn must carry an actual terminal reason and finish normally before any proposed call is executed; truncated, filtered or quietly disconnected responses fail as PROVIDER_INCOMPLETE, even if an earlier tool-call fragment is valid JSON. The adapter checks the provider's recorded reason, not just an SDK-inferred finish. Provider response/stream errors are reported separately from connection failures; provider error bodies are not forwarded, and a failed turn dispatches none of its proposed calls. When the model ends a turn without a call, the host asks Core's `stop` hook; a block is given to the model in Core's words. If Core no longer blocks but still reports `must_not_stop`, the run ends as interrupted, not as finished. Web never chooses a step, judges a result or computes coverage.
- **User messages.** Every user message of a conversation with a request is sent verbatim to Core's `prompt` hook under the conversation's server-generated session, which is how a mainline amendment is confirmed. The session is bound to the request with the `post-tool` hook after each successful Core call. A message is accepted only when no run is in progress.
- **Uncertain outcomes.** A mutating Core call that gets no answer in time is recorded UNKNOWN, is not repeated, and is followed by `science_now`, which is what the model sees next. A refusal is shown to the model and followed by `science_now`. An unanswered `science_begin` leaves the conversation without a request: the user attaches the request Core created, chosen from Core's own open list, or starts a new conversation. If a refused mutation cannot be followed by a successful `science_now`, the run is INTERRUPTED rather than asking the model again with stale state. Dropping an old result from model context never recommends replaying a side-effecting call.
- **Runs and ledger.** A run is a backend task; closing the browser does not affect it. One SQLite file records conversations, runs, operations and the event log. The log holds what was observed, which includes the text of Core's answers as the output of each operation, for the execution trace. It is never read back as state: the plan, progress and next action that are shown or given to the model always come from a fresh Core answer. At most one run is in progress per conversation and per request. After a restart a run that was in progress is INTERRUPTED and an operation that had started is UNKNOWN; a later run starts from `science_now`. Cancel is an explicit request for one run, recorded as requested, and confirmed by the run's final event. The model request is closed at once; a Core or tool call already in flight is awaited so that its outcome is known. When a call of a turn is refused or goes unanswered, the later calls the model proposed in that turn are not carried out.
- **Events.** `GET .../conversations/{id}/events` replays recorded events after a sequence number and then follows live. Recorded events carry ids; when the reader's cursor is ahead of the current log, a non-persisted `stream.reset` control event with id `0` clears the browser's old events/draft before full replay and refreshes dependent projections. Ordinary duplicate events still deduplicate by sequence. Text still being written is sent without an id, a little behind the newest characters so that an echoed credential is removed first, and is replaced by the recorded text.
- **Paths and credentials.** A label in a model's argument is expanded only when the whole value is a labelled path, and every proposed evidence file must resolve inside a configured directory and outside any Core state directory, otherwise nothing is called. A module tool's schema does not say which arguments are paths, so each single-line string argument is treated as one when it is absolute, starts with `~`, has a parent or Core-state segment, or names something existing in the workspace, and is then held to the same rule; module servers run in the workspace directory. The module itself remains responsible for what it does with other strings. The model key and the service token are never sent to a child process and are removed from events and model input if echoed.

### 10.5 Implemented Module observations and common inspectors (partial W3)

The integrated UI provides the invocation timeline, common invocation/Module inspectors and bounded structured-result views. Synthetic browser checks cover returned errors, omitted data, unrecorded Memory use, unavailable servers and runtime-disabled mode; real domain-Module acceptance remains open. This is a read projection of the existing technical ledger, not a second Module registry or scientific database.

- `GET /api/workspaces/{workspace}/conversations/{id}/invocations?limit=50&before=CURSOR` returns newest-first recorded operations with service/workspace/conversation/request context, operation/run id, kind, tool/model name, configured server name when recorded, start/end time, observed state, redacted input/output/error and other recorded completion metadata (such as provider usage). `limit` is 1–100; `next_before` is null at the end. The cursor orders operation creation, not scientific revisions. Refetch the first page to refresh in-flight outcomes; existing conversation SSE events notify changes. If its pagination boundary moves or the stream reconnects/resets, the UI discards older pages and starts again from the new boundary, ignoring late replies from the old chain so live additions cannot leave an unfillable gap.
- Payloads join by exact operation identity, not tool name. An operation without a recorded start or answer retains null input/output/server; restart leaves in-flight outcomes UNKNOWN, not completed or cancelled. The envelope's request is the conversation context: a Core read of another request keeps that explicit id in its recorded input. Step/plan/module-version identity is not guessed.
- `GET .../conversations/{id}/modules` returns current configured server names with their last recorded discovery in this conversation: NOT_OBSERVED, LISTED or UNAVAILABLE, observation time/run, actual listed tool names and the subset offered after name conflicts. No command, environment or credential is exposed. Historical discovery is not current reachability, proof of installation, invocation, consumption or scientific validity; after configuration changes a new run must discover tools again. Older ledgers without discovery events remain NOT_OBSERVED; notices are not parsed or backfilled into claims.
- A module's MCP `structured_content` is retained alongside the bounded text without reinterpreting owner fields, including returned errors, evidence and explicit Memory-use records. Oversized structured values use the ledger's explicit omitted/head marker. Existing event bounds can also omit an oversized combined output; omitted content is never reconstructed. Non-text MCP content remains explicitly not shown. No report binding, numerical check, Memory usage decision or scientific verdict is implemented in Web.
- These routes reuse existing service authentication, exact conversation/workspace checks and no-store responses. Reads neither invoke scientific tools nor access Core record files. Configured paths and this service's credentials are removed from output, including credential echoes in JSON keys.

## 11. Technology direction

[W0 integration and reuse audit](audits/w0-integration-review.md) records exact pinned source references, public-contract observations, reuse limits and remaining checks.

| Layer | Selected direction | Implementation boundary |
|---|---|---|
| Frontend | Complete LibreChat React/Vite frontend at the roadmap's fixed pin, with selected dsh-context presentation | Preserve donor React 18 baseline; retire current custom shell/pages/styles; UI-only build, C1–C5 security/SPA/SW closure and Step 3 native vertical slice (workspace/request/conversation/SSE/HITL/UNKNOWN/R2 model settings) verified in `ui/` against both fixture loops and an authorized live-provider Core loop (`auto/deepseek-v4.1-flash`); Step 4 scientific views/evidence viewers and Step 5 replacement remain open |
| Scientific graph and tree | React Flow + Dagre for plan dependencies; rc-tree for Governance navigation | Mature interaction/layout implementations only; multiple predecessors, no Agent ancestry substitution, no graph editing or tree reparenting |
| State and refresh | Donor React Query/routing adapted to BioHarness HTTP/SSE and cache isolation | Source snapshots remain authoritative; no parallel query store or donor scientific runtime |
| Conversation UI | Complete LibreChat message/composer surfaces on a separate primary route | Adapt existing host/provider seams to server-recorded events and native HITL; no upstream Agent execution or client-owned transcript |
| Artifact/evidence view | Donor list/detail surfaces; AG Grid Community for complex tables, PDF.js generic viewer for PDF, donor Monaco/image views | Exact evidence anchors, bounded safe previews and drift disclosure; no new grid, document viewer or active artifact runtime |
| Backend | Python 3.12+ + FastAPI | Core public CLI read first; documented MCP/CLI/API tools |
| Model API | Pydantic AI direct API (official SDK fallback for demonstrated gap) | Owner-configured compatible endpoint activated for synthetic transport/runtime/browser checks; real-project and wider-provider acceptance remain open |
| Streaming | HTTP snapshots + shared SSE invalidation; SSE conversation event log | Connection independent of operation lifetime; refetch authoritative state |
| Persistence | Existing Core/Module stores; no W1 database; W2 local SQLite technical ledger | Durable operation/conversation association only, not scientific state |
| Desktop | Tauri client connecting to remote service | Deferred until Web acceptance |

Use pinned application source as the UI foundation and preserve upstream licensing and modification notices. The owner superseded the earlier component-only policy on 2026-11-27. Source inspection does not establish package/build or browser acceptance: dsh-context relies on Harness services and its module loader, so port its presentation into the adopted Web application while replacing host/data seams. The current R2 backend through `1b99677` (including model configuration/discovery and provider failure behavior) remains the replacement baseline. The adopted UI must prove a UI-only build and browser interactions without LibreChat business-backend calls, donor database or execution services; adapt its authentication, routing and host-provider seams to the existing BioHarness service. Do not introduce another execution framework, transcript authority or scientific database. The ordered implementation and acceptance checklist is in the sole roadmap §17.4.

## 12. Desktop strategy and remote topology

The default product topology is a remote Linux BioHarness service with Browser and later Tauri Desktop clients. Core, Modules, research data and external compute may reside in configured service-side workspaces and compute locations. The user interface uses authenticated application APIs and SSE with an explicit service/workspace/request identity; a client filesystem path is not a server filesystem path. Evidence previews resolve only authorized server-side references. A shared mount or different Git worktree is not automatically the same canonical workspace.

Desktop reuses the same frontend and backend contracts. A local sidecar or hybrid mode is optional only after a real requirement is demonstrated; it must not fork the scientific workflow or tool runtime. W0 freezes the default remote topology and workspace addressing; W5 handles packaging, native integration and multi-device validation. Host selection, authentication and deployment parameters are verified rather than assumed.

## 13. Non-goals

Not part of the initial V2 implementation: a new Core API or scientific domain model; a replacement for Project Governance or Memory; a new scientific Module Registry; a generic low-code workflow editor; a universal multi-agent framework; an independent scientific planner competing with Core; a new graph/vector database by default; a full JupyterLab or Galaxy replacement; a new HPC scheduler; collaborative multi-user editing; automatic publication or scientific claim promotion; Desktop-first implementation.

## 14. Source references

These projects and papers are design references, not dependencies or instructions to copy their complete architectures.

- [Galaxy](https://galaxyproject.org/) and Goecks et al., Genome Biology 2010, [doi:10.1186/gb-2010-11-8-r86](https://doi.org/10.1186/gb-2010-11-8-r86): reproducible analysis histories, workflow authoring and dataset provenance.
- [AiiDA](https://www.aiida.net/) and [AiiDA-WorkGraph](https://github.com/aiidateam/aiida-workgraph): process/data provenance, workflow graphs, remote execution and recovery. The WorkGraph GUI is evolving; treat it as a reference, not an assumed production dependency.
- [JupyterLab](https://github.com/jupyterlab/jupyterlab): multi-panel scientific work environment and inspection patterns.
- [React Flow](https://reactflow.dev/), [Dagre](https://github.com/dagrejs/dagre) and [ELK](https://github.com/kieler/elkjs): interactive graph rendering and layout.
- [grow-me](https://github.com/Trunks820/grow-me), reviewed by Modules at commit 52176cfce7f8038883129076c5d0a13a634e2bd9, MIT: research-tree interaction reference. Preserve attribution and license if code is reused.
- [Research Workflow Studio](https://github.com/BorgDiven/research-workflow-studio), [Research Deck](https://github.com/RickWayne1125/research-deck) and [Hypothesis Atlas](https://github.com/widsith-ai/hypothesis-atlas): emerging research-workspace references. Audit source quality, maintenance and licenses before copying code.
- Ghareeb et al., “A multi-agent system for automating scientific discovery,” Nature 2026, [doi:10.1038/s41586-026-10652-y](https://doi.org/10.1038/s41586-026-10652-y): iterative hypothesis generation, experimental analysis and feedback. Borrow the research-loop framing, not the requirement to deploy external agents.
- Qu et al., “BiomniBench: Process-level Evaluation of LLM Agents for Real-world Biomedical Research,” 2026 preprint, [doi:10.64898/2026.05.12.724604](https://doi.org/10.64898/2026.05.12.724604): process-level evaluation dimensions and task-specific rubrics; treat as a preprint.
- [Vercel AI SDK](https://github.com/vercel/ai) and [Tauri](https://tauri.app/): optional UI streaming and later Desktop packaging references. Neither requires deployment on Vercel.

## 15. Architecture change rule

A proposed change identifies which existing authority owns the data or behavior, why its public contract is insufficient, and whether the change belongs in Web, Core, Modules or Eval. Do not add a new state machine, database, registry, execution framework or scientific abstraction solely to simplify the frontend.
