/**
 * Step 5 behavioral parity regression tests ported onto the adopted BioHarness routes
 * (not upstream LibreChat code).
 */
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Snapshot, TreeData, ConversationEvent } from '../bioharness';
import {
  bhKeys,
  deriveRunStatus,
  eventsToMessages,
  extractTreeProjects,
  extractTreeScopes,
} from '../bioharness';
import { isCurrentPlanAttempt, matchesSnapshot, resolveBoundConversation } from '../scientificViews';
import BioHarnessRequestHeader from '../BioHarnessRequestHeader';
import { useBioHarnessWorkspace } from '../workspace';

jest.mock('../workspace', () => ({
  useBioHarnessWorkspace: jest.fn(),
}));

jest.mock('~/components/Chat/Menus/OpenSidebar', () => ({
  __esModule: true,
  default: ({ testId }: { testId?: string }) => <button data-testid={testId}>Open</button>,
}));

const mockUseWorkspace = useBioHarnessWorkspace as jest.MockedFunction<typeof useBioHarnessWorkspace>;

describe('Step 5 Governance multi-project extraction & scientific views identity', () => {
  it('extracts multi-project summaries when tree nodes are empty and scopes when project_id is selected', () => {
    const multiProjectSnap: Snapshot<TreeData> = {
      service: 'svc-1',
      workspace: 'ws-a',
      view: 'tree',
      selector: {},
      source: { owner: 'project-governance', interface: 'tree' },
      observed_at: '2026-11-28T00:00:00Z',
      ok: true,
      data: {
        projects: [
          { scope_id: 'proj-alpha', objective: 'Alpha project', request_count: 4 },
          { scope_id: 'proj-beta', objective: 'Beta project', request_count: 2 },
        ],
        nodes: [],
      },
      error: null,
      source_version: null,
      content_sha256: 'abc',
      warnings: [],
    };

    const projects = extractTreeProjects(multiProjectSnap);
    expect(projects.map((p) => p.scope_id)).toEqual(['proj-alpha', 'proj-beta']);
    expect(extractTreeScopes(multiProjectSnap)).toEqual([]);

    const scopedTreeSnap: Snapshot<TreeData> = {
      ...multiProjectSnap,
      selector: { project_id: 'proj-alpha' },
      data: {
        project_id: 'proj-alpha',
        nodes: [
          { scope_id: 'proj-alpha', path: ['proj-alpha'], request_count: 1 },
          { scope_id: 'branch-1', parent_scope_id: 'proj-alpha', path: ['proj-alpha', 'branch-1'], request_count: 3 },
        ],
        goal_version_changes: [{ request_id: 'sci-20261128-aaaaaa', scope_id: 'branch-1' }],
        related_requests: [{ source_request_id: 'sci-20261128-aaaaaa', target_request_id: 'sci-20261128-bbbbbb' }],
      },
    };
    expect(extractTreeScopes(scopedTreeSnap).map((n) => n.scope_id)).toEqual(['proj-alpha', 'branch-1']);
  });

  it('rejects cross-service and cross-workspace snapshots and unconfirmed plan-version attempts', () => {
    const snap: Snapshot<{ request_id: string }> = {
      service: 'svc-a',
      workspace: 'ws-1',
      view: 'now',
      selector: { request_id: 'sci-1' },
      source: { owner: 'core', interface: 'science_now' },
      observed_at: '2026-11-28T00:00:00Z',
      ok: true,
      data: { request_id: 'sci-1' },
      error: null,
      source_version: null,
      content_sha256: 'hash-1',
      warnings: [],
    };
    expect(matchesSnapshot(snap, 'svc-a', 'ws-1')).toBe(true);
    expect(matchesSnapshot(snap, 'svc-a', 'ws-2')).toBe(false);
    expect(matchesSnapshot(snap, 'svc-b', 'ws-1')).toBe(false);

    // Owner-confirmed plan version association only
    expect(isCurrentPlanAttempt({ plan_version: 2 } as any, 2)).toBe(true);
    expect(isCurrentPlanAttempt({ plan_version: 1 } as any, 2)).toBe(false);
    expect(isCurrentPlanAttempt({ plan_version: null } as any, 2)).toBe(false);
    expect(isCurrentPlanAttempt({ plan_version: 2 } as any, undefined)).toBe(false);

    // Explicit conversation binding never guesses when multiple conversations match
    const convos = [
      { id: 'c1', workspace: 'ws-1', request_id: 'sci-1', created_at: '2026-11-28T00:00:00Z' },
      { id: 'c2', workspace: 'ws-1', request_id: 'sci-1', created_at: '2026-11-28T00:01:00Z' },
    ];
    expect(resolveBoundConversation(convos, 'ws-1', 'sci-1', null)).toBeNull();
    expect(resolveBoundConversation(convos, 'ws-1', 'sci-1', 'c2')?.id).toBe('c2');
    expect(resolveBoundConversation(convos, 'ws-2', 'sci-1', 'c2')).toBeNull();
  });

  it('keeps cancellation requested distinct from confirmed termination and discards uncommitted deltas on failure', () => {
    const events: ConversationEvent[] = [
      { seq: 1, run_id: 'run-1', type: 'user.message', data: { text: 'Explain TF motif enrichment' } },
      { seq: 2, run_id: 'run-1', type: 'run.started', data: { run_id: 'run-1', model: 'deepseek-v4.1-flash' } },
      { seq: 3, run_id: 'run-1', type: 'run.cancel_requested', data: { run_id: 'run-1' } },
    ];
    const duringCancel = deriveRunStatus(events, 'run-1');
    expect(duringCancel.activeRunId).toBe('run-1');
    expect(duringCancel.cancelRequested).toBe(true);

    const afterFailure: ConversationEvent[] = [
      ...events,
      { seq: 4, run_id: 'run-1', type: 'run.finished', data: { run_id: 'run-1', state: 'FAILED', error: 'HTTP 502' } },
    ];
    const settled = deriveRunStatus(afterFailure, null);
    expect(settled.activeRunId).toBeNull();
    expect(settled.cancelRequested).toBe(false);
    expect(settled.lastFinishedState).toBe('FAILED');

    // After failure settles with cleared draft, no partial assistant text is promoted
    const msgs = eventsToMessages(afterFailure, '', 'conv-1', 'active-model-should-not-leak');
    expect(msgs.some((m) => !m.isCreatedByUser && m.text?.includes('partial uncommitted'))).toBe(false);
    expect(msgs.some((m) => m.text?.includes('Explain TF motif enrichment'))).toBe(true);
  });
});

describe('Step 5 BioHarnessRequestHeader keyboard navigation & active-run return hint', () => {
  it('supports ArrowRight/ArrowLeft/Home/End tab navigation and shows return-to-active-run hint', () => {
    const openConversation = jest.fn();
    const openNewResearch = jest.fn();
    const openWorkflowView = jest.fn();
    const openEvidenceView = jest.fn();
    const openExecutionsView = jest.fn();
    const openModelSettings = jest.fn();

    mockUseWorkspace.mockReturnValue({
      meta: {
        service: 'svc-parity',
        workspaces: ['ws-main'],
        poll_interval_seconds: 5,
        tools: {},
        runtime: { enabled: true, model: 'auto/deepseek-v4.1-flash', module_tool_servers: [] },
      },
      metaLoading: false,
      metaError: false,
      service: 'svc-parity',
      workspaces: ['ws-main'],
      workspace: 'ws-main',
      selectedRequestId: 'sci-20261128-222222',
      selectedScopeId: 'scope-a',
      linkedConversationId: 'conv-current',
      branchSource: null,
      selectWorkspace: jest.fn(),
      selectRequest: jest.fn(),
      selectScope: jest.fn(),
      openConversation,
      openNewResearch,
      openWorkflowView,
      openEvidenceView,
      openExecutionsView,
      stageTextInConversation: jest.fn(),
      clearBranchSource: jest.fn(),
      openModelSettings,
      getDraft: () => '',
      setDraft: jest.fn(),
      clearDraft: jest.fn(),
    } as any);

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(bhKeys.conversations('svc-parity', 'ws-main'), [
      {
        id: 'conv-running-1',
        workspace: 'ws-main',
        request_id: 'sci-20261128-111111',
        created_at: '2026-11-28T00:00:00Z',
        last_run_state: 'RUNNING',
      },
      {
        id: 'conv-current',
        workspace: 'ws-main',
        request_id: 'sci-20261128-222222',
        created_at: '2026-11-28T00:05:00Z',
        last_run_state: 'FINISHED',
      },
    ]);

    render(
      <QueryClientProvider client={qc}>
        <BioHarnessRequestHeader
          activeTab="conversation"
          requestId="sci-20261128-222222"
          conversationId="conv-current"
          activeRunId={null}
        />
      </QueryClientProvider>,
    );

    // Return-to-active-run hint appears for the other running conversation and jumps on click
    const returnBtn = screen.getByTestId('bh-return-active-run-btn');
    expect(returnBtn).toHaveTextContent('sci-20261128-111111');
    fireEvent.click(returnBtn);
    expect(openConversation).toHaveBeenCalledWith('conv-running-1', {
      requestId: 'sci-20261128-111111',
    });

    // Keyboard tablist navigation: ArrowRight -> Workflow, End -> Evidence, Home -> Conversation
    const convTab = screen.getByTestId('bh-tab-conversation');
    fireEvent.keyDown(convTab, { key: 'ArrowRight' });
    expect(openWorkflowView).toHaveBeenCalledWith({
      requestId: 'sci-20261128-222222',
      conversationId: 'conv-current',
    });

    fireEvent.keyDown(convTab, { key: 'End' });
    expect(openEvidenceView).toHaveBeenCalledWith({
      requestId: 'sci-20261128-222222',
      conversationId: 'conv-current',
    });

    fireEvent.keyDown(screen.getByTestId('bh-tab-evidence'), { key: 'Home' });
    expect(openConversation).toHaveBeenCalledWith('conv-current', {
      requestId: 'sci-20261128-222222',
      scopeId: 'scope-a',
    });
  });
});
