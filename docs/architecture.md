# BioHarness Research Workspace — Architecture

**Status: target architecture baseline, 2026-11-25; W1 read side implemented 2026-11-26 (section 10.3).** This document defines the intended V2 product. Apart from section 10.3 it does not claim that the runtime has been implemented.

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

The model may propose scientific reasoning and tool use. Core controls the persisted scientific plan and progression. Mainline changes retain Core's existing trusted native-user-message confirmation path; the Web host must preserve the actual user message and verify the supported host seam in W0. A model or tool cannot confirm a change on the user's behalf. No sixth model-callable Core tool is assumed. The existing channel is Core's Agent-host hook, where the caller declares its own host and session; Core provides it for Claude Code, Codex and CodeArts. How a first-party Web host uses or replaces it is an open Core decision for W2 (see the plan).

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

Initial desktop-sized Web layout:

- **Left navigation:** research projects, scope tree, branches and request selection.
- **Center canvas:** selected research tree, workflow or evidence graph.
- **Right inspector:** selected node's scientific purpose, method, parameters, status, sources, results and limitations.
- **Conversation panel:** direct model API interaction, contextual to the selected project/request/node.
- **Activity/trace panel:** actual model and Module calls, errors and evidence events.
- **Top context bar:** selected project/scope, request, model/provider and connection state.

Panels may collapse or switch layout. The graph remains the primary scientific navigation surface; the conversation panel does not replace it. Node selection opens detail lazily. Raw logs and large outputs are drill-down content, not permanent graph nodes.

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
- `GET /api/workspaces/{workspace}/evidence-preview` takes the exact recorded anchor, has Governance resolve it, and only then reads the recorded file if it lies inside a configured root and outside any Core state directory; the check is repeated on the opened file. The file content is shown as recorded and is not rewritten. It reports recorded-reference match, Core snapshot integrity and whether the current file still matches, as three separate facts.
- Every data route requires the access token (bearer header, or an HttpOnly session cookie obtained by signing in). There is no write route.
- The frontend keeps selection in React state and snapshots in an SWR cache keyed by the view URL. Research tree and workflow are separate React Flow canvases laid out with Dagre from the returned edges only: recorded parent scopes and declared depends_on. Explicit related links are drawn dashed as context. Step status, review label and the current step are whatever Core returned.

## 11. Technology direction

[W0 integration and reuse audit](audits/w0-integration-review.md) records exact pinned source references, public-contract observations, reuse limits and remaining checks.

| Layer | Selected direction | Implementation boundary |
|---|---|---|
| Frontend | React + TypeScript + Vite | Retain compatible current components; no Next.js migration |
| Scientific graph | React Flow + Dagre | Source-backed controlled graph, no general workflow editor |
| State and refresh | SWR + local selection; existing SSE invalidation adapted | Query cache only; source snapshots remain authoritative |
| Conversation UI | assistant-ui / AG-UI | Adapt durable client and independent resumable-stream primitives; no full upstream Agent runtime or client-owned scientific transcript |
| Artifact/evidence view | Existing safe preview components; selective Vercel/Aivory patterns; Orrery candidate for W4 | Exact evidence anchors and bounded previews; no second W1 canvas |
| Backend | Python 3.12+ + FastAPI | Core public CLI read first; documented MCP/CLI/API tools |
| Model API | Pydantic AI direct API (official SDK fallback for demonstrated gap) | First owner-configured OpenAI-compatible transport candidate; actual provider/model activation remains open |
| Streaming | HTTP snapshots + shared SSE invalidation, AG-UI conversation frames | Connection independent of operation lifetime; refetch authoritative state |
| Persistence | Existing Core/Module stores; no W1 database; W2 local SQLite technical ledger | Durable operation/conversation association only, not scientific state |
| Desktop | Tauri client connecting to remote service | Deferred until Web acceptance |

Prefer pinned open-source components and small reviewed adaptations over bespoke infrastructure or full application forks. The source-level selection is not a package/build acceptance; lock actual dependencies and verify in the authorized Linux implementation stage.

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