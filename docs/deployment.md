# Deployment Principles

**Status: target principles only.** The V2 runtime and production deployment have not been implemented or selected.

## 1. Deployment shape

BioHarness-Web is a backend-hosted application:

- browser: UI only; no provider credentials or direct access to scientific workspaces;
- Web backend: direct model API calls, Core Host adapter, configured Module tools and visual projections;
- Core workspace: authoritative request and scientific progress records;
- Modules and data/HPC: domain-specific capability and scientific data stores.

The backend runs where it can access the selected Core workspace and configured Module tools. It also needs outbound connectivity to selected model provider APIs unless a separately configured local model endpoint is used.

## 2. Workspace access

- Bind each Web workspace to an explicit canonical research workspace.
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

SSE connections must support reconnect and report stale/disconnected state without changing Core task state.

## 5. Process and filesystem isolation

- Run the backend as a non-root service account.
- Use the narrowest required workspace and tool mounts.
- Mount source datasets read-only unless a documented workflow requires a separate writable output directory.
- Keep generated outputs in explicit project output locations.
- Do not grant arbitrary shell execution to model-generated text.
- Stop/restart of Web must not mutate Core or Module stores.

## 6. Desktop

Desktop packaging is deferred. Tauri may later use the same Web frontend and backend contract. The local-sidecar versus remote-backend decision is based on actual multi-device and filesystem requirements, not assumed in advance.

## 7. Deployment TODO

- [ ] Select the first authorized host and canonical workspace.
- [ ] Verify installed Core Host and Module CLI/MCP versions on that host.
- [ ] Select model provider endpoint and store its key server-side.
- [ ] Define authentication and session-to-workspace mapping.
- [ ] Define narrow workspace, evidence and output roots.
- [ ] Verify SSE behavior through the intended reverse proxy or SSH tunnel.
- [ ] Verify that stopping Web leaves Core and Modules unchanged.
- [ ] Record exact image/build SHA, configuration identity and smoke-test evidence before production use.

No production deployment is authorized or claimed by this planning document.