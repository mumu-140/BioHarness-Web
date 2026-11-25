# BioHarness Research Workspace — Architecture

**Status: target architecture baseline, 2026-11-25.** This document defines the intended V2 product. It does not claim that the runtime has been implemented.

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

Web owns researcher-facing interaction, direct provider API calls and streaming, the request-scoped model/tool execution loop, adapters to Core and configured Module tools, observed operational events, visual projections and UI preferences.

Web does not own scientific truth, a parallel research plan, a second Memory, a second project tree or a separate scientific verdict engine.

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

The model may propose scientific reasoning and tool use. Core controls the persisted scientific plan and progression. Mainline changes retain Core's existing native-user-confirmation semantics; a model or tool cannot confirm a change on the user's behalf.

Core advisor feedback is advice, not a blocking gate. A missing or failed advisor is shown as unreviewed, not converted into a new approval state.

## 4. Core and Module integration

### Core Host adapter

The adapter invokes only supported public Core calls, passes the original user question verbatim to intake, retains and explicitly passes request_id for every continuation, parses the structured Core response and follows its instruction/action/call, recovers through science_now after restart or interrupted execution, and preserves must_not_stop, wait-for-user and partial-delivery semantics.

The initial implementation compares the supported CLI and stdio MCP transports under the installed Core version. The selected transport and exact invocation are recorded in the W0 decision. No new Core REST API is assumed.

### Module tool adapters

The runtime may expose configured tools through MCP or documented CLI/API adapters. The tool list sent to a model is an ephemeral view of the configured runtime, not a second scientific Capability Registry.

A resource declaration does not install a tool, grant filesystem access or prove that the tool works. Host configuration identifies the actual adapter, command/server and workspace. Module-specific instructions and schemas remain with the module.

First integration candidates:

- Project Governance: project tree, context, routes and evidence.
- Memory: FAST/STANDARD/DEEP retrieval, T1/T2/T3 expansion, TaskMemoryGraph and explicit use feedback.
- Literature: paper and method search with source-backed results.
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

### 5.2 Scientific Workflow

The workflow view answers: **How is this specific scientific question being addressed now?**

Generate it from the selected Core request and current plan: objective and requirements, plan steps and serves links, dependencies and optional exploration steps, declared method/parameters/deliverables/checks, recorded submissions and unresolved steps, plan revisions and invalidated downstream reuse.

The graph is dynamic. It must not impose a fixed biological workflow template. It shows the scientific plan and recorded progress, not every low-level event. Step state is projected from Core records; Web must not maintain a competing status machine.

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
| Memory | T1 themes, T2 memories, T3 sources, retrieval depth, relation path, applicability gaps, conflicts and explicit use feedback |
| Literature | query, source/database, search time, paper, passage, DOI/URL, method and limitations |
| Scientific Review | intake guidance, plan/work/delivery review, concerns, unreviewed status and response |
| Statistics | experimental unit, data grain, grouping variables, combinations, numerator/denominator, background, test/model, effect size and multiple-testing correction |
| Analysis / Workflow | inputs, software/version, parameters, actual invocation, outputs, logs, failure and recovery |
| Model Runtime | provider/model, request timing, token/cost metadata when available, tool calls and transport errors |

The UI renders what the module actually returns. It does not recreate module algorithms in TypeScript.

## 8. Direct model API runtime

The first runtime is a small request-scoped loop in the Python backend, not a general-purpose Agent framework.

It provides direct provider API clients, backend-only credentials, provider/model selection from trusted configuration, streaming responses, structured tool-call handling, configured MCP/CLI adapters, interruption and recovery, bounded context construction and operational trace events.

Provider adapters remain thin. Prefer official provider SDKs or documented OpenAI-compatible endpoints. Do not require a hosted gateway, proprietary Agent product or external Agent process. W0 chooses the first provider set based on actual APIs and available credentials.

Do not pass all historical conversations or entire datasets to a model by default. Supply the original question, current Core instruction, relevant scope/context, current step, available resource instructions and evidence needed for that step. Memory retrieval depth and source expansion follow the Memory module's own interface.

## 9. Persistence and event model

There is one authority for each kind of data:

- Core request/plan/submission/delivery: Core workspace records.
- Project tree and route projections: Project Governance over Core records.
- Memory content, relations and usage feedback: Memory module store.
- Literature and scientific source material: the source/module that provides it, with references returned to Core.
- Scientific files and results: configured project/HPC/data locations.
- UI preferences: Web user/workspace settings.
- Model/tool operational trace: Web runtime telemetry, explicitly non-authoritative for scientific task state.

The Web telemetry store may be append-only files or an existing observability backend. W0 chooses the smallest adequate implementation. Do not introduce a second task database or graph database by default.

A visual graph is a projection, not a new source of truth. Every node/edge carries a source reference or an explicit unknown/candidate status.

## 10. Realtime and interruption

Use HTTP request/response for user actions and SSE for server-to-browser model/tool progress unless a measured requirement justifies WebSocket.

The UI distinguishes model streaming, tool running, Core waiting for a user, Core open with a next action, tool/model failure, disconnected/stale UI, completed delivery and partial delivery.

Stopping a browser stream is not equivalent to cancelling a remote scientific process. The runtime reports whether a model call, local process or remote tool was actually interrupted. Core recovery remains through science_now.

## 11. Technology direction

| Layer | Initial candidate | Decision status |
|---|---|---|
| Frontend | React + TypeScript + Vite | Reuse current stack unless source review shows a concrete problem |
| Scientific graph | React Flow (@xyflow/react) | Existing dependency; first candidate |
| Tree/graph layout | Dagre for simple directed trees; ELK only for demonstrated complex layouts | Evaluate in W1 |
| UI components | Lightweight accessible component system such as shadcn/ui | Evaluate after wireframe |
| Backend | Python 3.12+ + FastAPI | Existing candidate |
| Model API | Official provider SDKs / OpenAI-compatible API adapters | Direct API only |
| Module tools | MCP and documented CLI/API adapters | Reuse public interfaces |
| Streaming | SSE | First candidate |
| Desktop | Tauri | Deferred until Web acceptance |
| Persistence | Existing Core/Module stores plus minimal Web telemetry | No new scientific DB by default |

The stack is a direction, not a reason to preserve unsuitable V1 code.

## 12. Desktop strategy

Desktop is a later packaging target, not a second product implementation. Tauri may wrap the same React frontend and connect to the same Web backend or an explicitly configured local sidecar. Desktop must not fork the scientific workflow, Core adapter, Module adapters or model runtime.

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