# Deployment Principles

**Status: target principles, plus how to run the W1 read-side service (section 8).** No production deployment has been selected or made.

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

The first Desktop topology is a thin Tauri client connected to the same remote service, with authenticated API/SSE and explicit workspace identity. Packaging is deferred to W5; local sidecar or hybrid operation is optional only if a real need is demonstrated.

## 7. Deployment acceptance

Deployment choices and TODO are maintained in the [single V2 plan](plans/2026-11-25-research-workspace-v2.md): W0 selects an authorized pilot environment and documents workspace mapping, model endpoints, credentials and connectivity; W2 verifies interruption/recovery and transport contracts; W4 verifies the integrated pilot deployment, access isolation, evidence roots, build identities and smoke results. No duplicate deployment checklist is maintained here.

This public source repository must not contain private scientific data, private infrastructure details, credentials, or non-public evaluation receipts. Keep actual environment configuration and raw audit material in the authorized private research/CI workspace.

## 8. Running the W1 read-side service

The service needs Python 3.12+, the built frontend and the public `bioharness-host` and `bioharness-governance` commands installed for the same user. It reads the configured workspaces and writes nothing. Core state must be in the canonical place, `<workspace>/.bioharness`; a workspace where that directory or one of its `requests`, `evidence`, `sessions` subdirectories is missing is reported as having no Core state and Core is not called for it, because the Core CLI would create them. A workspace may not be `/` or the service user's home directory.

| Variable | Meaning |
|---|---|
| `BIOHARNESS_WEB_WORKSPACES` | Required. JSON object mapping a workspace id to a server directory, or to `{"path": ..., "evidence_roots": [...]}` when evidence files live outside the workspace. |
| `BIOHARNESS_WEB_ACCESS_TOKEN` | Required, at least 16 characters. Every data route needs it. |
| `BIOHARNESS_WEB_HOST`, `BIOHARNESS_WEB_PORT` | Default `127.0.0.1:8080`. Keep loopback and reach it through an SSH tunnel or an authenticated HTTPS reverse proxy. |
| `BIOHARNESS_WEB_STATIC_DIR` | Directory of the built frontend (`frontend/dist`). |
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

With the runtime on, the service itself writes only its ledger file, and changes the workspace only through Core's public commands, exactly as an Agent host does. A configured MCP tool writes whatever that module writes: configure only modules whose behaviour in the workspace you accept. Stopping the service interrupts runs in progress; their requests stay recoverable in Core.

Start it with `python -m bioharness_web`. Configured directories are replaced by `$WORKSPACE` and `$EVIDENCE_ROOT_n` in responses. A recorded evidence file outside them is shown by file name only (`$OUTSIDE_CONFIGURED_ROOTS/name`) and cannot be previewed. Free text written by a model or a tool (summaries, instructions) and the content of a previewed evidence file are shown as recorded and are not scanned for paths. Core state of any workspace is never previewed, even when it lies under a configured evidence root. The single shared token is adequate for one trusted operator on a private network, not for multiple users: it does not expire, sign-in attempts are not rate limited, and the session cookie is marked Secure only when the service itself sees HTTPS (run it behind the proxy with forwarded-scheme support, or keep it on loopback). The Core and Governance commands are started with a reduced environment and never receive the token. The V1 container files were removed with the PostgreSQL service; a container image for this service is not provided yet.

No production deployment is authorized or claimed by this planning document.