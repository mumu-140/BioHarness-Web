# Deployment Principles

**Status:** a private Linux deployment exists. R2 is accepted in repository source; the adopted frontend has not replaced the running release. The private release manifest, configuration and receipts identify the actual installed version.

## 1. Deployment shape

BioHarness-Web is a remote-service-first application. A Linux backend is the default; browsers and later Desktop clients connect to its authenticated application API and SSE:

- browser: UI only; no provider credentials or direct access to scientific workspaces;
- Web backend: direct model API calls, Core Host adapter, configured Module tools and visual projections;
- Core workspace: authoritative request and scientific progress records;
- Modules and data/HPC: domain-specific capability and scientific data stores.

The backend runs where it can access the selected Core workspace and configured Module tools. It also needs outbound connectivity to selected model provider APIs unless a separately configured local model endpoint is used.

## 2. Workspace access

- Bind each Web workspace to an explicit service identity and canonical research workspace. Treat requests and evidence references as workspace-scoped, resolve them on the server, and never interpret a client-local path as a remote path. Different worktrees/machines do not implicitly share Core state.
- Use Core's public Host interface for scientific request state.
- Use Project Governance's public CLI/MCP for project tree and route queries.
- Do not mount or expose a broad home directory.
- Configure narrow evidence roots and module work directories.
- Keep large scientific datasets in existing storage/HPC locations.
- Do not allow browser-supplied arbitrary paths to reach the backend filesystem.

A remote compute adapter may use an explicitly configured host/CLI/MCP tool. Web must not become an independent scheduler or copy large datasets between machines by default.

## 3. Credentials

- Model API keys, MCP credentials, SSH keys and other secrets stay on the backend.
- Supply secrets through the deployment environment or an approved secret manager.
- Never commit secrets or include them in model prompts, browser responses or operational traces.
- Redact sensitive command arguments and environment variables before recording tool events.

## 4. Network exposure

Initial deployment is limited to a trusted private network.

Preferred access patterns:

1. loopback-bound service accessed through an SSH tunnel; or
2. authenticated HTTPS reverse proxy on an approved private domain.

Do not expose the application publicly until authentication, TLS, session isolation, workspace isolation and audit behavior have been reviewed.

SSE connections must support reconnect, snapshot resync and stale/disconnected state without changing Core task state. Long model/tool operations are not tied to browser connection lifetime. Reconcile executor job identity and observed outcome after service restart; do not assume cancellation or silently rerun a job.

## 5. Process and filesystem isolation

- Run the backend as a non-root service account.
- Use the narrowest required workspace and tool mounts.
- Mount source datasets read-only unless a documented workflow requires a separate writable output directory.
- Keep generated outputs in explicit project output locations.
- Do not grant arbitrary shell execution to model-generated text.
- Web stop/restart must not itself rewrite Core or Module scientific records. Verify what happens to in-flight local/remote operations and recover or report unknown outcomes explicitly.

## 6. Desktop

The first Desktop topology is a thin Tauri client connected to the same remote service, with authenticated API/SSE and explicit workspace identity. Packaging is deferred to R4; local sidecar or hybrid operation is optional only if a real need is demonstrated.

## 7. Deployment acceptance

Release approval and remaining acceptance belong to the [sole roadmap](plans/2026-11-25-research-workspace-v2.md). Verify the exact candidate build, installed public CLIs, access isolation, evidence roots, private-network access, restart and rollback behavior. Inspect active runs before switching and retain the prior verified release. Source acceptance is not production cutover or scientific-quality validation.

This public source repository must not contain private scientific data, private infrastructure details, credentials or non-public receipts. Keep actual environment configuration and raw audit material in authorized private research/CI locations.

## 8. Service configuration (read side and optional native runtime)

The service needs Python 3.12+, the built frontend and the public `bioharness-host` and `bioharness-governance` commands installed for the same user. With the native runtime disabled, it reads the configured workspaces and writes no scientific records. With the native runtime enabled, scientific mutations occur only through Core's public commands and explicitly configured Module tools, as described below. Core state must be in the canonical place, `<workspace>/.bioharness`; a workspace where that directory or one of its `requests`, `evidence`, `sessions` subdirectories is missing is reported as having no Core state and Core is not called for it, because the Core CLI would create them. A workspace may not be `/` or the service user's home directory.

| Variable | Meaning |
|---|---|
| `BIOHARNESS_WEB_WORKSPACES` | Required. JSON object mapping a workspace id to a server directory, or to `{"path": ..., "evidence_roots": [...]}` when evidence files live outside the workspace. |
| `BIOHARNESS_WEB_ACCESS_TOKEN` | Required, at least 16 characters. Every data route needs it. |
| `BIOHARNESS_WEB_HOST`, `BIOHARNESS_WEB_PORT` | Default `127.0.0.1:8080`. Keep loopback and reach it through an SSH tunnel or an authenticated HTTPS reverse proxy. |
| `BIOHARNESS_WEB_STATIC_DIR` | Directory of the built adopted frontend (`ui/client/dist`). |
| `BIOHARNESS_WEB_CORE_CLI`, `BIOHARNESS_WEB_GOVERNANCE_CLI` | Commands to run; default to the names on PATH. |
| `BIOHARNESS_WEB_POLL_INTERVAL_SECONDS` | Default 5, minimum 1. |
| `BIOHARNESS_WEB_SERVICE_ID`, `BIOHARNESS_WEB_EVIDENCE_PREVIEW_MAX_BYTES` | Optional. |

The native runtime is off unless all of the following are set; the read side is unaffected.

| Variable | Meaning |
|---|---|
| `BIOHARNESS_WEB_MODEL_BASE_URL`, `BIOHARNESS_WEB_MODEL_API_KEY`, `BIOHARNESS_WEB_MODEL_NAME` | An OpenAI-compatible chat-completions endpoint called directly by the backend. The model needs tool calling, streaming and a context of roughly 350 000 characters. |
| `BIOHARNESS_WEB_LEDGER` | Absolute path of the technical SQLite ledger, in a directory only the service user can read. It holds conversation text and observed tool traffic; keep it out of the repository and out of the workspace. |
| `BIOHARNESS_WEB_MCP_SERVERS` | Optional. JSON object `{"name": ["command", "arg", ...]}` of stdio MCP servers whose tools the model may call; `{workspace}` in an argument is replaced by the workspace directory. |
| `BIOHARNESS_WEB_CORE_CALL_TIMEOUT_SECONDS` | Default 3900. Must exceed the advisor timeout configured in the workspace (Core allows up to 3600 s); when it passes, the call's outcome is recorded as unknown. |
| `BIOHARNESS_WEB_TOOL_ENV` | Optional. Comma-separated names of environment variables that Core and the MCP servers receive (for example a proxy an advisor needs). Nothing else of the service environment reaches them. |

With the runtime on, the service keeps the technical ledger and server-side model settings outside scientific records. Saved provider settings are stored in `model_config.json` alongside the ledger (mode 0600); keep both in the private writable state directory. The service changes the workspace only through Core's public commands, exactly as an Agent host does. A configured MCP tool writes whatever that module writes: configure only modules whose behaviour in the workspace you accept. Stopping the service interrupts runs in progress; their requests stay recoverable in Core.

Start it with `python -m bioharness_web`. Configured directories are replaced by `$WORKSPACE` and `$EVIDENCE_ROOT_n` in responses. A recorded evidence file outside them is shown by file name only (`$OUTSIDE_CONFIGURED_ROOTS/name`) and cannot be previewed. Free text written by a model or a tool (summaries, instructions) and the content of a previewed evidence file are shown as recorded and are not scanned for paths. Core state of any workspace is never previewed, even when it lies under a configured evidence root. The single shared token is adequate for one trusted operator on a private network, not for multiple users: it does not expire, sign-in attempts are not rate limited, and the session cookie is marked Secure only when the service itself sees HTTPS (run it behind the proxy with forwarded-scheme support, or keep it on loopback). The Core and Governance commands are started with a reduced environment and never receive the token. The V1 container files were removed with the PostgreSQL service. The private managed deployment below uses a pinned base image and read-only installed-release mounts; it is not a published portable application image.

The authorized private deployment described below supersedes this document's former planning-only/no-deployment status; it does not authorize public exposure or imply scientific acceptance.

## 9. Managed private deployment and operations

Web remains an independent component: its installed wheel, isolated Python environment and built frontend live in an immutable release directory outside Git worktrees. The deployment pins the existing Core and Governance public CLI releases separately. It neither installs Web into Core's environment nor imports Core private implementation.

The private Compose service runs as the owning non-root user, with a read-only root filesystem and release/runtime mounts, only the explicitly configured scientific workspaces and Web ledger writable, no Docker socket and no broad home mount. Its application listens on host loopback; access is through an authorized SSH tunnel. The model endpoint is called server-side. No provider key is sent to the browser or Core/Module subprocess environment.

- `settings.env`: explicit service/workspace ids, pinned CLI paths, model route/name, frontend and ledger locations.
- `secrets.env`: the existing service access token mechanism and provider key, readable only by the owner (mode 0600), never committed or copied into logs/chat.
- `compose.yaml`: pinned base image, installed runtime/release mounts, health check, bounded container logs and restart policy.
- Release manifest: exact Web/Core/Governance identities, runtime/build versions and frontend hashes. Keep the wheel and the prior release needed for rollback.

These are operator-owned deployment files, not a second project configuration/permission system. No authentication feature or scientific gate is added. The configured workspaces remain explicit browser choices; selection is never guessed.

Run operations against the **Web** descriptor, not a legacy Core HTTP or V1 PostgreSQL descriptor:

```bash
docker compose -f "/private/deployment/compose.yaml" up -d --no-build --pull never
docker compose -f "/private/deployment/compose.yaml" ps
docker compose -f "/private/deployment/compose.yaml" restart web
docker compose -f "/private/deployment/compose.yaml" stop web
```

Stop/restart affects Web only. Before changing a release, inspect active runs; interruption is not scientific cancellation and unknown operations must be reconciled, not replayed. To roll back, stop Web and select a previously verified Web release in the descriptor/settings, then start it and re-read Core. If no compatible verified release is available, stop Web while leaving the installed Core, Modules and their records unchanged. Do not automatically restore a Core-state backup over newer scientific work.

Deployment smoke checks use public reads and do not create synthetic questions in formal scientific workspaces. The separate isolated test workspace remains the place for mutating synthetic acceptance. Historical delivered **unscoped** requests have no public enumeration API: an empty open/tree list does not mean those records were deleted; open them by an explicitly supplied request_id.

Historical private deployment and restart smoke checks are preserved in the prior roadmap and private receipts. The adopted frontend has passed source/isolated acceptance, not a replacement-deployment smoke check.

The retained current Core/Governance/runtime contract, scripted provider, fixture MCP and browser regression tests are not obsolete scripts. One-off CI drivers and source snapshots may be archived after retaining source identities, logs, screenshots, result JSON, ledgers and evidence. Rebuildable test environments/caches may then be removed after ownership and active-process/mount checks. Never use global Docker prune or remove shared images merely to tidy this deployment.
