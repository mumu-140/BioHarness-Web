# BioHarness Research Workspace — adopted frontend

This directory is the LibreChat frontend adopted as the application foundation
(roadmap §17.4–17.5), built without LibreChat's API server, database, Agent/Assistants/MCP
services or telemetry. As of roadmap §17.4 Step 5 (2026-11-28), this directory replaces the
retired custom `frontend/` in repository source (retained in Git history). Live production
deployment switching remains separately approved.

## Origin

- Source: [LibreChat](https://github.com/LibreChat-AI/LibreChat) tag `v0.8.9`, commit
  `d4e85d2205c78413ee27d631d7e3b7313556f21d`, MIT (`LICENSE` kept unchanged; the upstream
  root and client `package.json` say ISC).
- Copied unchanged except where listed below: `client/`, `packages/client/`, `packages/chat/`,
  `packages/data-provider/`, `scripts/typecheck.mts`, `config/jest.workers.cjs`, `.npmrc`,
  `.nvmrc`.
- Not copied: `api/`, `packages/api`, `packages/data-schemas`, `packages/channel-gateway`,
  `vendor/`, e2e, deployment and server configuration.

## Changes to upstream files

Every changed non-JSON file carries a comment starting `BioHarness: changed from LibreChat v0.8.9`
(`grep -rl "BioHarness: changed from LibreChat v0.8.9" client`). JSON files without comment syntax:

- `package.json`: workspaces reduced to the four packages above; scripts and development
  tools of the server, lint, e2e and release tooling removed. `overrides` unchanged.
- `package-lock.json`: the upstream lock pruned by npm 11.13.0 to those workspaces, plus the five
  roadmap §17.5 Step 4 scientific-view packages (`@rc-component/tree@1.5.3`, `@xyflow/react@13.0.3`,
  `@dagrejs/dagre@2.0.0`, `ag-grid-community@36.2.0`, `ag-grid-react@36.2.0`). All retained donor
  packages keep their exact upstream versions.
- `client/public/pdfjs/`: official Mozilla PDF.js generic viewer `v6.5.438` (Apache-2.0 `LICENSE`
  retained; demo PDF, `.map` files and `pdf.sandbox.mjs` removed; document scripting and arbitrary
  file opening disabled; `validateFileURL` restricted to same-origin `/api/workspaces/*/evidence-content`).
- `client/src/locales/{en,zh-Hans}/translation.json`: two sign-in strings added.
- Upstream test files of removed features were deleted (`skills` routes, Speech settings,
  one spec importing the server package); specs of changed components were updated.

`client/src/host/` is new BioHarness code, not upstream: the request gate (`gate.ts`),
start-up/sign-in mappings (`routes.ts`, `session.ts`, `install.ts`), BioHarness HTTP/SSE/workspace
bindings (`bioharness.ts`, `events.ts`, `workspace.tsx`), the Step 3 vertical-slice adapters
(`BioHarnessSidebarSection.tsx`, `BioHarnessChatRoute.tsx`, `BioHarnessComposer.tsx`,
`BioHarnessChatBanners.tsx`, `BioHarnessModelsSettings.tsx`), and the Step 4 scientific views and
evidence viewers (`BioHarnessRequestHeader.tsx`, `BioHarnessWorkflowRoute.tsx`,
`BioHarnessPlanGraph.tsx`, `BioHarnessExecutionsRoute.tsx`, `BioHarnessEvidenceRoute.tsx`,
`BioHarnessEvidenceTable.tsx`, `BioHarnessPdfViewer.tsx`, `BioHarnessEvidenceCodeViewer.tsx`)
seated inside LibreChat's adopted shell, sidebar, ChatScreen/MessagesView/Markdown,
ComposerFrame/ComposerField/ComposerActions, Table, ImagePreview, and SettingsDialog.
Donor VitePWA service-worker registration is disabled (`vite.config.ts`).

## Build and check

Needs Node 24.22.3 and npm 11.13.0 (`.nvmrc`, `packageManager`).

    npm ci --ignore-scripts
    npm run build            # data-provider, client package, chat, then client/dist
    (cd client && npx tsc --noEmit -p tsconfig.json && npx jest --watchAll=false)
    ../tests/browser/ui_run.sh <image with Node and Playwright Chromium>
    ../tests/browser/ui_step3_run.sh <image with Node and Playwright Chromium>
    ../tests/browser/ui_step4_run.sh <image with Node and Playwright Chromium>
    ../tests/browser/ui_step5_run.sh <image with Node and Playwright Chromium>

Serve `client/dist` with the unchanged backend through `BIOHARNESS_WEB_STATIC_DIR`.
