# BioHarness Research Workspace V2 — Product Plan

**Status (2026-11-28): R2 complete in source; R3 next; R4 pending.** The adopted `ui/` and native backend passed Steps 1–5 and independent hardening. Production cutover is a separate owner decision.

**Active TODO:** §17.3. Fixed design/technology: §17.4–17.5. W0–W5 and prior execution records are history, not parallel work queues. The complete pre-consolidation decisions, test counts and provenance are retained in this file at Git `3091fea51b2532c6eaff45b3723e67fd6ff68b6b` and [the W0 audit](../audits/w0-integration-review.md). Raw receipts remain private.

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

The research workspace keeps project navigation shared while giving conversation and scientific workflow separate full-width pages under an explicitly selected request. A researcher can read and respond without a permanent graph beside the conversation, or inspect the plan and evidence without a composer occupying the workflow page. Explicit navigation connects the views; detail subpages replace the primary content and preserve a clear return path.

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
| Frontend | Existing complete application frontend adapted from source: LibreChat, with `dsh-context`'s selected page organization. Current custom UI retired; complex components must come from the fixed upstream selections (§17.5). |
| Backend | Retain the implemented FastAPI runtime and public Core/Module boundaries; frontend replacement does not replace scientific execution. |
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

Use a shared application sidebar and request header above separate **Conversation**, **Research workflow** and **Evidence** routes. Each route has one primary content area. The workflow defaults to the plan alone: no permanent step inspector, evidence cards, KPI row or lower execution panel. Selecting a step opens a detail subpage that replaces the canvas; returning restores selection and viewport. Execution records are a separate request-level auxiliary page, reachable from the header, not a fourth primary tab. Evidence uses list → detail navigation rather than another persistent pane.

Desktop is the primary acceptance surface. At narrower widths, project navigation becomes a drawer and the plan defaults to a dependency-labelled step list with an optional fullscreen graph; details still use the full content area. Do not compress type or retain several panes. Exact page content, source reuse and a static, offline HTML/SVG design artifact are specified in §17.4. The current request is design-only: no application construction, dependency installation or donor integration.

## 9. Technology choices

Source evidence: [W0 integration and reuse audit](../audits/w0-integration-review.md) and §17.4. The owner's 2026-11-27 direction supersedes the former component-only/no-whole-app-fork policy. Use a complete existing application frontend as the replacement foundation and adapt the selected `dsh-context` views from pinned source; copying screenshots or continuing the old custom shell does not satisfy this direction.

| Area | Current selection | Remaining scope |
|---|---|---|
| Frontend | Complete LibreChat application and selected dsh-context presentation (§17.5) | R3/R4 views; retain donor foundation |
| Graph/tree | React Flow + Dagre; rc-tree | Scientific provenance and comparison |
| State/streaming | Donor React Query and routing; HTTP snapshots + SSE | Retain identity isolation, stale recovery and replay |
| Evidence | AG Grid Community, PDF.js, Monaco and image/HTML views | Broader result and artifact formats |
| Backend/model API | Python + FastAPI; existing direct provider adapters | Public Module integration; no additional Agent runtime |
| Persistence | Core/Module stores; Web technical SQLite ledger | Execution recovery, not scientific state |
| Desktop | Thin remote-service Tauri client | R4 |

## 10. Development milestones and TODO

The sole active delivery checklist is §17.3. W0–W5 are historical engineering stages, superseded for scheduling by R1–R4. Full historical checklists and receipts remain in the pre-consolidation Git revision named above; the [W0 audit](../audits/w0-integration-review.md) remains the contract/source reference.

| Historical milestone | Disposition |
|---|---|
| W0 — public contracts, runtime, source and project audit | Retained contract evidence; settled choices not reopened |
| W1 — read-side tree, plan and evidence | Implemented and carried into R2; private deployment access limits remain |
| W2 — model API, sessions and recovery | Implemented and carried into R2; genuine concurrent hosts, partial Module outputs and real long-running executor acceptance remain R4 |
| W3 — common Module observations | Common invocation/discovery implemented; domain inspectors, Memory, Review and resource integration are R3 |
| W4 — evidence, comparison and pilot | R2 bounded views/read-only acceptance complete; provenance, comparison and real scientific pilot remain R4 |
| W5 — Desktop | Deferred to R4 |

## 11. Cross-cutting acceptance and evaluation

The first full end-to-end pilot covers three request types:

1. **EXPLAIN:** a literature/method question with source-backed references.
2. **EVALUATE:** a research idea with prior work, data/method assessment and alternative routes.
3. **ANALYZE:** a bounded real analysis using a configured scientific Module, with actual parameters, outputs and evidence.

Retained behavior acceptance criteria (apply during active milestones):

- Original user question is retained verbatim.
- Core objective and requirements remain the mainline.
- A model-proposed mainline amendment cannot be self-confirmed.
- Missing or failed scientific review is disclosed and work continues.
- Multiple open requests are never guessed.
- Project tree and current request binding are shown accurately.
- A Memory candidate is not reported as used without a real usage record.
- A failed technical run is distinguished from a scientifically negative result.
- Tool output containing hostile instructions cannot change system rules.
- API keys, tokens, passwords, private paths and SSH credentials do not reach the browser or trace.
- Large files are referenced or previewed within limits rather than copied wholesale into model context.
- Server restart and interrupted tool calls leave the Core request recoverable.
- Stopping Web does not itself rewrite scientific state; in-flight external/local operations are reconciled or explicitly reported as unknown.
- Browser disconnect and stream stop do not imply cancellation. Reconnect and ambiguous writes do not duplicate scientific work.
- Common snapshot/refresh behavior matches external Core mutations and reports stale revisions; no cross-branch gates are introduced.
- The public Web repository contains no private research inputs, results, credentials or infrastructure/receipt details.
- The same scientific task can be evaluated independently through BioHarness-Eval.

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
| OpenAI4S (`c93d46a`, MIT) | Attention Stream pending-action cards, version-frozen bounded scientific artifact previews (oversampled tables, FASTA, dual-tab search records, partial/error three-state honesty), multi-tab Skills/Diagnostics/Settings IA with inline `ActionStatus` and locked-control reasons, plain-language-first timeline with collapsed technical details, `@evidence`/`/` composer triggers, 503 last-confirmed vs empty honesty | Preact/Signals + `window.S` shell, built-in Python/R kernel/agent runtime, free-form CRUD Memory editing, browser-submitted API keys or arbitrary path browsing |
| Tauri | later Web-to-Desktop packaging | Desktop should be built before Web |

Code reuse requires source-level review of license, maintenance, dependencies, data handling and whether it duplicates Core or Modules.

## 13. Deployment direction

Remote-service-first is fixed and an authorized private Linux deployment has been activated through formally installed public Core/Governance CLIs. Private host/workspace/credential identities stay outside this repository. Browser and later Desktop connect to the same backend via authenticated API/SSE. Service/workspace/request identity and server-side evidence resolution are explicit. Keep API keys and tools on the backend; avoid broad mounts and public exposure before access isolation and TLS review.

See [deployment and operations](../deployment.md). The private deployment remains unchanged; R2 cutover requires explicit approval and must not rewrite Core/Modules records.

## 14. Open decisions

Remaining development is maintained only in §17.3. The optional Review adapter belongs to its existing Module. Private R2 deployment switching requires owner approval. Interactive assistive-technology testing and dependency/distribution findings are disclosed in §17.5. Do not reopen settled UI, Core transport, model selection, ledger or remote-service topology merely to repeat validation.

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

## 17. V3 Product Architecture Upgrade (2026-11-26 Closeout)

**Current baseline:** R2 adopted frontend and native host are complete in source. `ui/` is the sole application frontend; historical `frontend/` is retired in Git. Retain the public Core/Governance contracts, technical ledger, server-side model configuration and verified behavior. R3/R4 extend this implementation, not a new shell or scientific runtime.

### 17.1 Finalized V3 architectural decisions

1. **Flexible Governance hierarchy (no rigid schema):** Core `scope` uses `parent_id` for arbitrary depth. V3 adopts **Project → Question → Analysis → Route A / Route B / historical failed Route C** as the *default recommended research organization paradigm*, while supporting omitted or deeper levels, multiple historical requests under one route, and a dedicated **Unscoped Requests** group. Drag-and-drop reparenting of existing scopes is prohibited; historical attempts under a route are never auto-interpreted as scientific dependencies.
2. **Dual-track workflow as the centerpiece (plain-language-first):** Keep the **Core Scientific Plan track** (`science_now` plan steps, `depends_on`, `EXPLORE` branches, `R1..Rn` coverage) strictly distinct from the **Observed Execution track** (`operations` and module invocations). Read execution observations independently of the conversation panel using explicit service/workspace/request/conversation identity. Attach events to a step **only with a trusted host-recorded step link and owner-confirmed matching plan version**; keep unlinked or version-unknown events at the **Request level**. Never infer step ownership from model-supplied tool arguments, timestamps or prose. Clicking a step drills down into the exact Memory items, literature, methods, parameters, tools, data and statistical verifications genuinely linked to that step, without presupposing fixed module calls. Default the inspector to plain scientific language and collapse raw IDs, token breakdowns and raw JSON payloads under a "Technical details" drawer (auto-expanded only on `partial`, `failed` or `UNKNOWN` recovery states).
3. **Five-layer runtime identity, Attention Stream & non-blocking background runs:** Separate **Project/Scope**, **Core Request**, **Conversation**, **Run** and **Operation** in both state and UI. Retain the verified `1 Conversation : 1 Core Request` explicit binding (never silently swap `request_id` inside an existing conversation). Add a global active-run indicator so researchers can browse other projects, memories or artifacts while runs continue in the background, plus a top-level **Attention Stream** — strictly an aggregated read projection of existing pending items (`确认主线 A#`, `WAIT_FOR_USER`, `begin_reconcile`, `goal_version_changes`) rather than a second task state machine; clicking a card navigates to the corresponding scientific request and never auto-confirms or mutates scientific state.
4. **Human-in-the-loop (HITL) scientific collaboration:** Provide first-class UI surfaces for five core interactions: native mainline amendment confirmation (`确认主线 A#` via server-side user-message hook), `REVISE_PLAN` guidance, `WAIT_FOR_USER` / `QUESTION_FOR_USER` responses, allowlisted input data path attachment (via `@evidence` and `/` Skill triggers in the Composer), and branching/resuming from historical routes with explicit `related_request_ids`.
5. **Artifacts & Evidence Workbench (six dimensions, zero extra databases):** Present **Data** (inputs, versions, samples, reference genomes), **Methods** (method choices, `parameters_used`, software/runtime), **Results** (charts, statistical reports, `report_binding.py` verification status), **Evidence** (literature, data sources, SHA-256 anchors, snapshot integrity), **Comparison** (cross-route condition/parameter/version diffs) and **Findings** (conclusions, counterevidence, limitations, open questions) as workspace tabs and inspector panels projected from Core, Governance `routes` and project documents. Explicitly separate technical failures, scientifically negative results, partial results, historical evidence and current conclusions. Bind evidence previews to their recorded anchor and verify against the recorded SHA-256: **because current Web reads the live source file and checks whether it still matches the recorded hash, any unavailable or drifted historical snapshot must be disclosed explicitly — never present a modified current file as a historical snapshot**. Enforce explicit three-state read honesty (`complete` / `partial` truncation notice / classified error card), bounded sampled previews for oversized tables (CSV/TSV/xlsx/gz with full-shape disclosure), FASTA 60-residue numbered viewing, syntax-highlighted scripts, dual-tab Literature search results (records table vs raw JSON with honest `next_cursor` scope) and UTF-8/GB18030 detection.
6. **Memory workbench & in-module Curator boundary:** Reuse `bioharness-module-memory`'s existing `CuratorProposal`, `CuratorDecision`, `inspect_proposal()`, `inspect_scientific_proposal()`, `publish_reviewed()`, `inspect_memory_health()`, SHA-256 verification and SQLite CAS. Controlled public curation read/publish entry points belong inside `bioharness-module-memory`; Web provides thin BFF forwarding and review/diff/publish UI rather than a second curation engine. Expose **information depth (T1/T2/T3)** and **retrieval depth (FAST/STANDARD/DEEP)** as two independent UI controls (never conflating `DEEP` with `T3` expansion), and **explicitly mark `DEEP` as unavailable whenever the Memory module has not exposed it publicly**. `bioharness_memory.source_registration` currently remains a trusted Memory-operator CLI; future Web integration must go through a controlled public interface exposed by the Memory module rather than bypassing operator boundaries.
7. **Scientific Review baseline update:** Align native model API advisor work to `bioharness-module-scientific-review` **0.7.0 / Revision 10** (`3382edc`, which consumes `AdviceRequest` directly and drops legacy managed-record review ports, while still using the CodeArts launcher), once its merge to Modules `main` and verification status are confirmed, rather than extending 0.6.7 / Revision 9.
8. **Four-state Skills & Resources hub, Settings IA & P1 Remote Compute:** Organize Core `[[resources]]` (`memory`, `knowledge`, `data`, `workflow`, `compute`, `service`), workspace `SKILL.md` entries, Governance project documents (`contract`, `guide`, `status`, `findings_index`) and Literature outputs under four explicit states: **Declared**, **Installed**, **Callable** and **Actually Used**. Adopt a multi-tab Settings & Capabilities IA (`General / Models / Skills / Memory / Modules / Compute / Diagnostics`) with inline `ActionStatus` feedback beside controls, explicit reasons on read-only/server-locked controls, passive security-posture & redacted diagnostics export, and honest 503 stale-vs-empty handling ("last confirmed HH:MM:SS", never misreporting unavailable data as empty). Add P1 remote-compute observability (external executor handles, long-job recovery, intermediate artifact refs, failure diagnostics, explicit cancellation request vs confirmation, and deliberate retry without blind replay).

### 17.2 Current source ownership

| Source | Disposition |
|---|---|
| `backend/bioharness_web/` | Existing host, public adapters, direct provider, model configuration, SQLite ledger, SSE and bounded evidence transport |
| `ui/client/src/host/` | BioHarness identity, business and view bindings |
| `ui/client/` and `ui/packages/` | Pinned mature source; preserve upstream provenance and modification notices |
| `tests/` | Retain backend/contract and adopted browser regression behavior |
| Historical `frontend/` | Removed from source; Git history only |

### 17.3 Phased V3 Roadmap (R1–R4) and Continuous Real-Project Acceptance

Use bounded real-project checks throughout, separating fixture transport tests, read-only project walkthroughs and actual scientific execution/evaluation.

- [x] **R1 — Historical workbench and contracts.** Behavior carried forward; custom four-zone frontend retired.
- [x] **R2 — Adopted frontend, native sessions and HITL.** §17.4 Steps 1–5 and independent audit accepted in source. Real model Core EXPLAIN/EVALUATE/ANALYZE loops, native A1 confirmation, read-only multi-branch walkthrough and restart recovery recorded in §17.5. Existing deployment unchanged.
- [ ] **R3 — Memory Curator, Skills/Resources and domain Modules.**
  - Memory: T1/T2/T3 independent of FAST/STANDARD/DEEP; DEEP and TaskMemoryGraph only through exposed owner interfaces. Curator proposal/review, exact T3 source verification, operator-gated source registration, applicability/conflict/use feedback. Acceptance: isolated recall → propose → T3 verify → publish → recall without bypassing module authority.
  - Resources, Skills and Documents: declared / installed / callable / actually used; existing project documents and redacted diagnostics, no duplicate registry.
  - Literature, Statistics, Scientific Review and analysis/workflow inspectors: actual sources/passages, units/grain/groups/denominators/tests/effect sizes/correction, deterministic report binding, actual versions/parameters/results and non-blocking review. Direct Review API adaptation stays in its owner module. Evaluate orrery for provenance if useful. Common inspector remains available for unsupported modules.
- [ ] **R4 — Results, provenance/comparison, remote compute and Desktop readiness.** Complete six content dimensions (Data, Methods, Results, Evidence, Comparison, Findings), recorded provenance edges, research-wide search, version/parameter/input comparison, negative findings/counterevidence and recorded downstream reuse impact. Expand supported artifacts based on real need. Add actual external executor handle recovery and deliberate retry; verify genuine concurrent-host STATE_CHANGED handling, partial Module outputs and real long-running work. Conduct real multi-branch scientific project acceptance and independent Eval (including actual Memory-use evidence for the owner's ON/OFF comparison when needed). Prepare thin Tauri client over the same remote API/SSE; sidecar only when justified. Verify larger workloads, deployment/rollback and real scientific workflow end-to-end.

**Release:** private R2 cutover requires explicit approval, not an R3 scientific gate. Public distribution requires reviewing dependency/license findings and authentication/TLS. Version differences and advisory disagreements do not automatically stop research.

### 17.4 Upstream-based UI replacement design (2026-11-27)

**Owner direction:** retire the entire current custom UI; use an existing product for secondary development; adapt `dsh-context`'s layout for the Web; put conversation and workflow on separate primary pages. **Design frozen on 2026-11-27:** the owner accepted the current seven-board design, deferred further optimization and requested fixed mature reuse choices for every complex component and the foundation. Page hierarchy and visual layout below remain unchanged. §17.5 selects LibreChat as the application/chat foundation, superseding the earlier Aivory recommendation on maturity grounds. The fixed selection has passed R2 source/build/integration acceptance. No further visual redesign is part of R3/R4. The screenshot's surrounding sidebar and Chat tab belong to DeepSeek Harness, not to `dsh-context`; the plugin alone cannot supply a complete chat application.

**Design artifact:** [seven separately selectable static HTML/SVG boards](research-workspace-ui-design.html), not product code, a working prototype or another roadmap. The refinement applies [cathrynlavery/diagram-design](https://github.com/cathrynlavery/diagram-design) at `795eec47fd376e5dda0b9e056a49520060cd2f13` (deletion-first hierarchy, bounded density, one focal object, orthogonal relationships and no shadows), combined with `hello-ui`'s single-task and state-coverage guidance. Its editorial tokens are customized rather than copying the skill's default skin. All scientific content in the boards is explicitly illustrative, not an execution trace or validation claim.

#### Source reuse and replacement boundary

| Source | Concrete reuse | BioHarness adaptation |
|---|---|---|
| [LibreChat](https://github.com/LibreChat-AI/LibreChat), `v0.8.9` / `d4e85d2205c78413ee27d631d7e3b7313556f21d`, MIT | Adopt the complete application frontend and required UI packages, including `client/src/routes/Root.tsx`, `components/UnifiedSidebar/`, `components/Chat/{ChatView,Input,Messages}`, `packages/client` and `packages/chat`. Retain upstream responsive navigation, message/composer interaction and accessibility. | Connect BioHarness through the existing Chat/Composer/Stream host-provider seams and explicit route/query mapping. Do not require LibreChat's API server, database, agents, Assistants, MCP execution host, marketplace or telemetry. Remove unsupported actions rather than reimplementing the shell. The tag is marked prerelease upstream; §17.5 records that limit. |
| [dsh-context](https://github.com/bowenliang123/dsh-context), `dafccf280bedba25bec4923d259411e143051613`, version 0.87.2, Apache-2.0 | Adapt selected presentation from `src/client/components/{fleetView,missionPulse,pulseSelection,pulseEvents,pulseTimeline}.tsx` and relevant `styles/{base,pulse,agentGraph}.css`. Keep independent views, selection feedback, bounded event inspection and graph-card treatment; simplify the Fleet composition rather than retaining its full summary/card/event dashboard. | Replace Harness services, host module loading, remote data hooks, navigation and UI primitives. Bind retained styles to one application theme, not a second imported design system. Do not import session-log parsers, prompt injection, projection caches or fleet task state. Inspect each retained file's dependencies before copying it. |
| dsh-context graph cards and existing graph libraries | Adapt the upstream card presentation and selection treatment; use React Flow and Dagre for a directed plan graph. | `agentGraph.tsx` uses `layoutForest` and `parentId`, which cannot represent general multi-predecessor `depends_on`. Agent ancestry must not be relabelled as scientific dependency. Old BioHarness graph components retire. |
| Existing BioHarness backend and nonvisual contracts | Keep native provider execution, Core/Module public interfaces, authentication, ledger, recovery, evidence resolution and their behavioral tests. | Carry safe rendering, identity and stream handling into the adopted frontend. Current pages, styles and components are not the replacement foundation. |

Keep upstream LICENSE/copyright and applicable NOTICE material, record pinned origins and mark changed upstream files. Root licenses and selected component package metadata were inspected; copied-file/transitive license and security checks still precede redistribution. Preserve LibreChat's pinned React 18.3.1 baseline rather than forcing the retiring frontend's React 19; dsh-context's React 18 peer range aligns, but its Harness module-loader build still requires source-level host separation. Existing UI package dependencies are not permission to import another scientific runtime.

#### Shared navigation and page layout

**Page budget:** one primary content area and one dominant action per view. No metric-card row, permanent inspector, evidence card column, lower execution panel or nested drawer. The entire workspace is not one dashboard. Navigation controls are not a license to display every destination simultaneously.

Use one adopted application sidebar, approximately 224–256 px on desktop, with workspace selection, new research, project/scope navigation, request history and Unscoped Requests. Preserve arbitrary scope depth; request selection, not the newest conversation, determines scientific context. Service identity remains available in the workspace selector and technical connection details. Resources and settings are secondary destinations, not a second activity rail. Do not surface unfinished Memory/Compute hubs as functioning top-level pages.

The request header shows the readable question and scope breadcrumb above three primary tabs: **Conversation / Research workflow / Evidence**. Execution records are a request-level auxiliary page reached through a quiet header action, not a fourth primary tab or a permanent panel. Show a compact background-run state only when relevant; pending items remain a read-only projection and clicking them only navigates. Scientific, execution and connection states are never merged into one status, but they need not be three permanently expanded bars.

| View | Default content | Deeper content | Excluded from the default view |
|---|---|---|---|
| Conversation | One message column and composer; current native-user response item when present | Explicit links to plan or evidence; concise invocation entries can be inspected | Plan canvas, evidence sidebar, usage tiles, raw execution log |
| Research workflow | Full-width current Core plan; graph/list controls | Step detail subpage replaces the canvas; back restores its viewport | Permanent step inspector, result cards, event strip, KPI row |
| Step detail | Title, recorded state and one selected reading section | Local sections: goal/method, inputs/outputs, recorded work/evidence; technical details folded | Every field shown at once, operation association inferred from prose, “run this step” |
| Evidence | Actual request-level references in a readable list | Single evidence detail replaces the list; explicit scope-history destination | Six empty dimension panels, decorative provenance graph, current files posing as history |
| Execution records | Bounded request-level observation list; relevant recovery warning | Single-event detail with redacted returned data | Fabricated step swimlanes, Agent-family graph, unrecorded cost/context charts |

**Conversation page:** one readable message column, about 820–960 px maximum width, with donor message/composer interactions. Show the original question, actual assistant messages, concise tool summaries, cited evidence and native-user response items. A pending response stays in the conversation rather than creating a separate task dashboard. Unsupported donor actions are absent. Regenerate/edit-and-replay cannot bypass reconciliation; while another run prevents sending, retain the draft and explain why. Opening a citation navigates to that exact evidence detail and preserves the conversation, draft and return position; this is not a persistent evidence pane.

**Research workflow page:** use the entire primary area for Core's plan. Keep only the information needed to understand its steps and explicit `depends_on`: readable titles, recorded state and a concise method/output summary if needed. One current/selected item is visually emphasized; no multi-color module inventory. No completion percentage is calculated by Web. Core's instruction or a relevant pending response appears as one short contextual notice when needed, not several always-on cards. The graph/list control does not change scientific state. Large plans use search, focus and a readable list rather than shrinking every label.

Selecting a step enters **step detail**, replacing the plan in the primary area. “Back to plan” restores the selected step and viewport. The default reading section is goal/method; inputs/outputs and recorded work/evidence are separate local sections. Only explicitly associated records are shown as step-related. A trusted host-recorded step link and an owner-confirmed matching plan version remain necessary for operation association; absent that, events stay on the separate request-level execution page. A detail page never offers independent execution of the selected scientific step.

**Execution records:** a separate auxiliary view uses dsh-context's event filtering and item-inspection organization, with bounded pagination. Clicking one event enters its detail view rather than adding another rail. Display actual fields and timestamps; missing completion time remains unknown. No Agent ancestry or invented lanes. Provider-returned usage can be inspected as technical data; cost/cache/context composition stays unavailable without its required records. Do not expose private reasoning. Leaving this view does not stop execution, and cancellation requested is distinct from cancellation confirmed.

**Evidence:** list first, then one full-content detail view. The preview is the default detail; source/check information is a local section and raw identifiers stay folded. Request results and Scope history have explicit distinct navigation and partial-page notices. Selection retains the complete workspace/request/submission/evidence/SHA-256 anchor. Verify the live file before preview; a changed file produces a drift warning, not a substituted historical snapshot. Graphs appear only when useful source-backed relationships exist. The six scientific dimensions remain a future R4 content goal, not six empty panels in this replacement.

#### Cross-view interaction and Web adaptation

- Switching pages, back/forward and reload preserve explicit service/workspace/request identity and conversation binding. Each page retains its relevant selection and position; step/evidence/event details have stable, recoverable selection. Project changes never silently rebind a conversation. A request without a conversation remains readable; an unbound intake displays reconciliation rather than another request's plan.
- “Discuss this step” navigates to the bound conversation and prepares a visible editable reference. It does not send, change Core's next action or imply future tool-step provenance. Historical requests offer a deliberate related follow-up instead of silently continuing a delivered request.
- Only deliberate native-user submission can answer or confirm an actual pending item. Global pending-item navigation does not mutate scientific state. An ambiguous response is reconciled before retrying.
- Execution observation loading is independent of whether the conversation component is mounted. Page changes and SSE disconnects do not stop computation. Reconnection refreshes authoritative Core state and actual operational state without duplicate execution.
- Use one coherent donor-derived theme. The design draft uses neutral paper, deep readable text and restrained teal emphasis: `paper #f6f7f5`, `surface #ffffff`, `ink #202826`, `muted #56635d`, `accent #18655e`. No gradients or shadows, one focus treatment, 14–16 px primary text, 24–32 px content gutters, 4/8 px spacing rhythm and 4–8 px radii. Preserve tested light/dark support during later donor adaptation; this static draft reviews the light theme only. Do not ship two products' navigation or token systems side by side.
- Narrow screens use one navigation drawer, a dependency-labelled step list and optional fullscreen graph. All details use the full primary area, not stacked sheets. Preserve at least 44 px touch targets, visible keyboard focus and graph/list keyboard navigation. Long titles wrap; list order must not imply dependencies or execution order.
- Empty, loading, partial, unavailable and stale remain distinct. A 503 retains the last confirmed view with a timestamp and refresh action rather than blanking it. Failed/UNKNOWN outcomes and drifted evidence disclose relevant recovery information immediately; a missing result is never zero or successful empty output. These contextual warnings are not a permanent global status wall.

#### Deferred integration sequence and acceptance within R2

All five engineering steps are completed in source; retain their behavior and fixed §17.5 selections.

1. [x] **Acquire and baseline.** Exact archives, package/license identities, lock and Python baseline verified.
2. [x] **Independent donor frontend.** UI-only LibreChat build; no donor business backend/database/Agent services.
3. [x] **Native vertical slice.** Core/Conversation/Run identity, model settings, streaming, original question, native HITL and recovery.
4. [x] **Scientific views and evidence transport.** Research tree, multi-predecessor plan, independent execution details and exact-anchor bounded evidence.
5. [x] **Behavioral parity and replacement.** Retained regression, Chromium, read-only project and live-provider acceptance; old frontend removed. Deployment cutover separately authorized.

Preserve view switches/back/forward/reload, keyboard/narrow-screen behavior, no duplicate work or identity drift, empty/partial/stale/unavailable states, exact evidence and plan-version association, path/symlink containment, drift/range/pagination limits, native user confirmation, UNKNOWN reconciliation and actual cancellation outcomes. Source verification and read-only replay do not validate scientific results. Evidence and limits are in §17.5.

### 17.5 Fixed reuse selection and no-hand-built-complex-UI rule (2026-11-27)

**Decision:** §17.4's layout is frozen. Select the following implementations for the next build; do not reopen visual design while integrating them. This is a source-backed selection, not a claim that the replacement has been built, security-cleared or accepted. Package/source pins below are acquisition baselines; implementation must preserve an exact lock and record any security-driven update here rather than silently floating to latest.

#### Complete application foundation

**Use [LibreChat](https://github.com/LibreChat-AI/LibreChat), tag `v0.8.9`, commit `d4e85d2205c78413ee27d631d7e3b7313556f21d`, MIT.** Adopt its complete React/Vite client and required `packages/client` / `packages/chat` UI source, not a few components inside a new shell. The project dates to 2023, is actively maintained, has substantial adoption, checked-in interaction tests, a responsive `UnifiedSidebar`, and explicit Chat/Composer/Stream host-provider boundaries. `v0.8.9` was published on 2026-11-17 and is marked **prerelease** upstream; it is not described as a stable release. Those maturity signals justify selection, not production assurance.

This supersedes the tentative Aivory choice without changing the accepted screens. Aivory's `v2.5.2` (`77e6e571b43f3889f079f2d90cf6a21afaa442f1`) is an actual non-prerelease Apache-2.0 release, but the project began in June 2026 and has a much smaller adoption history. It remains inspected reference evidence, not a second application shell or fallback implementation. LibreChat is heavier to adapt; accepting that work is preferable to replacing the user's maturity requirement with a cheaper young donor.

Retain the donor's locked React **18.3.1**, React Router **7.18.2** and React Query **4.36.1** for the first integration. Do not force React 19 because the retiring frontend used it or introduce a parallel SWR query cache. `dsh-context`'s React 18 peers align with this baseline, but its host services still must be removed. The donor's npm `package-lock.json` at the pin is the dependency source, not an independent list of latest versions; the package declares npm **11.13.0**. Build-tool/Node compatibility is still an implementation check, and this selection does not authorize installing or downgrading anything now.

Use `client/src/Providers/{ChatHost,ComposerHost,StreamHost}Context.tsx` and existing transport/provider boundaries for BioHarness connections. The pinned Root and host implementations still import LibreChat authentication, file/Agent services, query/Recoil state and queued-job/stream recovery hooks. Map or remove those host-specific dependencies; a working UI-only build and observed browser network isolation are required, not merely the presence of provider seams. These are useful seams, not proof that a URL swap completes integration: existing resumable/queued-job handlers assume LibreChat protocols and must be mapped to BioHarness's event sequence, recovery and cancellation semantics. Retain required presentation/type packages while excluding API-server/domain runtime imports from the browser. The donor's root `frontend` build also builds API/schema packages, so an independently verified UI-only build boundary is necessary; do not run the whole product's backend as an expedient substitute.

#### Component selection matrix

| Capability | Fixed reusable implementation and version | Reuse boundary; prohibited replacement |
|---|---|---|
| Application shell, responsive sidebar, routes and settings navigation | LibreChat pin: `client/src/routes/Root.tsx`, `components/UnifiedSidebar/`, `components/Nav/Settings/` and existing routes | Adapt navigation items, identities and theme to the accepted screens. No new shell, drawer/swipe/resize engine or parallel Aivory UI. |
| Messages, composer, attachment display and streamed text | LibreChat pin: `components/Chat/{ChatView,Input/ChatForm,Input/Composer,Messages}`, `packages/chat` | Keep established input, scrolling and message presentation; replace host/data bindings. No self-written composer/stream animation/virtual list. Remove unsupported edit/replay/branch/Agent/sandbox actions; never inherit their mutating behavior implicitly. |
| Markdown, GFM, formula and code-block rendering | LibreChat `Messages/Content/{Markdown,MarkdownBlocks,MarkdownErrorBoundary,markdownConfig}`; donor lock: `react-markdown 9.0.1`, `remark-gfm 4.0.0`, `remark-math 6.0.0`, `rehype-katex 6.0.3`, KaTeX `0.18.10`, DOMPurify `3.4.17` | Reuse the complete renderer and configure a restricted plugin/component set. Do not copy executable Artifacts/MCP-app directives, private reasoning rendering or a custom HTML sanitizer. Keep untrusted HTML disabled unless an explicit sanitized preview contract requires it; default-safe Markdown is not a guarantee after arbitrary plugins. |
| Dialogs, tabs, menus, comboboxes, popovers, tooltips and form controls | Existing `packages/client/src/components/` implementations: `OriginalDialog.tsx`, `AlertDialog.tsx`, `Tabs.tsx`, `ControlCombobox.tsx`, `Dropdown.tsx`, `Popover.tsx`, `Tooltip.tsx`, `Input.tsx`; pinned Radix/Ariakit dependencies | Reuse complete donor components. Their libraries own focus trapping, dismissal, positioning and keyboard behavior. Do not create another primitive family. |
| Missing standard UI blocks only | [shadcn/ui](https://ui.shadcn.com), Radix variant, source `shadcn-ui/ui@0e5b2e621a9ee4cf6a604bbe6c5c0d5b70561eb4`, MIT | Only a concrete donor gap permits copying a verified official component/block. Retheme to the donor and reuse its existing Radix versions; no wholesale second design system or copied community registry scripts. shadcn's Data Table tutorial is not selected as a ready-made complex grid. |
| Research project/scope tree | [`@rc-component/tree 1.5.3`](https://github.com/react-component/tree), `b31625a1c219c980056d473fe189dfa4334c2712`, MIT | Existing virtual list, controlled expansion/selection and Arrow/Home/End keyboard handling. Map public Governance nodes to stable keys; set `draggable=false`, omit editing/reparenting handlers. Do not hand-build recursive navigation, virtualization or tree keyboard logic. Its own styles are adapted, not the entire Ant Design system. |
| Scientific plan canvas | [`@xyflow/react 13.0.3`](https://github.com/xyflow/xyflow), `9635a064f9d44cc10c460e3a0c9ca20ad0852450`, MIT, with its built-in nodes/edges/controls and official examples | Reuse zoom/pan, selection, fit view and accessible focus. Adapt dsh-context node presentation as a thin label/status template. Disable connect/delete/reparent behavior and scientific graph editing; never write canvas hit-testing, edge routing or keyboard engines. Official free examples, not paid Pro examples, are the reusable source. |
| Directed dependency layout | [`@dagrejs/dagre 2.0.0`](https://github.com/dagrejs/dagre), `9f8ee8b4ea7f0d2e4f8a3d34653f23eda05fad8d`, MIT | Use the existing layout engine for Core-returned `depends_on`, including multiple predecessors. No custom force/forest layout, no local scientific cycle/dependency validator. dsh-context Agent ancestry is not a replacement for plan semantics. |
| Workflow/event selection and inspection presentation | `dsh-context 0.87.2`, `dafccf280bedba25bec4923d259411e143051613`, Apache-2.0; `fleetView`, `pulseSelection`, `pulseEvents`, selected `pulseTimeline` presentation | Adapt existing views to the finalized one-primary-area design and actual BioHarness observations. Do not recreate the whole dashboard, invent a timeline engine, expose raw/private context or import Harness persistence/runtime. Unknown event-step associations stay request-level. |
| Ordinary record lists versus complex data tables | LibreChat `packages/client/src/components/Table.tsx` for ordinary bounded lists; [`ag-grid-react` + `ag-grid-community 36.2.0`](https://github.com/ag-grid/ag-grid), npm source `0fee5b7b1e839ae23fe860e404042448f3c1375d`, MIT | Use complete AG Grid Community for real sorting/filtering/column sizing/row-column virtualization. No home-built grid, spreadsheet engine or headless-table assembly. Preserve backend pagination/partialness; client sorting applies only to fetched rows unless the server contract supports full-set sorting. Do not install `ag-grid-enterprise` or imply paid grouping/pivot/Excel features are free. |
| PDF evidence | [Mozilla PDF.js generic viewer](https://mozilla.github.io/pdf.js/getting_started/), release `v6.5.438`, `0a4153349dc473ba950fc17941c5ca7eda43c1de`, Apache-2.0; official `pdfjs-6.5.438-dist.zip` includes the complete viewer | Reuse `web/viewer.html` with its toolbar, search, pages and zoom, not only `pdfjs-dist` plus a newly written viewer. Self-host viewer, worker and assets; use authenticated server-resolved evidence, disable document scripting and arbitrary remote-file opening. Isolation and worker/auth integration require actual tests. |
| Code/plain-text/JSON evidence | LibreChat `components/Artifacts/ArtifactCodeEditor.tsx` in read-only mode and its existing code-block view; locked `@monaco-editor/react 4.7.0` / `monaco-editor 0.56.0`, MIT | Retain ready-made editor interaction, disable save/execute/AI-edit paths, lazy-load and self-host Monaco workers; no CDN/model-generated imports. JSON can be read-only text; no new object inspector or language editor. |
| Images and safe static reports | LibreChat `packages/chat/src/components/composer/files/ImagePreview.tsx` for images; standard isolated iframe plus the donor's DOMPurify for explicitly supported static HTML | Keep existing image/fullscreen interaction, adapted into the accepted detail route; do not invent image pan/zoom or a general document viewer. Server anchor/hash verification precedes content loading. No script-enabled artifact runtime; unsupported Office/interactive report types remain honestly unavailable/download-only instead of building editors. |
| Native-user confirmation and settings forms | Donor form fields/dialogs, existing React Hook Form/Zod and upstream form conventions | Compose actual backend fields and response cards. BioHarness business mapping is allowed; a new generic form-builder/approval engine is not. A click only confirms through the trusted native-user path; provider keys stay server-side after submission and are never persisted in browser storage. |

All new dependencies must actually serve an accepted view; the matrix is not an instruction to install every library eagerly. Reuse the chosen complete component before writing glue, and delete unused donor features only after tracing dependencies. Charts, canvas editors, Office editing, terminal emulators, arbitrary network tools, new graph databases and generic plugin SDKs are not current requirements and get no speculative component implementation.

#### Allowed adaptation and hard limits

Allowed: mapping public fields/events to donor props, explicit identity/cache keys, route wiring, narrow host-provider adapters, scientific labels, source-linked status/error text, theme tokens and straightforward composition of existing components. A plan-node label or form-field binding is domain presentation, not an excuse to replace the upstream interaction engine.

Prohibited: building a fresh shell around a few imported buttons; rewriting complex components because stripping donor features is inconvenient; treating a low-level parser/layout engine as a complete reusable product; copying an upstream backend or scientific state model; silently adding another framework/store/runtime; keeping the old custom UI as the replacement. No generic adapter SDK, component registry or scientific database is introduced.

If a selected implementation cannot satisfy a real requirement, document the concrete failing case and compare mature reusable alternatives in this section before changing selection. Do not silently hand-build a substitute. A change to a complex component's behavior needs the upstream test obligations plus BioHarness identity/provenance regressions, not screenshots alone.

#### Evidence transport boundary

The current BioHarness `evidence-preview` endpoint is a bounded text preview: binary content returns `BINARY_PREVIEW_NOT_SUPPORTED`, oversized content may be head/tail excerpts, and direct file hashing is bounded at 64 MiB. It is not a PDF byte stream or a structured table service. Keep it compatible for text; do not feed excerpts to a full-document viewer or treat them as a complete table.

- Resolve every requested content/preview read through the existing authenticated workspace and exact request/submission/evidence/SHA-256 anchor, using Governance resolution and the existing allowed-root/opened-file checks. Any PDF byte/range or download endpoint must preserve those checks, bound transfer/resource use, support the viewer's actual same-origin authentication and avoid credentials or private paths in URLs. Serve a recorded snapshot only when its content identity is verified; if live bytes drift, verification is unavailable or exceeds the current hash budget, disclose that state and do not present the bytes as the recorded version. If verified range reads cannot be bound to a consistent file version, use a verified stable copy within the existing authorized evidence policy or keep that preview unavailable. No arbitrary client file path, URL fetch, broader mount or new artifact database.
- Return structured, bounded rows for supported table formats via existing mature parsers or module-provided outputs. Include column identity, row/page or sample semantics, truncation and known counts; use unknown when full shape is not available. Preserve exact evidence identity across pagination and disclose whether sorting/filtering is local to loaded rows or server-supported across the full set. Do not infer totals from samples, expose executable spreadsheet content, or build a spreadsheet/format engine. Bound decompression and parsing of large or malformed inputs. Scientific report checks remain with Statistics.
- Self-host the selected viewer assets/workers. Disable PDF document scripting and arbitrary file-opening paths, and isolate static HTML/active-content previews so untrusted evidence cannot execute in the application origin or obtain application credentials. Validate document isolation, unauthorized range requests, drift and actual large-document behavior before enabling full viewers.

These are narrow Web transport and presentation gaps, not Core schema or module-science changes. Deliver the minimum supported viewers in R2; richer format and result-center coverage remains in R3/R4.

#### Evidence and pending acceptance

Verified in this selection round: upstream metadata and release labels; pinned source paths; root/per-package license evidence for selected new components; LibreChat's npm lock versions and host/provider seams; rc-tree controlled/keyboard behavior; React Flow official accessibility controls; AG Grid Community's virtualization/filtering/pagination and licensing distinction; PDF.js release asset and full viewer controls. Relevant official references: [React Flow accessibility](https://reactflow.dev/learn/advanced-use/accessibility), [Radix accessibility](https://www.radix-ui.com/primitives/docs/overview/accessibility), [AG Grid Community/Enterprise](https://www.ag-grid.com/react-data-grid/community-vs-enterprise), [shadcn Data Table](https://ui.shadcn.com/docs/components/radix/data-table). Some WebFetch calls failed; source/official-page retrieval through GitHub CLI and direct HTTP supplied the cited checks instead.

**Step 1 acquisition and baseline verified (2026-11-27):** the existing BioHarness-ref `06research-workspace/_INDEX.tsv` and README now include `LibreChat-v0.8.9`, `dsh-context-0.87.2`, `dagre-2.0.0` and the acquisition receipts in `ui-baseline-20261127/baseline-verification.json`. All previous references, including Dagre `29db69b`, remain intact. Complete source archives were compared with the fixed Git trees: LibreChat **8,175 blobs**, dsh-context **509**, Dagre **87**, with no missing blobs. Extracted regular files have per-file SHA-256 manifests. The existing xyflow checkout is still `9635a064f9d44cc10c460e3a0c9ca20ad0852450`; its `@xyflow/react 13.0.3` manifest and all **130** published `src/` files match the independently fetched npm package.

| Acquisition artifact | SHA-256 |
|---|---|
| LibreChat fixed source archive | `66718c33b3dfb8bd2f52cae71dae8d273b359ebc73cbcb4476c69daa29e21b0f` |
| dsh-context fixed source archive | `7d3d98775afc710299987264700ecc2457e3d2d3b7ecb13ba7e1dda064f0aea8` |
| Dagre 2.0.0 fixed source archive | `e9591386aedf3a01d0f2b6b4b85ce3cea202e1dc3bd9d07df32f4c51f43f3b2b` |
| LibreChat original npm lock, format 3 / 3,273 entries | `896a75acf791e4a70203a0bc7ee31f865fd3ade85621cf0249fa7b52f6c419da` |
| dsh-context pnpm lock, format 9 | `ee3a51caf952c54aa42bc26523f72112a0db9a31fd2e80ea9de695334264bd97` |
| Official `pdfjs-6.5.438-dist.zip` | `fcbe9ba21d9911843e3502adc178a7f549a524a4055f887bedc942e5490c6ba1` |

**Published packages and licenses:** independently fetched and checked **21** exact registry records/tarballs: the fixed tree, xyflow, Dagre and both AG Grid Community packages; dsh-context; donor React/React DOM, Router/Router DOM, React Query, Markdown/GFM/math/KaTeX/DOMPurify and both Monaco packages; PDF.js and npm 11.13.0. Every tarball matched its registry integrity and SHA-1, and contained the expected package name/version; SHA-256 and license receipts are retained. The PDF.js asset additionally matches GitHub's release digest, passes ZIP CRC checks and contains the complete generic viewer, worker and LICENSE. Conditional shadcn source remains `0e5b2e6`: Git-tree-verified license, manifest and lock are retained, with no component copied or CLI run. Normal application dependencies belong in the application lock; no transitive repository mirrors were created.

**Observed discrepancies, with pins unchanged:** LibreChat's root LICENSE is MIT, while root/client package metadata says ISC; retain original notices and disclose the discrepancy rather than treating every file/dependency as uniformly MIT. Its archive contains one absolute `prep-stream-dev-restack` symlink: the original archive and link's Git blob are retained, but the link is not materialized in the safe source extraction; no selected frontend/package reference to it was found. dsh-context's published 0.87.2 `gitHead` is `cfec4e4f9a13fc506cbf7a455a69b1d7cf52b03e`, one commit before fixed `dafccf2`; the six changed files include browser/command/event presentation. Use the fixed source for adaptation, not the npm bundle as an equivalent snapshot. remark-math/rehype-katex tarballs omit license files; their MIT texts were fetched and Git-blob verified at each published source revision. DOMPurify is `(MPL-2.0 OR Apache-2.0)`; the npm tool is Artistic-2.0. These are acquisition disclosures, not transitive security or redistribution clearance.

**Toolchain and lock verification:** LibreChat's `.nvmrc`, Dockerfile and CI select **Node 24.22.3**; its package manager is **npm 11.13.0** (`^20.17.0 || >=22.9.0`). The host's Node 22.6.0/npm 10.8.2 is unsuitable and was not upgraded. Vite 8.3.5/plugin-react 6.0.2 need `^20.19.0 || >=22.12.0`; dsh-context declares `^22.19.0 || >=24.0.0`; PDF.js declares `>=22.13.0 || >=24`. Isolated Node 24.22.3 satisfies all Linux x64-applicable entries in the donor lock. Upstream plugin/Harness engine declarations are source facts, not permission to import those runtimes. Under that Node and verified npm 11.13.0, `npm ci --dry-run --ignore-scripts --no-audit --no-fund` succeeded and planned **3,021** packages. All 11 copied manifests/lock files remained unchanged and no `node_modules` was created. Two initial registry timeouts were resolved by passing the existing proxy configuration to the isolated container without logging credentials. LibreChat workspace declarations/link targets, dsh-context pnpm importers and Dagre npm declarations match their locks; this does not establish actual installation or a UI-only build.

**Python baseline:** source was exported from `1b99677914d96dbdc2c9849a28072e911b45425b` into a repository-external Linux verification directory with a separate, version-pinned Python 3.12.14 environment. `python -m pytest --collect-only -q` collected **236** tests; `python -m pytest -ra` with a private JUnit receipt returned **236 passed in 181.79s**, zero failures/errors/skips: 181 backend, 51 public-contract and 4 root-level tests, including `tests/test_model_config.py` and `tests/test_stream_resync.py`. Public Core/Governance CLIs were actually present; synthetic fixtures and the existing adverse-path tests ran. Backend/frontend code, regression tests and production deployment were not changed. Exact environment paths and raw test receipts stay private; this paragraph is the public verification summary.

**R2 source acceptance and audit (2026-11-28).** Detailed five-stage receipts and independent hardening are preserved at Git `3091fea` (§17.5 in this file at that revision).

| Commit | Verified scope |
|---|---|
| `b57aaca` | Acquisition and independent donor UI |
| `4f6ae84` / `a053821` | Native vertical slice, security/recovery, SSE ownership, model attribution, native Composer |
| `fd4c329` / `23d3292` | Scientific views, verified bytes, complete CSV records, route pagination, version/request identity and non-blocking disclosures |
| `a59101d` | Behavioral parity, live task-type/A1/restart acceptance and retirement of old UI |
| `3091fea` | Independent audit: stale same-digest recovery/reconnect, manual refresh, Request/Scope evidence, verified HTML, explicit multi-project choice and collapsed execution details |

| Acceptance | Recorded outcome |
|---|---|
| Python | 249/249, zero failed/skipped |
| Frontend | TypeScript and production build passed; complete retained Jest 789 suites, 12,192 passed, 3 skipped at `a59101d`; final affected 10 suites / 43 tests passed at `3091fea` |
| Chromium | Read/security 33/33; native loop 28/28; scientific views 27/27; final Step 5 30/30 |
| Real project reads | 10/10 real Core/Governance CLI multi-project and isolated multi-branch replay; recorded file manifests unchanged. Read-only replay is not independent biological validation. |
| Live model | Real Core EXPLAIN, EVALUATE, ANALYZE, native A1 confirmation and actual service restart recovery; missing advisor non-blocking. Final audit did not repeat external model calls. |
| Source provenance | 32/32 changed upstream files marked; LibreChat and PDF.js licenses retained |

**Remaining limits:** single trusted operator on a private network (shared token without expiry/rate limit, Secure cookie requires HTTPS); bounded evidence re-hashing and no unverified full-document rendering; execution observations remain Request-level without trusted host step/plan-version identity. Actual domain-module scientific acceptance, genuine concurrent hosts, real external executor recovery, broader artifacts/context and independent Eval remain R3/R4. Host notices in model history use marked user-role messages; the ledger has no pruning; Core timeout must exceed configured advisor timeout. Interactive screen-reader checks beyond Chromium ARIA/keyboard have not been run.

**Distribution findings:** audit at `3091fea` reports 0 critical/high, 1 moderate (i18next, GHSA-6jcc-5g8w-32mx, major upgrade required by suggested fix) and 6 low (including elliptic transitive chain). Preserve upstream LibreChat MIT/ISC metadata disclosure and PDF.js Apache-2.0, DOMPurify dual Apache-2.0/MPL-2.0, lightningcss and certifi MPL-2.0 notices. `heic-to@1.1.14` (LGPL-3.0) emits an unused HEIC lazy bundle; `@codesandbox/nodebox@0.1.8` (Sustainable Use License 1.0) is installed via unused Sandpack but not found in built JS. DiceBear free design license and W3C intersection-observer license also noted. Review or remove unnecessary dependencies before public redistribution; no blanket clearance or deployment approval. Fixed versions remain unchanged.

Old `frontend/` and superseded browser scripts are absent from the source tree; Git retains their history. Keep private deployment and rollback releases independent of Git worktrees.

## 18. Change control

This is the single active BioHarness-Web roadmap (covering V2 delivery through V3 product-architecture upgrade R1–R4). Update this file in place as decisions are verified. Keep stable product rules in AGENTS.md and the architecture contract in docs/architecture.md. Do not add parallel TODO files, repeated plans or run-log documents.