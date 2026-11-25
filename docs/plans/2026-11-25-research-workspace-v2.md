# BioHarness Research Workspace V2 — Product Plan

**Date:** 2026-11-25  
**Status:** Planning baseline / W0  
**Implementation status:** Not started  
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
| Later platform | Desktop wrapper using Tauri after Web acceptance |
| Model calls | Direct provider API from Web backend |
| External Agents | Not required; no CC/Codex/CodeArts runtime dependency |
| Core | Existing five science_* calls remain the only scientific mainline |
| Modules | External domain capabilities invoked through documented public interfaces |
| Project tree | Reuse Project Governance; do not create a second project hierarchy |
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

The current implementation is a read-only observer over the former managed-record/PostgreSQL model. It does not yet call the current Core science_* mainline, run direct model APIs or execute configured Modules as a first-party host.

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

Every follow-up call uses the explicit request_id. The Web runtime must not read/write Core state files directly, import Core private implementation or maintain a competing task state machine.

### 5.2 Modules

First candidate integrations:

1. Project Governance — tree, context, routes and evidence.
2. Memory — FAST/STANDARD/DEEP, T1/T2/T3, TaskMemoryGraph and explicit usage feedback.
3. Literature — literature and method discovery with source references.
4. Scientific Review — existing Core advisor bridge; preserve advice semantics.
5. Statistics — scientific statistical design and interpretation.
6. Domain workflows — selected real capabilities such as DAP-seq, Genome-web TF or RNA-seq after current public contracts are verified.

MCP and documented CLI/API interfaces are preferred. A module README and resource instructions are not proof that its runtime tool is installed. The Web host must verify actual availability.

### 5.3 Research Workspace module boundary

The existing bioharness-module-research-workspace package is PLANNED. It must not become a second Web application or duplicate Project Governance. Its future role is limited to reusable workspace-specific integration or presentation contracts that cannot be provided by the existing Governance module. W1 must demonstrate a real gap before this package proceeds to implementation.

## 6. Product views and required behavior

### 6.1 Research Tree

Show long-running projects, scopes, nested research branches, original goals, locked mainlines, request references, explicit related edges and goal-version differences.

Use Project Governance's public tree/context/routes/evidence operations. Preserve its rules:

- unscoped requests remain unscoped;
- scope selection does not itself bind a request;
- the active request must be explicit;
- multiple open requests must not be guessed;
- historical requests and reused evidence do not automatically prove current scientific validity;
- related links are not automatic execution prerequisites.

### 6.2 Scientific Workflow

Render the selected Core plan as a dynamic graph. Show objective, requirements, steps, serves, depends_on, why, method, parameters, deliverables, checks, recorded work and unresolved steps.

The graph changes when Core returns a revised plan. Preserve historical plan versions and indicate which previous results remain reusable or require renewed work according to Core records. Do not use a fixed pipeline template.

### 6.3 Evidence and Provenance

Provide source-linked navigation from a result to its input, data version, method, software, parameters, actual tool output, submission and validation.

Only explicit or otherwise source-backed relationships may be shown as established edges. Model-generated relationships remain candidates until supported. Distinguish evidence availability, source verification, execution observation, scientific review and scientific conclusion.

### 6.4 Module and execution views

Each module gets a suitable inspector. Show actual invocation, source, version, arguments after redaction, result, output references, errors and timing when observed.

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

The UI may stop a model stream or interrupt a local tool process, but it must not claim a remote scientific job was cancelled unless the underlying tool confirms it. Interrupted tasks remain recoverable through Core.

## 8. Visual layout

Initial desktop Web layout: left project/research tree; center selected tree/workflow/evidence graph; right selected-node inspector; bottom or collapsible side panel for AI conversation; activity panel for model and Module execution trace; top context for workspace, scope, request, model and connection state.

Support panel collapse, graph zoom/pan, search, filtering, node selection, branch expansion and detail drill-down. Responsive mobile layout is useful later; first acceptance is desktop browser use.

## 9. Technology choices

| Area | Initial candidate | TODO |
|---|---|---|
| Frontend | React + TypeScript + Vite | Audit current components; retain/adapt/refactor |
| Graph | React Flow | Confirm node/edge model for four distinct views |
| Layout | Dagre first; ELK if needed | Pilot on a representative branched research graph |
| UI components | Accessible lightweight component system | Select after wireframe; avoid broad dependency migration |
| Backend | Python + FastAPI | Audit process management, streaming and configuration |
| Model API | Official SDKs / OpenAI-compatible APIs | Select first providers and normalized event schema |
| Module tools | MCP / documented CLI/API | Verify actual module interfaces |
| Streaming | SSE | Verify chat/tool progress and reconnect |
| Desktop | Tauri | Deferred until Web acceptance |
| Persistence | Core/Modules stores plus minimal Web telemetry | Choose telemetry storage; no new scientific DB by default |

## 10. Development milestones and TODO

### W0 — Contract and source audit

**Goal:** freeze the integration design before changing runtime code.

- [x] Inspect BioHarness-Web repository tree, README, AGENTS, architecture, deployment, frontend package and current UI entry points.
- [x] Confirm the existing Web application is a read-only PostgreSQL Observatory and does not implement the current Core science_* mainline.
- [x] Read current Core README, AGENTS, Core overview, Host tool definitions and Module integration contract.
- [x] Read current Project Governance and Research Workspace module README.
- [x] Read current Memory and Scientific Review module entry points.
- [x] Identify React Flow, FastAPI and Vite as existing reuse candidates.
- [x] Establish that old V1 APIs, page layout and database projection are not compatibility constraints.
- [ ] Verify exact Core and Modules commits intended for first implementation and installed CLI/MCP commands on authorized Linux.
- [ ] Inspect Project Governance CLI/MCP outputs against representative real scopes, including unscoped and multiple-open-request cases.
- [ ] Verify actual MCP/CLI availability and invocation contracts for first Memory, Literature, Scientific Review and Statistics integrations.
- [ ] Compare official provider SDKs and OpenAI-compatible endpoints for the first direct API provider set.
- [ ] Review source quality, maintenance and license terms before copying code from external references.
- [ ] Produce the first real desktop-browser wireframe using an existing research project, not a fabricated generic pipeline.
- [ ] Record W0 implementation decisions in this plan.

**Exit:** public contracts and first pilot scope are known; no new Core interface or duplicate Module capability is required.

### W1 — Research Tree and scientific workflow canvas

**Goal:** the Web application displays real Core/Project Governance state.

- [ ] Replace the V1 PostgreSQL task projection with adapters for current Core and Project Governance public interfaces.
- [ ] Add explicit workspace/project/scope/request selection.
- [ ] Render the Project Governance research tree and scope context.
- [ ] Preserve unscoped requests and explicit request identity.
- [ ] Render the selected Core plan as a dynamic workflow graph.
- [ ] Show requirements, step dependencies, current instruction, progress and unresolved work.
- [ ] Add node inspector for objective, method, parameters, check, result and source references.
- [ ] Preserve plan revisions and historical task references.
- [ ] Add loading, empty, stale, disconnected and unreadable-record states.

**Acceptance:** a real project appears with the same scope ancestry and explicit related links as Project Governance; unscoped requests are not silently assigned; multiple open requests require explicit selection; workflow graph matches science_now and the selected Core plan; node details resolve to the correct Core request/step and source references; no direct SQL or private Core imports are used.

### W2 — Direct model API and first-party runtime

**Goal:** conduct a real Core-governed research task without an external Agent.

- [ ] Implement backend-only model provider configuration and credential handling.
- [ ] Implement streaming chat and structured tool-call handling.
- [ ] Implement the Core Host adapter through the verified public CLI or stdio MCP interface.
- [ ] Implement request-scoped context assembly from original question, Core instruction, selected scope, relevant Module resources and evidence.
- [ ] Implement configured MCP/CLI tool adapters.
- [ ] Implement the Core intake → plan → step → submit → next action → delivery loop.
- [ ] Preserve explicit request_id and recover after browser/server restart using science_now.
- [ ] Preserve Core user-confirmation semantics for mainline amendments.
- [ ] Preserve advisor advice/unreviewed behavior without adding a new gate.
- [ ] Record actual model/tool events with secret redaction.
- [ ] Handle model timeout, tool failure, partial output, user wait and interrupted execution.

**Acceptance:** EXPLAIN, EVALUATE and ANALYZE tasks complete using direct provider APIs; no external Agent process is required; Core determines the persisted plan and next action; the same request resumes after restart with explicit request_id; tool results and file evidence are submitted through Core; UI distinguishes model/tool observation from scientific validation.

### W3 — Module integration and inspectors

**Goal:** show the actual work of Core and each configured scientific Module.

- [ ] Project Governance inspector: tree, context, routes and evidence.
- [ ] Memory inspector: T1/T2/T3, retrieval mode, TaskMemoryGraph, relation paths, condition gaps, conflicts and explicit use feedback.
- [ ] Literature inspector: query, sources, papers, passages, methods and citations.
- [ ] Scientific Review inspector: intake/plan/work/delivery advice, concerns and unreviewed status.
- [ ] Statistics inspector: unit, grain, grouping dimensions, combinations, numerator/denominator, background, methods, effect sizes and correction.
- [ ] Analysis/workflow inspector: inputs, versions, parameters, tool calls, outputs, errors and recovery.
- [ ] Add real invocation timeline with request, module, tool, time, status and evidence references.
- [ ] Add explicit unavailable-module state; do not render a planned module as installed.

**Acceptance:** each inspector uses actual module output or observed runtime events; no module algorithm is duplicated; Memory candidate/retrieved/consumed/outcome are distinct; Literature claims link to source passages; Statistics exposes denominator/background and analysis unit when supplied.

### W4 — Evidence, results and research comparison

**Goal:** make scientific conclusions inspectable and support long-running iterative research.

- [ ] Add evidence/provenance graph with source-backed typed edges.
- [ ] Add artifact/file preview using allowlisted evidence references.
- [ ] Add tables, plots and figure previews for supported result types.
- [ ] Add method/parameter/input-version comparison across prior routes.
- [ ] Show contradictory findings and negative results without erasing historical attempts.
- [ ] Show which downstream steps were affected by a plan/input/method revision, based on recorded dependencies.
- [ ] Add research-wide search over scopes, requests, methods, sources and outputs.
- [ ] Evaluate Memory ON/OFF benefit using independent tasks from BioHarness-Eval.

**Acceptance:** a displayed result traces to its input, method, parameters, invocation and evidence; historical and contradictory results remain inspectable; task completion or invocation count is never treated as scientific validity; process-level and outcome evaluation are separate.

### W5 — Desktop packaging

**Goal:** deliver a desktop shell without creating a second application.

- [ ] Evaluate Tauri packaging after Web workflows and deployment are stable.
- [ ] Reuse the same React application and backend contracts.
- [ ] Decide remote-backend, local-sidecar or hybrid operation based on actual multi-device use.
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
- [ ] The Web application can be stopped without changing Core or Module state.
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

The deployment target is not fixed by this plan.

The backend must run where it can access the selected Core workspace and configured Modules/HPC tools, and where outbound access to selected model APIs is available. The browser never receives model or tool credentials.

For the first deployment, prefer a private lab network, loopback binding behind an SSH tunnel or an authenticated HTTPS reverse proxy. Do not expose a public service until authentication, transport security and workspace isolation are explicitly designed.

See [deployment principles](../deployment.md). No production service or host is modified by this planning task.

## 14. Open decisions

- Which Core Host transport is most reliable for the first Web backend: CLI subprocess or stdio MCP?
- Which direct model providers and models are needed for the first pilot?
- Which configured Modules are already callable in the intended workspace?
- What is the canonical workspace mapping for multiple research projects and multiple machines?
- Where should Web operational telemetry live without becoming a second scientific state store?
- Which artifact types need native viewers in the first analysis pilot?
- Should the first Web deployment run on fwq10, fwq57 or another authorized host?
- Does the research-workspace package provide a real reusable integration gap beyond Project Governance?

Resolve these decisions using W0 evidence, not speculative infrastructure.

## 15. Out of scope until justified

New Core endpoints or Core schema changes; a new scientific task database; a second project/scope tree; a second Memory or graph database; a generic Agent framework or recursive multi-agent scheduler; a new HPC scheduler; full low-code workflow editing; public multi-tenant SaaS; collaborative editing; full JupyterLab/Galaxy replacement; Desktop-first implementation.

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