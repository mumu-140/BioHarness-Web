/**
 * R3 Post-Audit Frontend Unit Tests:
 * 1. User messages with separate structured attachments display cleanly without mutating verbatim text.
 * 2. Interrupted run banner exposes Resume & Resume-with-Thorough controls cleanly.
 * 3. Memory workbench has zero hardcoded plant/domain presets and renders SKILL.md as advisory doc.
 */
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import BioHarnessChatBanners from '../BioHarnessChatBanners';
import BioHarnessCapabilitiesRoute from '../BioHarnessCapabilitiesRoute';
import * as bioharnessApi from '../bioharness';
import * as workspaceCtx from '../workspace';

describe('R3 post-audit frontend regressions', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('projects user.message attachments in display without mutating stored text', () => {
    const events: bioharnessApi.ConversationEvent[] = [
      {
        seq: 1, conversation_id: 'conv-1', run_id: 'run-1',
        type: 'user.message',
        data: {
          text: 'Verbatim scientific question?',
          attachments: [
            {
              name: 'counts.csv',
              server_path: '$WORKSPACE/inputs/counts.csv',
              sha256: 'abcdef1234567890',
              bytes: 42,
            },
          ],
        },
        at: '2026-11-28T06:00:00Z',
      },
    ];
    const msgs = bioharnessApi.eventsToMessages(events, '', 'conv-1', null);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toContain('Verbatim scientific question?');
    expect(msgs[0].text).toContain('counts.csv');
    expect(msgs[0].text).toContain('sha256:abcdef123456');
  });

  it('renders interrupted-run recovery banner and propagates thorough strategy override', () => {
    const onContinueTask = jest.fn();
    render(
      <BioHarnessChatBanners
        problem={null}
        onDismissProblem={jest.fn()}
        stateError={null}
        needsExplicitRequestStart={false}
        selectedRequestId={null}
        runtimeEnabled={true}
        isActing={false}
        onStartRequestConversation={jest.fn()}
        stateData={undefined}
        beginReconcile={null}
        onAttachRequest={jest.fn()}
        nowData={{ request_id: 'sci-1', phase: 'EXECUTING' }}
        activeRunId={null}
        lastFinishedState="INTERRUPTED"
        selectedStrategy="concise"
        onContinueTask={onContinueTask}
        onInsertIntoDraft={jest.fn()}
        onBranchFromDelivered={jest.fn()}
        isNew={false}
        branchSource={null}
        onClearBranchSource={jest.fn()}
        scopes={[]}
        scopeMode="none"
        onScopeModeChange={jest.fn()}
        selectedScopeId=""
        onSelectedScopeIdChange={jest.fn()}
        newScopeId=""
        onNewScopeIdChange={jest.fn()}
        scopeProblem={null}
      />,
    );

    expect(screen.getByTestId('bh-run-interrupted-banner')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('bh-resume-task-btn'));
    expect(onContinueTask).toHaveBeenCalledWith();
    fireEvent.click(screen.getByTestId('bh-resume-thorough-btn'));
    expect(onContinueTask).toHaveBeenCalledWith('thorough');
  });

  it('uses generic domain-neutral Memory condition inputs and honest SKILL.md advisory badge', async () => {
    jest.spyOn(workspaceCtx, 'useBioHarnessWorkspace').mockReturnValue({
      meta: undefined,
      metaLoading: false,
      metaError: null,
      service: 'svc-1',
      workspaces: ['ws-1'],
      workspace: 'ws-1',
      selectedRequestId: null,
      selectedScopeId: null,
      linkedConversationId: null,
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
    });
    jest.spyOn(bioharnessApi, 'fetchView').mockResolvedValue({ ok: true, data: {} } as any);
    jest.spyOn(bioharnessApi, 'fetchMemoryStatus').mockResolvedValue({
      configured: true,
      callable: true,
      server: 'bioharness-memory',
      checked_at: '2026-11-28T06:00:00Z',
      tools: ['memory_recall', 'memory_status'],
      status: { active_memory_count: 1, theme_count: 0, pending_candidate_count: 0 },
      diagnose: { context_trigger_keys: { organism: 2, assay_type: 1 } },
      capabilities: {
        recall_modes: { FAST: true, STANDARD: true, DEEP: false },
        curator_interactive_publish: false,
      },
      error: null,
    });
    jest.spyOn(bioharnessApi, 'fetchCapabilities').mockResolvedValue({
      service: 'svc-1',
      workspace: 'ws-1',
      observed_at: '2026-11-28T06:00:00Z',
      core_state_present: true,
      doctor: { status: 'OK' },
      doctor_error: null,
      resources: [],
      skills: [
        {
          id: 'qc-guide',
          name: 'qc-guide',
          description: 'QC checklist',
          source: '$WORKSPACE/.claude/skills/qc-guide/SKILL.md',
          declared: true,
          installed: true,
          callable: null,
          actually_used: false,
          use_count: 0,
        },
      ],
      mcp_servers: [],
      cli_modules: [],
      documents: { scope_id: null, candidates: [], selected: {}, loaded: {}, error: null },
      observed_usage: { servers: {}, tools: {}, total_tool_calls: 0 },
      compute: { remote_compute_enabled: false, phase: 'R4_DEFERRED', note: 'Deferred' },
    });

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/w/capabilities?ws=ws-1&tab=memory']}>
          <BioHarnessCapabilitiesRoute />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId('bh-memory-cond-key')).toBeInTheDocument();
    expect(screen.queryByTestId('bh-memory-research-area')).not.toBeInTheDocument();
    expect(await screen.findByTestId('bh-memory-trigger-key-organism')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('bh-memory-trigger-key-organism'));
    fireEvent.change(screen.getByTestId('bh-memory-cond-val'), { target: { value: 'yeast' } });
    fireEvent.click(screen.getByTestId('bh-memory-add-cond-btn'));
    expect(screen.getByTestId('bh-memory-cond-chip-organism')).toHaveTextContent('organism=yeast');

    fireEvent.click(screen.getByTestId('bh-cap-subtab-capabilities'));
    const sk = await screen.findByTestId('bh-cap-skill-qc-guide');
    expect(sk.textContent).not.toContain('可调用');
    expect(sk.textContent).toMatch(/Advisory doc|按需读取/);
  });
});
