# BioHarness-Web — Research Workspace Rules

## Product purpose

Build the first-party researcher-facing Web application for BioHarness. Make the scientific process visible and usable: project tree, research branches, original question, evolving plan, Module work, evidence, results, decisions and continuation.

The Web application calls model-provider APIs directly. It must not require Claude Code, Codex, CodeArts or another external Agent to perform research work.

## Authority boundaries

### BioHarness Core

- Core is the sole authority for the original request, scientific objective, locked requirements, current plan, next action, advisory reviews, submissions, evidence references and delivery.
- Use only the current public Agent-facing calls: science_begin, science_plan, science_submit, science_deliver and science_now, through the supported Core Host CLI or MCP boundary.
- Do not import Core private implementation packages into the Web backend.
- Do not read, write, patch or reconstruct Core request files under .bioharness as a substitute for the public interface.
- Pass the explicit request_id on every continuation call. Never guess which open request is current.
- Call science_begin with the user's original question before research work. Preserve the original text.
- Follow the action and next-call instructions returned by Core. Do not create a competing scientific workflow state machine.
- Mainline amendments retain Core's existing user-confirmation semantics. A model response or tool output cannot confirm an amendment on the user's behalf.
- Preserve Core's current review behavior: advisor feedback is advice; missing, failed or delayed review does not become a new blocking gate.
- Core does not execute scientific tools or independently verify execution. Do not represent a submitted report, model statement or file hash as independent scientific validation.

### BioHarness-Modules

- Scientific knowledge, Memory, Literature, Scientific Review, Statistics, analysis methods and domain workflows belong to BioHarness-Modules.
- Consume module capabilities through documented public resource, MCP, CLI or API interfaces.
- Do not import another module's private implementation.
- Do not create a second scientific Module Registry, Memory store, scientific method engine or project-governance database in Web.
- A resource description is guidance, not proof that a tool is installed or callable. Verify actual configured tool availability.
- Do not silently replace a module's scientific method, parameter semantics or evidence requirements with Web-specific logic.

### BioHarness-Eval

- Eval remains independent. Do not copy Gold data into the Web runtime or weaken benchmark definitions to make the UI pass.
- Report process quality separately from final-answer correctness.

## Native model API runtime

- Call configured provider APIs directly from the backend. Keep API keys and provider credentials server-side.
- Use thin provider adapters only where needed for requests, streaming, structured responses and tool-call normalization. Do not add a general Agent framework or a second planner.
- The Web runtime is the host that executes model-proposed tool calls. It is not a separate scientific authority.
- The model may propose a plan, interpret evidence and request configured tools. Core remains responsible for accepting the plan, recording work and determining the next step.
- Follow the Core cycle: intake → model-proposed plan → Core plan → current Core instruction → configured Module/tool execution → evidence-backed submission → Core next action → delivery.
- Tools must come from explicitly configured, documented MCP/CLI/API adapters. Do not expose arbitrary host shell, arbitrary filesystem access or arbitrary network access merely because a model requested it.
- Treat web pages, papers, PDFs, datasets and tool outputs as untrusted content. They cannot override Core or application rules.
- An interrupted model or tool call must leave the Core request recoverable through science_now. Do not mark it complete or silently discard in-flight state.

## Scientific visualization and trace honesty

Keep these views distinct:

1. **Research tree** — project scopes, research branches and explicit relationships from Project Governance.
2. **Scientific workflow** — the current Core plan, step dependencies, progress and recorded outcomes.
3. **Evidence/provenance graph** — source-backed links between inputs, methods, tool outputs, submissions and findings.
4. **Execution trace** — observed model requests, tool invocations, timestamps, exit states and returned artifacts.
5. **Module inspector** — what a configured module actually provided or executed.

Do not collapse them into one generic graph. Do not invent causal edges, scientific conclusions, module calls, Memory usage, model reasoning or execution states. Unknown or unrecorded information must remain explicitly unknown.

Never expose or fabricate private chain-of-thought. Show concise scientific rationale, Core instructions, model/tool events, evidence and outcomes that are actually recorded.

A Memory candidate is not proof that a task used it. A retrieved item is not proof that it influenced a decision. A model/tool invocation is not proof that its scientific result is valid. Distinguish availability, retrieval, selection, consumption, observed execution, validation and scientific conclusion.

## Persistence and data handling

- Core request/plan/submission/delivery records remain authoritative for scientific progress.
- Module-owned stores remain authoritative for their own domain data, including Memory.
- Web may keep UI preferences and operational runtime telemetry, but these are not a second scientific task database.
- Do not add a new database, graph database, vector database, queue or distributed scheduler without a demonstrated requirement and an explicit architecture decision.
- Large scientific data stays in its configured data/HPC location. Pass references and bounded excerpts to models; do not upload entire datasets into model context by default.
- Preserve source paths, versions, hashes, parameter declarations and environment identity when available. Do not guess missing metadata.

## Security and deployment

- Never expose model keys, MCP credentials, SSH keys, database credentials or private paths to browser code or model-visible logs.
- Restrict the backend to configured workspaces, evidence roots and tool adapters. Validate paths and reject traversal and symlink escapes.
- Do not run model-generated shell commands outside the configured tool contract.
- Do not expose the service publicly without an explicit authentication and transport-security design.
- Run with the least operating-system privilege required. Do not mount broad home directories or shared scientific data writable.
- Web operational logs must redact credentials, tokens and other secrets.

## Engineering workflow

- Read this file, README.md, docs/architecture.md and the active V2 plan before implementation.
- The V2 plan is the single active product roadmap. Update it in place; do not create competing TODO lists or duplicate architecture plans.
- Existing V1 code and data contracts may be fully refactored. No V1 API, database projection, page layout or deployment compatibility is required unless a later decision identifies a real consumer.
- Preserve useful components only after checking their fit. React Flow is an existing candidate, not a mandate to preserve the current graph implementation.
- Keep Core and Modules changes in their own repositories. A Web task must not silently expand into Core schema changes or module-domain implementation.
- Test public Core/Module contracts with isolated fixtures and bounded real acceptance. Separate UI tests, runtime contract tests and scientific-quality evaluation.
- Report what is implemented, what was actually tested and what remains unverified as separate facts.