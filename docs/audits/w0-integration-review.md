# W0 — integration and reuse audit

Date: 2026-11-25. Disposition: **W1 read-side design exit satisfied; native provider activation remains open.** This is the evidence/decision record referenced by the single V2 plan, not another roadmap. No V2 production runtime is implemented by this audit.

## Scope and identity

Source baseline: Web 2c63958c39880df80a25c5a9ce7f594628c27460; Core 69f2fbfe8d8d30129efd6d3721bf2a4215aee125 (0.2.0); Modules 43706d98e4c96669ebc64cebcfecb77565a11025. Exact source archives were installed offline into an isolated authorized Linux CI environment. Core, Governance, Memory, Literature and Scientific Review were installed without changing the production environment; Statistics report binding was used as its standalone helper. 155 installed Python files matched archived source bytes. MCP SDK 2.3.0; Python 3.12.14.

Raw outputs, research records, private static walkthrough, precise workspace addresses and verification receipts stay in the authorized private CI workspace. No private scientific data, credentials, infrastructure addresses or source excerpts from private repositories are included here.

## A. Core-to-Web public contract

**Decision: CLI first for W1, stdio MCP for configured tool integrations; both use the same public semantics.** CLI is the smallest read adapter and has no long-lived subprocess requirement. Never construct shell command strings from model/browser text; use fixed argv and JSON on stdin. Resolve workspace on the server.

| Public call / owner | Contract and UI use |
|---|---|
| Core Host: science_begin | Original user text verbatim; optional scope id/create/parent_id/related_request_ids. Store the returned explicit request_id. Scope is bound at intake, not by selecting a UI node. |
| science_now | Exact request_id, current question, plan, mainline, phase/action, progress when exposed, instruction, step, next call, guidance and delivery. On DELIVERED/DONE the terminal response need not carry another call. |
| science_plan | Submit candidate plan and optional amendment; Core validates and returns the next action. Never compute step eligibility or scientific requirement coverage in Web. |
| science_submit | Record actual result, method/parameters/deviations and evidence references with explicit request/step identity. DONE/PARTIAL need evidence; an execution receipt is not independent scientific verification. |
| science_deliver | FINAL/PARTIAL/QUESTION_FOR_USER/ABANDONED; follow Core returned instruction and disclosure. |
| Governance 0.1.2: tree | Projects/scopes, parents, explicit request references and revisions, related links, shared evidence hashes, goal-version differences, view_sha256; optional exact unscoped request binding. |
| Governance: context | Exact scope_id and optional request_id; verifies membership and returns context, not attachment. |
| Governance: routes | scope_id, optional declared conditions, offset/limit, descendants/related flags. Historical attempts, submissions, declared method/parameters/conditions, gaps, evidence, delivery and technical status. |
| Governance: evidence | Exact request_id, 1-based submission_index, evidence_id, sha256; return recorded version and snapshot integrity. No automatic applicability or independence conclusion. |

Invocation examples (workspace supplied by trusted deployment configuration):

- Core CLI: bioharness-host call --workspace WORKSPACE science_now - ; stdin JSON with request_id. The wrapper must inspect the JSON ok/error fields, not only process exit. Core errors are nested under error.code (including REQUEST_AMBIGUOUS and STATE_CHANGED); Governance errors are a plain string.
- Core MCP: bioharness-host mcp --workspace WORKSPACE. Discover the exact five tools.
- Governance CLI: bioharness-governance --workspace WORKSPACE tree --project-id PROJECT; context --scope-id SCOPE --request-id REQUEST; routes --scope-id SCOPE --include-descendants; evidence with the four exact anchor arguments.
- Governance MCP: bioharness-governance --workspace WORKSPACE mcp. Discover its four read-only tools.

Source: Core Host science.py, cli.py, hooks.py, settings.py and scientific kernel/store/progress; Governance cli.py and view.py at the pinned revisions.

Observed: 32/32 bounded public-contract checks passed, including explicit and multiple-open request selection, original question recovery across CLI processes, scope binding and wrong-scope negative case, intra-plan dependency progression, evidence tuple and wrong-hash negative case, native user confirmation, same-request concurrent review conflict, CLI/MCP parity for calls with an explicit request_id, and real historical replay reads. The first test harness misread nested error.code; corrected the harness and repeated in fresh fixtures, without changing Core. A synchronized test-only advisor made two genuine concurrent CLI plan calls overlap; exactly one accepted and the other returned STATE_CHANGED. This tests the conflict path, not all filesystem failure modes.

Limits and decisions:

- Core FileScienceStore is file-backed, per-request locked and atomically replaced with internal revisions; separate scope declaration lock. The concurrency observation supports the existing design, not a new SQLite Core store. Do not assume a client-visible CAS parameter or global transaction.
- Governance is a read-only, on-demand projection; related requests are contextual and goal-version differences prompt review, never an inferred cross-branch gate. A tree does not enumerate all unscoped requests. The public ambiguity response lists a bounded set of open requests; allow explicit IDs and retain host-owned conversation-to-request associations. No discovery API is added.
- science_now is the current/recovery view, not a complete historical plan/evidence API. It can explicitly replace oversized content with pointers, and a delivered request can omit current step progress. Do not show omitted fields as empty facts or open arbitrary state files as a substitute for a public interface. Use Governance's actual history/evidence reads; expose unavailable history honestly. No promise of full unscoped history.
- Scope ancestry and related links are distinct from within-plan depends_on. Preserve actual historical failures, partial delivery and shared evidence references; only the source determines status.

### Shared W1/W2 read projection and refresh

Use one read adapter and query-key shape for both phases: service/workspace identity + view (tree/context/routes/evidence/now) + explicit selector(s). A returned snapshot carries source kind, source version when exposed, opaque content version for the returned projection, observed time, completeness/shortening and warnings. Governance tree view_sha256 and record revision may be used where supplied; for a bounded science_now response use a stable content digest, not a manufactured monotone Core revision. Evidence keys retain the exact source anchor. Do not compare content hashes as ordered versions.

W1 HTTP queries provide the initial snapshot. Existing Web SSE invalidation pattern is adapted to the new source: a per-service stream epoch and monotonic technical event sequence, explicit view/workspace/selector, optional observed projection version. Poll supported public queries at a measured interval; coalesce invalidations. Refetch after successful or ambiguous mutation in W2 and after reconnect/gaps/epoch changes. Ignore stale/out-of-order responses using the query generation; duplicate invalidations are harmless. Reconnect always supports a full current snapshot, with no requirement for durable W1 event replay. Display last successful snapshot with stale/unknown state on read failure. SSE is notification, never authoritative science data.

W2 adds actual model/tool events and AG-UI conversation frames; it uses the identical scientific query/invalidation channel. Technical streaming cannot advance scientific state. React local state owns selection; use a lightweight SWR query cache for remote snapshots (pattern inspected in the Vercel reference), not a second task state store.

### Common module invocation view

The technical envelope contains service/workspace, operation ID, request ID/step/plan reference when known, configured tool/module identity/version when available, observed event/status/time/error, bounded redacted inputs/outputs, artifact/evidence refs. Unknown fields remain absent/unknown. A fallback inspector shows actual returned content; optional renderers are selected by supported output shape/version. This is not a module registration schema or mandatory instrumentation contract. Domain-specific states remain module-owned.

| Module | Observed contract / integration status |
|---|---|
| Governance | Four actual public queries tested on fixtures and a real project replay. |
| Memory 0.0.4 (distribution bioharness-memory-legacy) | MCP tool discovery, recall, expansion, explicit usage/candidate feedback: 3 focused existing tests passed in the isolated environment. Configure operator-owned source root, manifest, DB and inbox; no browser-supplied store paths. FAST/STANDARD/DEEP and T1/T2/T3 are existing module semantics. Candidate/consumed/outcome remain distinct. Production store and semantic embedding not tested. |
| Literature 0.1.0 | bioharness-literature search/fetch CLI and help verified. It delegates to KnowledgeSeek paperseek and ScanSci scansci-pdf; those commands were not in the inspected source-host PATH. Configure actual approved executable paths before claiming it is callable; no live literature search in this audit. |
| Scientific Review 0.6.7 | Optional build_advisor contract, existing CodeArts reviewer revision 9 inspected. Native API runner not implemented; see B. |
| Statistics | Standalone tools/report_binding.py render/verify CLI, no Core-internal imports. Source hash matched existing real-data verifier. The actual existing report reverified 16 statements and 2 tables; tampered report rejected. Do not install the legacy Statistics package dependency on Core 0.1 into Core 0.2. Numerical consistency is distinct from scientific interpretation. |
| Other workflows | Only expose actually installed/configured public adapters. No blanket shell, arbitrary file access or new scheduler. |

## B. Native provider and execution lifecycle

### Provider and trusted user seam

Source selection: Pydantic AI low-level direct.model_request / model_request_stream for provider normalization and structured tool requests; first transport candidate is an owner-configured OpenAI-compatible direct endpoint. Use official provider SDK directly if a concrete compatibility gap requires it. Do not start the Pydantic Agent machinery, a general agent runtime, an external coding Agent or its own scientific planner. Exact provider/model and credentials require an authorized actual configuration. No direct API environment credentials were visible in the inspected source/CI environments; no live provider request or provider compatibility acceptance has been made. This activation check remains open for W2 and does not block the W1 public read path.

The existing generic native hook seam works without a sixth tool. After a successful explicit Core call, backend-only hook post-tool receives a server-controlled native session ID, actual Core response and its exact tool input. On a real authenticated user message, backend-only hook prompt receives that session ID and original user text (no impersonated external Agent host flag). In the isolated CLI test, a pending A1 amendment stayed pending after model-call imitation and an unbound session's confirmation; the bound user prompt applied it and science_now returned REVISE_PLAN. These are transport fixture messages, not real project amendments. Never expose hooks to model-controlled tool dispatch, accept a browser-supplied session-to-request mapping, fabricate a tool response or auto-confirm. Re-read science_now after the hook. No changes to Core.

Review adapter: existing CoreGoalAdvisor maps all four stages to CodeArtsIntakeReviewer and its structured-output validation/one bounded correction. Any direct-model transport change belongs in Scientific Review: preserve its stage prompts, validated reports, evidence limits, reported-parameter audit, trace distinction and optional UNREVIEWED failure behavior; replace only the reviewer invocation/transport as justified. Do not emulate the reviewer by a new Web scientific decision engine. Native Web can operate unreviewed until this owner adapter exists.

### Execution lifecycle decision

The client connection is not the lifetime of a scientific operation. Reuse assistant-ui/assistant-stream's disconnect/resume patterns, but the upstream DurableAGUI example is an in-process Pydantic Agent run, not a crash-resumable HPC executor. The source accepts client-provided history, so it is not adopted wholesale. Server owns original user messages and verified Core results; client transcript is untrusted input.

W1 is read-only and needs no Web persistence database. For W2, choose a single local SQLite **technical** ledger in the remote service to persist conversation association and operation identity/outcome across restart (atomic uniqueness/transaction needed for ambiguous starts). Prefer reusable upstream thread-store/resumable-stream primitives where compatible; never maintain a duplicate scientific task, plan, project tree or Memory. No external DB/Redis/queue/scheduler is required for the single-service pilot; add only after an actual gap. Existing configured executors retain their job and output authority. A technical record associates service/workspace, request ID when known, step/plan reference when supplied, operation ID, executor handle when supported, observed state/timestamps and output refs. Initial intake operation ID exists before request_id is returned.

| Case | Required host behavior |
|---|---|
| Browser closes / SSE disconnect | Detach stream; backend or configured executor keeps its actual operation. Reconnect queries Core and operation state, resumes supported stream or refetches. |
| API timeout before outcome is known | Keep operation identity and unknown outcome; do not blindly retry side-effecting calls. |
| Ambiguous science_begin | Bare CLI/MCP cannot guarantee native-session idempotency with multiple open requests; recover exact ID via actual result or supported inspection, otherwise report uncertainty and require explicit reconciliation. |
| Same-request concurrent update | Serialize local mutating dispatch for one request where practical; handle Core STATE_CHANGED by refetch/reconciliation, not stale automatic replay. Other hosts remain independent. |
| Backend restarts | Restore technical records, call science_now with exact request ID, query the actual executor handle; no promise to resume an in-process model run. Unknown job outcome stays unknown. |
| Cancel | Explicit user intent + exact operation/run identity. Report requested separately from executor-confirmed cancellation. Stop stream is not remote job cancellation. |
| Executor produces outputs | Preserve actual references and observed metadata; submit via science_submit only after reconciliation. No status inferred from model text, a timestamp or successful exit alone. |
| User decision / delivery | Use only the Core returned wait/next-action/disclosure semantics. No automatic scientific transitions. |

Use remote Linux service, authenticated browser and future thin Desktop client, explicit service/workspace/request identity, allowlisted server-side evidence/output roots and provider configuration. The authorized Linux CI workspace is the first isolated W1 pilot, not a production deployment. Actual production host selection/configuration and provider secrets stay outside public source. Fault injection and actual live model/executor behavior are W2 tests, not claimed here.

## C. Open-source reuse and legacy disposition

Use packages and small MIT/Apache components with attribution and exact version locks; no whole-app fork. The source mirror contains the following pinned upstream snapshots, inspected without running upstream services. License labels reflect inspected root license; verify the license/NOTICE of reused files and transitive dependencies before redistribution.

| Reference, source commit | Adopt / adapt | Explicitly avoid |
|---|---|---|
| assistant-ui 4797ce5da22845dfa0c0d2cbd115f8e6fe42d2a2, MIT | Primary chat UI: @assistant-ui/react (source version 0.15.38), react-ag-ui (0.1.13), tool views and durable example's lib/durable-agent.ts, MyRuntimeProvider.tsx. React 18/19 peer compatibility in source. | Whole Next.js example, client-authoritative transcript, Assistant Cloud requirement, DurableAGUI as scientific runtime. |
| Same repository, python/assistant-stream/src/assistant_stream/resumable/context.py and pydantic_ai/durable.py | Standalone resumable stream run/resume/status primitives and AG-UI replay/detach behavior, candidate thread-store reuse. | Claiming worker-crash recovery or remote job recovery from stream replay; default Redis/Postgres deployment. |
| Pydantic AI a30f0264d760c5904d688f01115c63fe757c2ca9, MIT | docs/direct.md and SDK direct model request/streaming/ToolDefinition contract. | Agent.run orchestration, Pydantic Graph as a second scientific planner, durable-agent framework dependency. |
| xyflow 9635a064f9d44cc10c460e3a0c9ca20ad0852450, Dagre 29db69b74d65c494aafb4364a1cef65704f67552, MIT | React Flow graph canvas, controlled nodes/edges, built-in pan/zoom/minimap, Dagre directed layout. | Fixed old stage graph or full low-code editor. |
| grow-me 52176cfce7f8038883129076c5d0a13a634e2bd9, MIT | assets/tree.mjs tree layout/branch geometry and navigation patterns; reuse only if beneficial over ordinary scope tree + Dagre. | Interview state machine, prompts, file schema or second project tree. |
| Orrery 7e04286ef61f6093a0641ff5509f297b391eecde, MIT | Package @axiom-foundation/orrery 0.6.2; GraphExplorer public host/render/inspector contexts, source references, search/focus and graph diff. Candidate W4 evidence viewer; test package and align React Flow versions before adoption. | External graph authority, receipt semantics as scientific verdict, unnecessary second canvas in W1. |
| vercel/chatbot a8989b522fa3672a2ae52f053105e40993b36ca1, Apache-2.0 | components/chat/artifact.tsx panel/preview and version UI, SWR query/refetch pattern. Select isolated presentation components after removing app-specific types. | Next.js server, AI Gateway dependency, Vercel Blob/Postgres, chat/artifact business model. |
| Neo Chat cc2fafe2e6db579df61059c2f684649b07d441ca, MIT | src/lib/chat/streamResilience.ts checkpoint/overlap and unsafe-continuation patterns; model/tool interaction reference. | Browser-local scientific state, automatic tool replay, full app. |
| DEEIX-Chat ca5961a232adc2dfbed78e1079cc7071ecea6119, Apache-2.0 | use-chat-run-stream.ts actual UI trace and streaming interaction reference. | Go enterprise backend, billing, identity/platform routing stack and duplicated Agent. |
| Aivory b7599d1b36452432066c1c8809af54db1fa0f24f, Apache-2.0 | artifact-panel.tsx preview/editor/sidebar and sandboxed HTML patterns, Desktop interaction reference. | Full Go/sandbox/agent product and unreviewed HTML execution. |
| Blueprint bfcf98efba17403973fc1a6d25882039aca7d7d5 | Design inspection of typed evidence/claim graphs only; no root license file found. | Copying or redistributing source without license clearance. |

Galaxy analysis-history patterns (Goecks et al., Genome Biology 2010, doi:10.1186/gb-2010-11-8-r86) and the previously mirrored AiiDA provenance/source history are conceptual scientific references. Do not adopt either runtime. Source audit stops here: no further broad candidate search is needed for W1.

Selected frontend: React + TypeScript + Vite; React Flow + Dagre; SWR read cache plus local selection; existing SSE pattern; assistant-ui for W2 conversation. Keep FastAPI Python backend. No Next.js migration, heavyweight frontend store or full framework fork. Source-level fit is established; package install/build/version alignment and browser tests happen in the isolated W1/W2 stages, not claimed here.

| V1 component | Decision |
|---|---|
| React/Vite, FastAPI, component styles/tests, layout primitives | Retain where compatible. |
| TaskGraph.tsx | Replace fixed horizontal stage projection; reuse React Flow controls and useful rendering primitives only. |
| useTaskStream.ts and backend stream.py | Adapt event-source lifecycle, invalidation and stale handling; replace old task schema/event names with shared public-query contract. |
| TaskSidebar, NodeDetailDrawer, EvidencePreviewViewer | Adapt layout/interaction and safe preview renderers; replace old IDs/models, use exact authorized evidence references. |
| Old PostgreSQL db/repository/models/projection/service and managed-record routes | Replace/remove on the V2 path after dependency review. No migration/compatibility requirement. |
| App and API client | Refactor into research tree, workflow and inspector; reuse basic connection and error presentation. |

## D. Real research walkthrough and W1 pilot

The real historical DAP-seq project replay was reopened through actual Governance tree/context/routes/evidence and Core now. Its engineering topology has 16 scopes, 18 requests, 18 historical submissions, 7 related links and 9 reused evidence hashes. The replay source files (71) were hashed before and after read checks, unchanged. Historical replay question wording is reconstructed, not a claim of original user text or a new scientific run.

A private static HTML information-architecture walkthrough was generated from those exact public responses and a separately reverified actual Statistics report. It shows the full scope hierarchy, a selected actual plan and its evidence anchor, alternate same-scope failed/successful routes, an actual valid zero-result case versus a technical failure, partial delivery, and a bounded actual result table. The selected historical plan has one step; the separate interface fixture verified dependent-step progression. Six source links resolve. Historical native Web events and unavailable figure artifacts are explicitly missing, not fabricated. Browser rendering was not tested (no browser was available in the authorized CI environment); W1 browser QA remains required.

This confirms the pilot information architecture: scope tree and request selection; current/selected plan and explicit intra-plan dependencies; source-backed historical route list; evidence inspector; table/text preview first, optional image/figure viewer only for actual supported artifacts. Keep scientific review, execution observation, snapshot integrity, computational association and experimental support separate. The Statistics case is independent and is not an evidence edge for the DAP-seq project.

W1 scope: read-only vertical slice over actual public Core/Governance queries, shared snapshots/SSE refresh, real project tree + selected workflow + evidence inspection, with private real-case acceptance and synthetic dependency/error tests. Do not start model/provider runtime or broad module UI in W1. No raw project or benchmark inputs are committed to the public repository.

## Disposition

A: verified public read, confirmation and concurrent-conflict paths; projection and module envelope selected. B: direct SDK/lifecycle/remote-service design selected, trusted hook verified; owner-configured live provider and Scientific Review API transport not implemented or live-tested. C: bounded source/license reuse decisions made; packages not yet installed/built. D: real source-backed static walkthrough and report verification complete; browser QA remains W1.

## Corrections from the W1 build (2026-11-26)

Checked against Core 69f2fbf (0.2.0) and Modules 3acc891 (Governance 0.1.2) source and the installed CLIs, using synthetic workspaces only.

- CLI and MCP are equivalent only when request_id is given. Without it the CLI (no session) resumes an identical question or adopts the single open request, while MCP (empty session) always creates a new request at science_begin and refuses an unbound mutating call. Source: Host mcp_server.py and the kernel's begin/resolve paths.
- The confirmation seam verified in B is the Agent-host hook CLI. Host identity and session are declared by the caller, the original prompt is stored only for the claude host, and Core ships wiring for Claude Code, Codex and CodeArts only. It was exercised here as a transport; it is not a Core-provided interface for a Web host. Source: Host hooks.py and cli.py.
- W2 decision on that seam (2026-11-26): the Web backend drives the generic hook as itself, without an agent-host flag, with one server-generated session per conversation; see the plan, W2. Observed with the installed CLI: an unbound session and a message merely containing the phrase leave an amendment pending; the bound session's exact message applies it; the hook also records its one-shot key when no amendment is pending, so the same text sent again later is ignored.
- A Core read is not free of side effects on an empty or partial state directory: constructing the store creates whichever of `requests`, `evidence`, `sessions` is missing, and doctor writes and removes a probe file. Reads of a complete existing workspace changed no file. The Web adapter calls Core only where all three directories exist and never calls doctor.
- science_now re-hashes the evidence files of the last 12 submissions on each call, so it is polled less often than Governance. Measured on the build host: about 0.25 s per science_now call and under 0.1 s per Governance call on a three-request workspace.
- science_now returns the current plan, Core-computed step progress and a count of retained historical submissions. It does not return plan history, per-submission records or a reuse-invalidation list. Governance returns submissions and evidence references for scoped requests only, and returns evidence identity, not content. File evidence can be previewed from its recorded source inside configured roots; text evidence content has no public read path.
- Shortened Core answers and recorded evidence sources contain absolute server paths. The Web adapter replaces configured workspace and evidence-root directories by labels before anything reaches a browser.
- Memory: the public MCP tools implement FAST and STANDARD recall; DEEP and TaskMemoryGraph are module-internal at this revision. Literature: search and fetch return paper records and download/validation entries, not passages.

Under the existing W0 exit definition, W1's public read path, shared refresh, real pilot and remote topology are settled. Remaining W2 provider activation is explicitly open, and its review adapter belongs to the existing module; do not call W0 a completed live API or production acceptance. No Core/Modules/Eval source, production service, scientific result or dataset changed. Update implementation status and remaining checks in the single V2 plan.
