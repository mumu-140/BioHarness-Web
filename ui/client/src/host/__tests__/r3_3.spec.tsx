import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import BioHarnessCapabilitiesRoute from '../BioHarnessCapabilitiesRoute';
import { BioHarnessDiagnosticsSettings } from '../BioHarnessCapabilitiesSettings';
import * as bioharnessApi from '../bioharness';
import * as workspaceCtx from '../workspace';

jest.mock('~/components/Chat/Menus/OpenSidebar', () => ({
  __esModule: true,
  default: ({ testId }: { testId?: string }) => <button data-testid={testId}>Open</button>,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { resolvedLanguage: 'zh-Hans', language: 'zh-Hans' },
  }),
}));

if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: () => ({
      matches: false,
      media: '',
      onchange: null,
      addListener: jest.fn(),
      removeListener: jest.fn(),
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }),
  });
}

const mockWorkspaceBase = {
  meta: {
    service: 'svc-r33',
    workspaces: ['ppgr'],
    poll_interval_seconds: 5,
    tools: {},
    runtime: { enabled: true, model: 'test-model', module_tool_servers: ['bioharness-memory'] },
  },
  metaLoading: false,
  metaError: false,
  service: 'svc-r33',
  workspaces: ['ppgr'],
  workspace: 'ppgr',
  selectedRequestId: 'sci-r33-1',
  selectedScopeId: 'PPGR',
  linkedConversationId: 'conv-1',
  branchSource: null,
  setBranchSource: jest.fn(),
  pendingScopeDraft: null,
  setPendingScopeDraft: jest.fn(),
  selectWorkspace: jest.fn(),
  selectScope: jest.fn(),
  openConversation: jest.fn(),
  openNewResearch: jest.fn(),
  openWorkflowView: jest.fn(),
  openEvidenceView: jest.fn(),
  openExecutionsView: jest.fn(),
  openCapabilitiesView: jest.fn(),
  stageTextInConversation: jest.fn(),
      pendingAttachments: [],
      clearPendingAttachments: jest.fn(),
      attachFileToConversation: jest.fn(),
  getDraft: () => '',
  setDraft: jest.fn(),
  clearDraft: jest.fn(),
  openModelSettings: jest.fn(),
  openCapabilitiesSettings: jest.fn(),
};

describe('R3.3 Capabilities, Memory & Diagnostics UI', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders Memory workbench with honest DEEP/Curator boundaries, recall, T3 expand, and feedback', async () => {
    jest.spyOn(workspaceCtx, 'useBioHarnessWorkspace').mockReturnValue(mockWorkspaceBase as any);
    jest.spyOn(bioharnessApi, 'fetchView').mockResolvedValue({
      ok: true,
      data: { projects: [{ scope_id: 'PPGR' }] },
    } as any);
    jest.spyOn(bioharnessApi, 'fetchMemoryStatus').mockResolvedValue({
      configured: true,
      callable: true,
      server: 'bioharness-memory',
      checked_at: '2026-11-28T04:00:00Z',
      tools: ['memory_recall', 'memory_expand', 'memory_report_use', 'memory_capture_candidate'],
      status: { active_memory_count: 2, theme_count: 1, pending_candidate_count: 0 },
      diagnose: {
        active_count: 2,
        theme_count: 1,
        stale_theme_count: 0,
        pending_candidates: { state: 'ok', count: 0 },
        use_feedback: { events: 1, consumed: 1, reported_failures: 0 },
      },
      capabilities: {
        recall_modes: { FAST: true, STANDARD: true, DEEP: false },
        deep_unavailable_reason: 'DEEP 模式尚未公开',
        curator_interactive_publish: false,
        curator_gap_note: '需 BioHarness-Modules 暴露 Curator 审核发布公开接口。',
      },
      error: null,
    });
    const recallSpy = jest.spyOn(bioharnessApi, 'recallMemory').mockResolvedValue({
      server: 'bioharness-memory',
      mode: 'FAST',
      result: {
        backend: 'FTS5',
        scientific_validation: 'NOT_PERFORMED',
        themes: [
          { t1_ref: 't1:rnaseq@1', title: 'RNA-seq DE', scope: 'Plant RNA-seq', member_count: 1, stale: false },
        ],
        candidates: [
          {
            memory_ref: 'mem:deseq2@1',
            applicability: 'APPLICABLE',
            verification_status: 'reported',
            source_status: 'MATCH',
          },
        ],
      },
    });
    jest.spyOn(bioharnessApi, 'expandMemory').mockResolvedValue({
      server: 'bioharness-memory',
      detail: 'T3',
      result: {
        memory_ref: 'mem:deseq2@1',
        sources: [
          {
            source_ref: 'native:notes:1',
            source_revision: 'sha256:aaa',
            record_sha256: 'sha256:bbb',
            relative_path: 'ppgr_notes.md',
            line: 1,
            text: null,
          },
        ],
      },
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/w/capabilities?ws=ppgr&tab=memory']}>
          <BioHarnessCapabilitiesRoute />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId('bh-memory-callable-badge')).toBeInTheDocument();
    expect(screen.getByTestId('bh-memory-active-count')).toHaveTextContent('2');
    expect(screen.getByTestId('bh-memory-deep-gap-badge')).toHaveTextContent('DEEP');
    expect(screen.getByTestId('bh-memory-curator-gap-note')).toHaveTextContent('BioHarness-Modules');
    expect(screen.getByTestId('bh-memory-mode-deep')).toBeDisabled();

    fireEvent.change(screen.getByTestId('bh-memory-query-input'), {
      target: { value: 'DESeq2 replicates' },
    });
    fireEvent.click(screen.getByTestId('bh-memory-recall-submit'));

    await waitFor(() => expect(recallSpy).toHaveBeenCalled());
    expect(await screen.findByTestId('bh-memory-cand-mem:deseq2@1')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('bh-memory-expand-t3-mem:deseq2@1'));
    const expanded = await screen.findByTestId('bh-memory-expanded-panel');
    expect(expanded).toHaveTextContent('ppgr_notes.md#L1');
    expect(expanded).toHaveTextContent('allow_text=False');
  });

  it('preserves last confirmed timestamp cleanly when Memory MCP is degraded', async () => {
    jest.spyOn(workspaceCtx, 'useBioHarnessWorkspace').mockReturnValue(mockWorkspaceBase as any);
    jest.spyOn(bioharnessApi, 'fetchView').mockResolvedValue({ ok: true, data: { projects: [] } } as any);
    jest.spyOn(bioharnessApi, 'fetchMemoryStatus').mockResolvedValue({
      configured: true,
      callable: false,
      server: 'bioharness-memory',
      checked_at: '2026-11-28T04:05:00Z',
      tools: [],
      status: null,
      diagnose: null,
      capabilities: {
        recall_modes: { FAST: false, STANDARD: false, DEEP: false },
        curator_interactive_publish: false,
      },
      error: { code: 'MCP_CONNECT_FAILED', message: 'Memory process exited 503' },
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/w/capabilities?ws=ppgr&tab=memory']}>
          <BioHarnessCapabilitiesRoute />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId('bh-memory-degraded-alert')).toHaveTextContent('MCP_CONNECT_FAILED');
  });

  it('renders redacted Diagnostics settings panel with security posture', async () => {
    jest.spyOn(workspaceCtx, 'useBioHarnessWorkspace').mockReturnValue(mockWorkspaceBase as any);
    jest.spyOn(bioharnessApi, 'fetchDiagnostics').mockResolvedValue({
      service: 'svc-r33',
      workspace: 'ppgr',
      exported_at: '2026-11-28T04:10:00Z',
      security_posture: {
        auth_mode: 'service_access_token_httponly_cookie',
        token_length_ok: true,
        upload_root_configured: true,
        symlink_containment_enforced: true,
        provider_keys_server_side_only: true,
        arbitrary_shell_blocked: true,
        remote_compute_enabled: false,
      },
      runtime: { enabled: true, model_configured: 'test-model', mcp_servers: [] },
      core_doctor: { status: 'OK' },
      core_doctor_error: null,
      memory: {
        configured: true,
        callable: false,
        server: null,
        tools: [],
        status: null,
        diagnose: null,
        capabilities: { recall_modes: { FAST: false, STANDARD: false, DEEP: false }, curator_interactive_publish: false },
        error: null,
      },
      modules: { skills_count: 1, resources_count: 1, cli_modules: [] },
      usage: { servers: {}, tools: {}, total_tool_calls: 0 },
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <BioHarnessDiagnosticsSettings />
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId('bh-diagnostics-json')).toHaveTextContent('provider_keys_server_side_only');
    expect(screen.getByTestId('bh-diagnostics-download-btn')).toBeEnabled();
  });
});
