# BioHarness Research Workspace V2 — Product Plan

**Date:** 2026-11-25  
**Status:** W1 read side and the W2 native runtime are implemented and tested on synthetic fixtures with a scripted model endpoint, including in a real browser; short live-provider transport and synthetic EXPLAIN passed with explicit recovery; the integrated live-provider browser cycle also passed in one run with reload and offline readback; real-project acceptance open
**Implementation status:** W1 and W2 acceptance remains open (see their checklists); W3 common invocation/Module inspectors, timeline and discovery states integrated and jointly checked on synthetic Linux workspaces; real domain-Module acceptance open; W4 private deployment smoke verified, evidence/provenance and real-project pilot open; W5 not started
**Repository:** mumu-140/BioHarness-Web

## 1. Purpose

Build a first-party AI research workspace that lets a researcher see and conduct the complete scientific process in one environment.

The application must make visible the long-term research goal; research branches and questions; what Core currently asks the system to do and why; methods, data and Modules in use; actual Module outputs and tool calls; evidence, counterevidence and unresolved questions; and how the current work changes the next scientific action.

The Web application calls model APIs directly and hosts the model/tool loop itself. It does not rely on an external Agent product. Core remains the scientific authority; Modules remain the owners of concrete scientific capabilities.

## 2. Product outcome

A researcher should be able to open a project and move through four levels:

1. **Project:** understand the long-running question, project scopes and research branches.
2. **Question/task:** inspect the current objective, requirements, plan, dependencies and next step.
3. **Method/module:** inspect the actual literature, Memory, statistical reasoning, analysis method, parameters and tool activity.
4. **Evidence/result:** inspect source files, outputs, figures, validations, findings, limitations and the links that connect them.

The primary screen is a scientific workspace with a project tree, interactive workflow canvas, contextual inspector and AI conversation. The graph is the primary navigation surface; chat is a contextual way to work on the selected scientific object.

## 3. Fixed decisions

| Topic | Decision |
|---|---|
| Product | First-party AI Research Workspace, not the former Observatory |
| First platform | Web |
| Later platform | Tauri thin client connected to remote BioHarness service after Web acceptance; local sidecar optional later |
| Model calls | Direct provider API from Web backend |
| External Agents | Not required; no CC/Codex/CodeArts runtime dependency |
| Core | Existing five science_* calls remain the only scientific mainline |
| Modules | External domain capabilities invoked through documented public interfaces |
| Project tree | Read-only Project Governance projection; no independent state machine or inferred cross-branch gates |
| Workspace ownership | BioHarness-Web is the sole product; retire the planned Modules client |
| State updates | W1/W2 share public-query snapshots, observed events and SSE refresh |
| Long operations | Independent of browser/HTTP/SSE; technical recovery and explicit cancellation |
| Module views | Common invocation inspector with optional domain renderers, no plugin framework |
| Memory | Reuse existing Memory module and its T1/T2/T3 and TaskMemoryGraph semantics |
| Graphs | Separate project tree, scientific workflow, evidence/provenance and execution trace |
| Frontend | React/TypeScript/Vite and current React Flow are first reuse candidates |
| Backend | Current FastAPI is a candidate; refactor if V2 requires it |
| Persistence | Core and Module stores remain authoritative; no new scientific database by default |
| V1 compatibility | Not required; old code, APIs, schemas and UI may be replaced after dependency review |
| Eval | Independent; use its tasks and Gold without moving evaluation authority into Web |

## 4. Existing repository baseline

The current main baseline reviewed for this plan is fa87344508df95b4a869e51999d798c00008a0c9.

The repository contains React 19, TypeScript, Vite and @xyflow/react; a FastAPI backend; a PostgreSQL read-only Observatory service and projection models; SSE invalidation and a task-stage graph; archived September 2026 Observatory design and implementation documents; and V1-specific validation records.

That baseline was a read-only observer over the former managed-record/PostgreSQL model. W1 removed its PostgreSQL projection, task-stage graph and container files and replaced them with the public-CLI read side described under W1. W2 subsequently implemented the direct-API transport, public Core mutations and configured MCP tool execution as a first-party host; the initial check used a scripted endpoint. Later synthetic live-provider and integrated browser checks are recorded under W2; real scientific acceptance remains open.

Existing code is not automatically reusable merely because it is present. The implementation review classifies each component as retain, adapt, replace or remove. No V1 database/API/page compatibility is required.

## 5. Authority and integration contract

### 5.1 Core

Use the current five calls:

- science_begin: preserve the user's original question and obtain initial scientific guidance.
- science_plan: submit the model's proposed question type, objective, requirements and steps.
- science_now: retrieve the authoritative current phase, instruction, step and next call.
- science_submit: submit actual step work and evidence.
- science_deliver: deliver the answer to the original question with limitations.

The initial integration uses the supported Core Host CLI or stdio MCP. The current Core README documents the CLI call form. W0 verifies the installed Core version, workspace behavior, argument encoding and process lifecycle before choosing the adapter.

Every follow-up call uses the explicit request_id. The Web runtime must not read/write Core state files directly, import Core private implementation or maintain a competing task state machine. Current Core persistence is FileScienceStore (JSON, locks, atomic replacement and revision), not SQLite. Governance is a read-only projection; Memory SQLite remains module-owned. W0 verifies actual public transport, concurrent stale-response handling and native user-message confirmation.

CLI and stdio MCP share the five calls and their schemas, but they differ when request_id is omitted: the CLI passes no session and resumes or adopts the single open request, while MCP passes an empty session, never resumes at science_begin and refuses an unbound mutating call. Web therefore passes request_id on every continuation and mutating call and never relies on either default. The only call without one is the read-only open-request listing, whose purpose is to obtain Core's own list; it never selects a request. Governance refusals are a plain error string; only Core nests error.code.

### 5.2 Modules

First candidate integrations:

1. Project Governance — tree, context, routes and evidence.
2. Memory — FAST/STANDARD recall, T1/T2/T3 expansion and explicit usage feedback through its MCP tools. DEEP recall and TaskMemoryGraph exist inside the module but are not on its public MCP surface at the reviewed revision; Web does not show them until the owner exposes them.
3. Literature — paper search and fetch with source references. The public CLI returns paper metadata, abstract and download/validation records, not passages.
4. Scientific Review — existing Core advisor bridge; verify the direct provider API seam in the existing module, preserving non-blocking advice semantics.
5. Statistics — scientific statistical design and interpretation, including reuse of the existing deterministic report renderer/verifier.
6. Domain workflows — selected real capabilities such as DAP-seq, Genome-web TF or RNA-seq after current public contracts are verified.

MCP and documented CLI/API interfaces are preferred. A module README and resource instructions are not proof that its runtime tool is installed. The Web host must verify actual availability.

### 5.3 Research Workspace product boundary

BioHarness-Web is the sole Research Workspace product and roadmap. The unimplemented bioharness-module-research-workspace reservation is retired as a separate development target; its useful references and scope are retained by link. Existing Project Governance and other Modules keep their public scientific capabilities. Do not implement a second client, package, projection authority or runtime in Modules. Any proven domain capability gap goes to its existing owner through a separately scoped change.

## 6. Product views and required behavior

### 6.1 Research Tree

Show long-running projects, scopes, nested research branches, original goals, locked mainlines, request references, explicit related edges and goal-version differences.

Use Project Governance's public tree/context/routes/evidence operations. Preserve its rules:

- unscoped requests remain unscoped;
- scope selection does not itself bind a request;
- the active request must be explicit;
- multiple open requests must not be guessed;
- historical requests and reused evidence do not automatically prove current scientific validity;
- related links are not automatic execution prerequisites; ancestor goal-version differences are review prompts, not cross-branch hard dependencies, automatic SUPERSEDED states or gates.

### 6.2 Scientific Workflow

Render the selected Core plan as a dynamic graph. Show objective, requirements, steps, serves, depends_on, why, method, parameters, deliverables, checks, recorded work and unresolved steps.

The graph changes when Core returns a revised plan. Preserve historical plan versions and indicate which previous results remain reusable or require renewed work according to Core records. Do not use a fixed pipeline template.

### 6.3 Evidence and Provenance

Provide source-linked navigation from a result to its input, data version, method, software, parameters, actual tool output, submission and validation.

Only explicit or otherwise source-backed relationships may be shown as established edges. Model-generated relationships remain candidates until supported. Distinguish evidence availability, source verification, execution observation, scientific review and scientific conclusion.

### 6.4 Module and execution views

Use a common module invocation inspector with optional specialized renderers over actual output types. Show actual invocation, source, version, arguments after redaction, result, output/evidence references, errors and timing when observed; missing internal telemetry remains unknown. W0 defines the shared view contract. Do not build a plugin SDK or require module schema changes just for UI.

The UI must not present raw JSON as the only interface. It must not claim a module was used if the runtime has no invocation record.

### 6.5 AI conversation

Conversation is bound to an explicit project/scope/request and, when applicable, selected graph node. A new independent question creates a new Core request. Continuing an existing task uses its explicit request_id and science_now.

The model sees only relevant context for the current step. Large files and datasets are referenced, not indiscriminately copied into model context.

## 7. Native Model API runtime

Build a small backend runtime that calls model-provider APIs directly.

Required functions: provider/model configuration; server-side API credentials; streaming text and structured tool calls; request-scoped context assembly; configured MCP/CLI/API tool dispatch; bounded retries and error reporting; operational event capture; interruption and recovery through Core; user-visible model/tool progress.

Do not introduce a general Agent framework, recursive multi-agent system or a second planner. The runtime follows Core's returned action. The model proposes plans and tool calls; Core accepts/records the plan and determines the next step.

Initial provider adapters use official provider SDKs or documented OpenAI-compatible APIs. W0 chooses the smallest provider set needed for the first real pilot. A hosted model gateway is optional, not a dependency.

### Required loop

1. User message → Core intake.
2. Core initial guidance/resources → model proposes plan.
3. Core plan → current instruction.
4. Model → configured Module/tool calls.
5. Tool outputs and evidence → model step report.
6. Core submission → next action from Core.
7. Repeat or ask the user.
8. Core delivery → final workspace view.

Browser disconnection or stream stop does not cancel scientific computation. Long operations are owned by a backend worker or existing executor; retain recoverable operation identity and reconcile actual tool state separately from Core science_now. Cancellation, retries and duplicate-start prevention follow the W0 lifecycle contract. No blind replay of ambiguous side-effecting calls, and no claimed cancellation without executor confirmation.

## 8. Visual layout

Initial desktop Web layout: left project/research tree; center selected tree/workflow/evidence graph; right selected-node inspector; bottom or collapsible side panel for AI conversation; activity panel for model and Module execution trace; top context for workspace, scope, request, model and connection state.

Support panel collapse, graph zoom/pan, search, filtering, node selection, branch expansion and detail drill-down. Responsive mobile layout is useful later; first acceptance is desktop browser use.

## 9. Technology choices

Decisions and source evidence: [W0 integration and reuse audit](../audits/w0-integration-review.md). Prefer reusable open-source packages and small reviewed components; do not fork complete chat products.

| Area | Selected direction | Verification remaining |
|---|---|---|
| Frontend | React + TypeScript + Vite | W1 package/build and browser QA |
| Graph/layout | React Flow + Dagre | Real project tree and current-plan rendering; ELK only if justified |
| Server-query state | SWR + local selection | Shared snapshot/invalidation and stale-response behavior |
| Conversation | assistant-ui primitives over the server event log (AG-UI frames not adopted, see W2) | Live provider; larger conversations |
| Evidence viewer | Existing safe preview components; Orrery candidate for W4 | Exact evidence and actual artifacts; no second W1 canvas |
| Backend | Python + FastAPI | W1 public CLI adapters; W2 execution lifecycle |
| Model API | Pydantic AI direct API; first OpenAI-compatible transport candidate | First short live tool/stream exchange checked; full runtime context and real-task acceptance open |
| Module tools | Existing MCP/CLI/API public contracts | Actual configured availability; direct Review transport in module |
| Streaming | Shared HTTP snapshots + SSE invalidation; SSE conversation event log with replay | Behaviour behind a reverse proxy |
| Desktop | Remote-service Tauri client | Packaging deferred until W5 |
| Persistence | Existing Core/Module stores; no W1 DB; one W2 local SQLite technical ledger | Operation identity/reconciliation only, never scientific state |

## 10. Development milestones and TODO

### W0 — Four-track contract, runtime and research audit

**Goal:** establish a minimal, source-backed implementation contract and freeze the first pilot scope before W1. The four tracks may be researched in parallel; their outputs are coordinated in one evidence record, not four new roadmaps. Existing contracts and validated research cases take precedence over speculative features.

**Initial repository reading (completed; not runtime acceptance):**

- [x] Inspect the Web V1 tree, current architecture, API and frontend entry points; identify reusable React Flow, Vite and FastAPI assets; remove V1 compatibility as a product constraint.
- [x] Read Core's current five-call contract, Host and FileScienceStore, Project Governance, Research Workspace reservation, Memory, Scientific Review and Statistics entry points; establish ownership boundaries.
- [x] Identify the gaps that require W0 decisions: trusted native user confirmation, optional reviewer direct API adaptation, public-query snapshots, long-operation recovery and remote workspace identity.

#### A — Core and Module contracts

- [x] Pin exact Core/Modules revisions and installed public Host/Module versions in an authorized Linux pilot environment; record supported CLI/MCP/API commands, schemas, resource installation versus declaration and public request-discovery limits.
- [x] Verify request/scope binding, explicit request IDs, unscoped and multi-open-request recovery, current plan/revision, Core intra-plan dependencies and historical evidence; compare actual Governance tree/context/routes/evidence outputs and exact source references. Confirm cross-request relations are contextual, not a project state machine.
- [x] Verify existing file locks, atomic records, scope declaration, concurrent same-request revision conflicts and STATE_CHANGED recovery using supported access. Do not assume SQLite for Core or a transactional Governance view.
- [x] Establish the shared W1/W2 snapshot/refresh contract: source identity/revision or opaque version, public query, observed invalidation, external-writer polling, reconnect/full resync, deduplication and stale/unknown states. No Core event bus required.
- [x] Establish the minimal common Module invocation projection and typed optional renderers from actual outputs, including evidence refs and redacted input/output summaries. Verify Statistics report-binding reuse and actual Memory/Literature/Review tool contracts; mark unavailable capabilities explicitly.

**Output A:** Core-to-Web public contract and ownership matrix, actual representative read samples, concurrency/recovery observations, shared projection/Module inspector contract and unresolved gaps with owners. No private imports, duplicate scientific rules or fabricated dependencies.

#### B — Native Model API and execution lifecycle

- [x] Select the initial provider from actual authorized access using the already selected direct SDK/compatible transport. **2026-11-26 live check:** an owner-selected compatible endpoint accepted a streamed tool request and a subsequent request carrying the actual tool result; arguments, actual terminal reasons and returned text/stream agreement were observed. Credentials and private endpoint details stay outside Git. This is one short transport check, not full context-size/provider coverage or W2 scientific acceptance.
- [x] Verify how the Web host passes original user text and uses Core's trusted native user-message confirmation seam; distinguish actual user input from model/tool text, preserve pending amendment behavior, do not add an Agent-facing confirmation tool.
- [x] Inspect the existing Scientific Review advisor and external runner; specify the smallest direct API adapter in that module (not in Web), or document why review remains unavailable. Retain INTAKE/PLAN/WORK/DELIVERY advice and UNREVIEWED behavior.
- [x] Define the technical execution lifecycle: backend/existing executor independent of HTTP/SSE, minimal durable operation/job identity, status/outputs/logs references, disconnect/reconnect, unknown outcomes, process restart, timeout, explicit cancellation and idempotency/reconciliation before retry. Distinguish Core request recovery from executor job recovery.
- [x] Select remote Linux service topology, explicit service/workspace identity, authenticated client access, server-side credential handling and allowed evidence/output roots. Identify an authorized pilot host and minimally adequate technical metadata storage; no generic scheduler/queue/database by default.

**Output B:** selected provider/Host transport and minimal execution lifecycle contract with concrete failure/recovery cases, reviewer/confirmation seam decisions and remote topology. No implementation is claimed from a design record; actual fault tests occur in W2.

#### C — Reference source and interaction audit

- [x] Review only references relevant to the four scientific views, including the previously reviewed grow-me reference, Galaxy/AiiDA provenance, existing Web/React Flow and one or two useful research-workspace candidates. Inspect actual pinned source, licenses, maintenance/dependencies and user interaction; stop once the design decisions are supported.
- [x] Compare tree/graph layout, branch navigation, state management, streaming UI, evidence inspection and conversation-to-node interaction; select a lightweight frontend stack. Prefer existing implementation where fit is verified; explicitly reject generic linear-chat-only UI and heavyweight low-code workflow engines.
- [x] Classify legacy Web components as retain/adapt/replace/remove and record exact upstream component/source references for any code proposed for reuse.

**Output C:** concise reuse-versus-reject matrix, chosen canvas/layout/state/streaming components and license/source constraints. No external code copied merely to complete the audit.

#### D — Real research walkthrough

- [x] Use the existing real multi-branch DAP-seq scope replay and existing statistical report-binding case as first candidates. Re-open actual authorized source/acceptance records before using them; retain data identity, limitations and privacy. If unavailable, select another actual multi-branch project, not a fabricated demo.
- [x] Walk through a static desktop-browser wireframe using the real project: project scope, concurrent questions, current/historical plans, alternative routes, technical failure versus supported negative result, evidence anchors, result/figure previews and statistical units/denominators/report verification.
- [x] Distinguish computational association, experimental evidence, source/hash verification, observed tool execution and scientific interpretation. Preserve historical evidence and unresolved questions; record information that is actually missing instead of inventing it.
- [x] Verify W1–W4 can express the walkthrough and identify the minimum first pilot, artifact viewers and real interaction gaps.

**Output D:** source-linked walkthrough/wireframe and pilot acceptance scenarios, with private data and raw receipts retained outside the public repository.

**W0 exit — W1 read-side satisfied (2026-11-25):** A–D outputs reviewed in the [single W0 audit record](../audits/w0-integration-review.md). Actual public-contract checks: 32/32; Memory focused tests: 3/3; existing report binding reverified with negative control; real static walkthrough complete. Raw/private evidence stays in authorized Linux CI. Browser rendering and package compatibility are W1 checks; actual authorized provider/model and direct Review adapter are W2 activation/integration gaps. No live model API, production deployment or new scientific validation is claimed. Each decision states source/version, observed vs proposed status, conclusion, owner and remaining gap. W1 begins when the public read/projection path, shared update semantics, first pilot and remote topology are settled, and W2's lifecycle/confirmation/reviewer decisions have a bounded path; any unresolved implementation-critical gap is explicit and addressed by its existing owner. Do not require completed W2 runtime tests, full scientific validation or an unrelated module release before W1. This is a development milestone, not a Core scientific gate. Update this sole TODO in place; do not create another plan.

### W1 — Research Tree and scientific workflow canvas

**Goal:** the Web application displays real Core/Project Governance state.

- [x] Replace the V1 PostgreSQL task projection with current Core Host CLI and Project Governance public read adapters; JSON stdin/structured errors, exact workspace/request identity. Use the W0 snapshot/query-key/SSE invalidation contract with SWR, including stale/shortened/unavailable source views. Reuse this path in W2; no throwaway static polling UI or direct record-file read.
- [x] Add explicit workspace/project/scope/request selection.
- [x] Render the Project Governance research tree; scope detail comes from tree and routes.
- [x] Use the Governance context view in the UI; the integrated browser check confirms scope and step context comes from the existing public API.
- [x] Preserve unscoped requests and explicit request identity. Open requests come from Core's own answers to science_now without a request_id (at most 20 listed); a delivered unscoped request can only be opened by its exact ID because no public call lists it.
- [x] Render the selected Core plan as a dynamic workflow graph using React Flow and Dagre; package versions are locked and the production build passes. Do not adopt an external workflow engine.
- [x] Verify graph rendering and interaction in a real browser: `tests/browser/run.sh` drives the built service in headless Chromium against a synthetic workspace (both canvases, edges, selection, inspector, evidence preview, no server path in the page, and following a Core change made by another host without reload). Component tests run the non-canvas fallback only.
- [x] Show requirements, step dependencies, current instruction, progress and unresolved work.
- [x] Add node inspector for objective, method, parameters, check, result and source references. Per-step submissions and evidence come from Governance routes, so they exist only for scoped requests; for an unscoped request the inspector says so.
- [x] Show historical task references and goal-version differences without inventing cross-branch hard dependencies or automatic invalidation. Plan revisions and within-plan reuse invalidation have no public read path (science_now returns the current plan and a count of retained historical submissions only); the UI states this instead of reconstructing them. Owner of the gap: Core.
- [x] Implement initial snapshot/refetch, stale marking and reconnect/full resync through the common W1/W2 channel.
- [x] Add loading, empty, stale, disconnected and unreadable-record states.
- [x] Require the service access token on every data route, bind loopback by default, and replace configured server directories by labels in the owners' answers and in preview metadata. Recorded file evidence outside configured directories is shown by file name only. Free text written by a model or tool, and the content of a previewed evidence file, are shown as recorded and are not scanned for paths.
- [x] Preview file evidence by its exact recorded anchor inside configured roots. Text evidence content is not returned by any public call and is shown as unavailable.
- [x] Independent five-lens review of the W1 code (security, correctness, frontend, rule compliance, test quality) with each serious finding re-verified; the confirmed defects were fixed and covered by tests (among them: an oversized tool answer could wedge a read, the preview could be raced out of its root or read another workspace's Core state, a partial Core state directory was completed by a read, a single scoped open request was shown as unscoped, the project could not be changed after a choice, older step submissions were silently missing).
- [ ] Known limits left as they are for a single trusted operator on a private network: one shared token without expiry or rate limiting; the session cookie is marked Secure only when the service sees HTTPS; each preview re-hashes the file (up to 64 MiB); the inspector reads at most the 100 most recent submissions of a scope.
- [ ] Run the private real-project acceptance below in the authorized environment.

**Tested so far:** backend unit tests, contract tests that build a synthetic workspace through the installed public Core 0.2.0 and Governance 0.1.2 CLIs and read it back through the Web API (including that reads leave the workspace unchanged), frontend component tests, and the headless-Chromium check of the built service against a synthetic workspace. Not yet tested: a real project, other browsers, graphs larger than a few nodes.

**Acceptance:** a real project appears with the same scope ancestry and explicit related links as Project Governance; unscoped requests are not silently assigned; multiple open requests require explicit selection; workflow graph matches science_now and the selected Core plan; node details resolve to the correct Core request/step and source references; no direct SQL or private Core imports are used.

### W2 — Direct model API and first-party runtime

**Goal:** conduct a real Core-governed research task without an external Agent.

- [x] Complete the narrow W0 access/transport activation check with an owner-selected authorized direct API endpoint/model. **2026-11-26:** the installed adapter made a real streamed tool call, returned the actual tool result in its next request and received a normal streamed answer; arguments, terminal reasons and stream/text agreement passed. The short round trip worked without replaying reasoning parts, which the adapter drops. A subsequent synthetic EXPLAIN used the real model, installed public Core and actual Governance MCP tools: one science_begin, one accepted plan, two accepted submissions and one FINAL delivery, across three runs with two explicit resumptions after provider response failures. Original question/request identity and recorded progress survived; Core disclosed unreviewed work and execution_verified=false/scientific_truth_verified=false. This does not establish uninterrupted reliability, large/full context capacity, other provider profiles or EXPLAIN/EVALUATE/ANALYZE real-project acceptance. Actual terminal reasons are required: SDK-inferred completion after quiet EOF is not accepted; incomplete/filtered/length-limited responses do not execute their calls.
- [x] Implement streaming chat and structured tool-call handling. Conversation UI uses assistant-ui primitives over the server's recorded event log (external-store runtime; no assistant-ui Agent runtime, no client-owned transcript). AG-UI frames are not adopted: the event log with sequence numbers already gives resume and replay, and no consumer needs a second wire format. Revisit only for a concrete consumer.
- [x] Extend/reuse the W1 Core Host adapter for mutation through the public CLI (one process per call); the conversation refreshes the same W1 snapshots after each Core call.
- [x] Implement request-scoped context assembly: Core's research rules, Core's latest answer for the request (question, mainline, plan, instruction, resources as Core returned them), the conversation's user and assistant texts within a bound, and this run's tool traffic within a bound. The scope is what the user chose at intake.
- [x] Implement configured stdio MCP tool adapters (each call starts the configured server command). No CLI/API adapter beyond MCP yet, and no shell, file or network tool.
- [x] Implement the Core intake → plan → step → submit → next action → delivery loop. The host calls science_begin with the user's text; the model is offered Core's own definitions of science_now/plan/submit/deliver and is shown Core's answers; Core's stop hook, not Web, says whether a turn may end.
- [x] Preserve explicit request_id and recover after browser/server restart using science_now. One conversation is one request: it is set once from Core's answer to a new request or by explicit attach and never re-pointed; a follow-up after delivery is a new conversation. A request that Core returns as already existing is not adopted without the user's explicit attach, and a refused science_begin leaves the conversation free to send the question again.
- [x] Mainline amendment confirmation. Decision (2026-11-26, delegated to this work by the owner of Core and Web): Web drives Core's existing generic hook CLI as itself. It sends every authenticated user message of a conversation, verbatim, to `hook prompt` with the conversation's server-generated session id and without `--agent-host`; it binds that session to the request through `hook post-tool` with the real Core call and answer; Core alone matches the confirmation and applies it; Web re-reads science_now. Web never parses a confirmation, the hook is not a model tool, the session id never leaves the server, and no Core change was made. Tested against the installed Core: a model writing the phrase, a user message merely containing it and another conversation's exact message leave the amendment pending; the bound conversation's exact message applies it. Trust rests on the backend being the only caller of the hook for its sessions. For Core's owner, non-blocking: name first-party hosts as users of the generic hook in Core's documentation, and set the hook's one-shot key only after an amendment was actually resolved (today a confirmation sent before the amendment exists makes the same text ineffective later).
- [ ] Where required, adapt the existing Scientific Review module to direct API calls under a separately scoped module change; verify optional advisor and UNREVIEWED semantics. No external Agent required for native operation, no new scientific review gate.
- [x] Record actual model/tool events. Configured server directories are relabelled and this service's own token and model key are removed wherever they are echoed; there is no general secret scanner for what a tool or a user writes. Provider reasoning parts are neither shown nor stored.
- [x] Implement the W0 technical lifecycle: runs are backend tasks independent of HTTP/SSE; one local SQLite ledger holds conversation-to-request association, runs, operations and the event log (each stored value bounded; no retention rule yet); cancellation is recorded as requested and confirmed by the run's final event; an unanswered mutating call is recorded UNKNOWN and followed by science_now, never repeated. No scientific state, no scheduler. Long external jobs (HPC) are not covered: tool calls run inside the run and are bounded by a timeout.
- [x] Verified on synthetic workspaces: event replay and resume after the last seen event, explicit stream.reset and full replay when a reader is ahead of a replaced log, restart (in-flight run INTERRUPTED, in-flight operation UNKNOWN, resume from science_now), one running run per conversation and per request, an unanswered science_begin (not repeated; reconciled by the user), a Core refusal followed by a re-read, provider failure, an unavailable tool server, Core's wait-for-user, and a model that stops while Core still expects work.
- [ ] Remaining failure acceptance: two hosts actually changing one request concurrently (STATE_CHANGED) through the runtime, partial Module output and a real long-running tool. **Verified in external installed-package tests:** an actual Core-accepted science_submit whose reply is deliberately truncated is recorded UNKNOWN, followed by science_now, never resubmitted, and has exactly one recorded submission through public Governance; later calls in that model batch are skipped. Injected STATE_CHANGED refreshes before another model decision; a failed/refused refresh interrupts without stale-state continuation. This is transport fault injection, not genuine two-host concurrency acceptance. Provider truncation/quiet EOF is also tested through HTTP/SSE and does not mutate Core.
- [x] Independent four-lens review of the W2 code with each serious finding re-verified; the confirmed defects were fixed and covered by tests (among them: text shown while being written bypassed credential removal; evidence under Core's second key and relative, linked or home-relative tool paths bypassed the path rule; a refused science_begin was reported as unknown and blocked the conversation; an existing request returned by Core was adopted silently; an attach and a run could bind one conversation to two requests; the panel lost a running conversation, could send a question without the chosen scope and missed events that arrived together).
- [ ] Known limits: a host notice reaches the model as a marked user-role message, and a user can type the same mark; the mutating-call bound (default 3900 s) must stay above the workspace's advisor timeout; one model request can reach about 350 000 characters (rules, Core's answer, bounded history and run traffic), so the configured model needs a context of that order; the ledger grows without pruning.

**Tested so far:** backend unit tests; contract tests that run the whole loop against the installed Core 0.2.0 CLI with a scripted OpenAI-compatible endpoint in place of a model; a mutation check (44 deliberate defects in the runtime, Core host adapter, ledger, event stream and provider adapter, each caught by a test once the review's gaps were closed); frontend component tests; and the headless-Chromium check, in which a question typed in the browser goes through intake, plan, submission and delivery. Live-provider checks remain synthetic EXPLAIN only: the earlier cycle required two explicit resumptions; the later integrated browser cycle passed 10/10 in one run, made actual Governance calls and preserved the original request across browser reload and offline server restart. It accepted exactly one begin, plan, submission and delivery without a provider failure in that run. Joint installed-package regression: 234 backend, 54 frontend, 36 standard-browser, 6 W3 and 3 read-only browser checks passed. Negative controls fail before the pagination/SSE-reset fixes. No real-project result correctness, sustained provider reliability or scientific benefit is established. The acceptance below still needs real tasks and the remaining request types.

**Acceptance:** EXPLAIN, EVALUATE and ANALYZE tasks complete using direct provider APIs; no external Agent process is required; Core determines the persisted plan and next action; the same request resumes after restart with explicit request_id; tool results and file evidence are submitted through Core; UI distinguishes model/tool observation from scientific validation; disconnect does not cancel a long operation; actual job recovery, unknown outcomes, cancellation and duplicate prevention are tested; genuine user confirmation is accepted only through its trusted path.

### W3 — Module integration and inspectors

**Goal:** show the actual work of Core and each configured scientific Module.

- [x] Reuse the W0 common invocation projection and fallback inspector; attach optional domain renderers only for actual supported outputs. Paginated existing-ledger operations, bounded structured results and common invocation/Module inspectors are integrated without a new scientific store. Synthetic browser checks distinguish is_error, omitted content and Memory use not recorded. Real professional-Module outputs and scientific semantics remain unaccepted.
- [x] Project Governance inspector: tree, context, routes and evidence via public interfaces, checked with synthetic fixtures; real-project acceptance remains open.
- [ ] Memory inspector: T1/T2/T3, retrieval mode (FAST/STANDARD), condition gaps, conflicts and explicit use feedback as returned by the public MCP tools. TaskMemoryGraph, DEEP recall and relation paths are shown only once the Memory module exposes them publicly.
- [ ] Literature inspector: query, sources, papers, abstracts, identifiers and fetch/validation records. Passage-level views wait for a public interface that returns passages.
- [ ] Scientific Review inspector: intake/plan/work/delivery advice, concerns and unreviewed status.
- [ ] Statistics inspector: unit, grain, grouping dimensions, combinations, numerator/denominator, background, methods, effect sizes and correction; invoke/display the existing deterministic report-binding renderer/verifier with evidence references, never duplicate its checks.
- [ ] Analysis/workflow inspector: inputs, versions, parameters, tool calls, outputs, errors and recovery.
- [x] Add real invocation timeline with conversation/request and operation/server/tool identities, timestamps, observed states, recorded inputs/outputs/errors and provider metadata. Evidence fields remain as the owner returned them, not inferred edges; missing step_id/module version stays unknown. Joint regression checks cover live additions shifting pagination and stale older-page replies.
- [x] Add explicit unavailable-module state: recorded per-run MCP discovery (LISTED/UNAVAILABLE, listed versus offered tools), NOT_OBSERVED without a record, labelled by run/time. The integrated UI preserves discovery versus invocation/consumption and does not claim installation or current reachability. Linux browser checks include an actual fixture MCP server, unavailable server and runtime-disabled mode.

**Acceptance:** each inspector uses actual module output or observed runtime events; no module algorithm is duplicated; Memory candidate/retrieved/consumed/outcome are distinct; Literature claims link to the source records the module returns (passages only if the module provides them); Statistics exposes denominator/background and analysis unit when supplied.

### W4 — Evidence, results and research comparison

**Goal:** make scientific conclusions inspectable and support long-running iterative research.

- [ ] Add evidence/provenance graph with source-backed typed edges.
- [ ] Add artifact/file preview using allowlisted evidence references.
- [ ] Add tables, plots and figure previews for supported result types.
- [ ] Add method/parameter/input-version comparison across prior routes.
- [ ] Show contradictory findings and negative results without erasing historical attempts.
- [ ] Show which downstream steps were affected by a plan/input/method revision, based on recorded dependencies.
- [ ] Add research-wide search over scopes, requests, methods, sources and outputs.
- [ ] Conduct the integrated real-project pilot and authorized private deployment smoke checks. **Deployment portion verified (2026-11-26):** installed Web release connected to pinned formal Core/Governance CLIs, explicit existing workspace choices, server-only model route/credentials and loopback-only access; API read smoke 19/19 and production browser/restart checks 11/11 passed without rewriting Core records or creating synthetic production questions. The installed release interpreter passed all 234 backend/contract tests and the rebuilt synthetic browser regression 36/36 in an external isolated workspace. A supported Node 22.23.2 builder passed all 54 frontend tests and production build. The isolated mutable synthetic checks remain separate. Real-project, wider artifact/output isolation and long-operation scientific acceptance remain open.
- [ ] Support the owning Memory/Eval team's independent Memory ON/OFF comparison by exporting actual invocation/use evidence if needed; do not make Web UI acceptance depend on an unproven scientific benefit or copy Gold into Web.

**Acceptance:** a displayed result traces to its input, method, parameters, invocation and evidence; historical and contradictory results remain inspectable; task completion or invocation count is never treated as scientific validity; process-level and outcome evaluation are separate.

### W5 — Desktop packaging

**Goal:** deliver a desktop shell without creating a second application.

- [ ] Evaluate Tauri packaging after Web workflows and deployment are stable.
- [ ] Reuse the same React application and backend contracts.
- [ ] Implement the W0 remote-service-first topology; verify explicit service/workspace IDs, remote evidence resolution and authenticated API/SSE across devices. Assess a local sidecar only if independently justified.
- [ ] Add native file selection and workspace configuration only where required.
- [ ] Verify updates, credential storage, local workspace access and recovery.
- [ ] Keep desktop-specific code thin and isolated.

**Acceptance:** Web and Desktop use the same Core/Module contracts and request identities; no duplicate scientific state or separate desktop workflow engine exists; Desktop can recover the same request through Core.

## 11. Cross-cutting acceptance and evaluation

The first full end-to-end pilot covers three request types:

1. **EXPLAIN:** a literature/method question with source-backed references.
2. **EVALUATE:** a research idea with prior work, data/method assessment and alternative routes.
3. **ANALYZE:** a bounded real analysis using a configured scientific Module, with actual parameters, outputs and evidence.

Additional behavior tests:

- [ ] Original user question is retained verbatim.
- [ ] Core objective and requirements remain the mainline.
- [ ] A model-proposed mainline amendment cannot be self-confirmed.
- [ ] Missing or failed scientific review is disclosed and work continues.
- [ ] Multiple open requests are never guessed.
- [ ] Project tree and current request binding are shown accurately.
- [ ] A Memory candidate is not reported as used without a real usage record.
- [ ] A failed technical run is distinguished from a scientifically negative result.
- [ ] Tool output containing hostile instructions cannot change system rules.
- [ ] API keys, tokens, passwords, private paths and SSH credentials do not reach the browser or trace.
- [ ] Large files are referenced or previewed within limits rather than copied wholesale into model context.
- [ ] Server restart and interrupted tool calls leave the Core request recoverable.
- [ ] Stopping Web does not itself rewrite scientific state; in-flight external/local operations are reconciled or explicitly reported as unknown.
- [ ] Browser disconnect and stream stop do not imply cancellation. Reconnect and ambiguous writes do not duplicate scientific work.
- [ ] Common snapshot/refresh behavior matches external Core mutations and reports stale revisions; no cross-branch gates are introduced.
- [ ] The public Web repository contains no private research inputs, results, credentials or infrastructure/receipt details.
- [ ] The same scientific task can be evaluated independently through BioHarness-Eval.

BiomniBench's process-level dimensions are a useful evaluation reference: data handling, method selection, statistical rigor, biological interpretation, scientific reasoning and source reliability. It is a preprint, not a validated BioHarness Gold standard. Final evaluation uses BioHarness-Eval's own task and Gold definitions.

## 12. Reference projects and borrowing rules

| Reference | Borrow | Do not assume |
|---|---|---|
| Galaxy | analysis history, workflow authoring, input/output provenance | BioHarness should become a Galaxy clone |
| AiiDA / AiiDA-WorkGraph | provenance graphs, process history, remote workflow concepts | current WorkGraph GUI is production-ready |
| JupyterLab | multi-panel scientific work surface, code/result inspection | a full JupyterLab embed is needed in V1 |
| React Flow | interactive graph canvas, custom nodes and inspector interaction | current V1 graph code must be preserved |
| grow-me | tree interaction patterns; Modules reviewed a MIT commit | code can be copied without attribution/license |
| Research Workflow Studio | research/code/output comparison interaction | project maturity or license without audit |
| Research Deck | outline, DAG, experiment and paper relationships | production suitability without audit |
| Hypothesis Atlas | evidence mapping, hypotheses, counterevidence and research graph | license suitability or scientific validity of automated claims |
| Vercel AI SDK | streaming UI and provider integration patterns | Vercel hosting or AI Gateway is required |
| Tauri | later Web-to-Desktop packaging | Desktop should be built before Web |

Code reuse requires source-level review of license, maintenance, dependencies, data handling and whether it duplicates Core or Modules.

## 13. Deployment direction

Remote-service-first is fixed and an authorized private Linux deployment has been activated through formally installed public Core/Governance CLIs. Private host/workspace/credential identities stay outside this repository. Browser and later Desktop connect to the same backend via authenticated API/SSE. Service/workspace/request identity and server-side evidence resolution are explicit. Keep API keys and tools on the backend; avoid broad mounts and public exposure before access isolation and TLS review.

See [deployment and operations](../deployment.md). The original planning task made no production change; the later owner-authorized Web deployment is now recorded there. Core/Modules code and existing scientific records were not migrated or rewritten.

## 14. Open decisions

The earlier W0 choices for public contracts, Host transport, native confirmation, snapshot/event/projection semantics, initial provider, technical ledger, UI stack and private host/workspace deployment have been resolved in the audit and implementation sections. Do not keep treating those historical questions as new work or create another roadmap. Still open: real scientific pilot/Modules acceptance, optional Review direct-API activation, larger artifacts and long-running executor recovery.

Desktop topology and sole Web product ownership are settled. No new Core or Module capability is presumed without source-backed need.

Remaining public-interface gaps belong to their existing owners: plan history/reuse invalidation, text-evidence content and delivered unscoped request enumeration (Core); public DEEP recall/TaskMemoryGraph (Memory); passage-level results (Literature); optional direct-API reviewer transport (Scientific Review). Web shows unavailable data honestly. The earlier non-Agent amendment gap is resolved by Web's agreed use of Core's existing generic hook, not a new tool or endpoint; documenting that first-party-host trust remains a Core documentation follow-up.

## 15. Out of scope until justified

New Core endpoints or Core schema changes without a separately reviewed demonstrated gap; a new scientific task database; a second project/scope tree or cross-branch SUPERSEDED gate; a second Research Workspace product; a second Memory or graph database; a generic Agent framework or recursive multi-agent scheduler; a new HPC scheduler; full low-code workflow editing; public multi-tenant SaaS; collaborative editing; full JupyterLab/Galaxy replacement; Desktop-first implementation.

## 16. Source links

- [BioHarness Core](https://github.com/mumu-140/BioHarness)
- [BioHarness-Modules](https://github.com/mumu-140/BioHarness-Modules)
- [Project Governance README](https://github.com/mumu-140/BioHarness-Modules/blob/main/packages/bioharness-module-project-governance/README.md)
- [Memory README](https://github.com/mumu-140/BioHarness-Modules/blob/main/packages/bioharness-module-memory/README.md)
- [Research Workspace module README](https://github.com/mumu-140/BioHarness-Modules/blob/main/packages/bioharness-module-research-workspace/README.md)
- [BioHarness-Eval](https://github.com/mumu-140/BioHarness-Eval)
- [Galaxy](https://galaxyproject.org/)
- [AiiDA-WorkGraph](https://github.com/aiidateam/aiida-workgraph)
- [JupyterLab](https://github.com/jupyterlab/jupyterlab)
- [React Flow](https://reactflow.dev/)
- [Tauri](https://tauri.app/)
- [Robin, Nature 2026](https://doi.org/10.1038/s41586-026-10652-y)
- [BiomniBench preprint](https://doi.org/10.64898/2026.05.12.724604)

## 17. Change control

This is the single active BioHarness-Web V2 roadmap. Update this file in place as decisions are verified. Keep stable product rules in AGENTS.md and the architecture contract in docs/architecture.md. Do not add parallel TODO files, repeated plans or run-log documents.