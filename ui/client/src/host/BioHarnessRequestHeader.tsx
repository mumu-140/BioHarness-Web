/**
 * Shared request header and primary view tabs across BioHarness Step 3–5 routes
 * (not upstream LibreChat code).
 */
import React, { memo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  CornerUpLeft,
  FileText,
  GitFork,
  MessageSquare,
  Play,
  SlidersHorizontal,
} from 'lucide-react';
import { Button, useMediaQuery } from '@librechat/client';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import { cn } from '~/utils';
import type { WorkspaceConversation } from './bioharness';
import { bhKeys, fetchConversations } from './bioharness';
import { useBioHarnessWorkspace } from './workspace';

export type BioHarnessPrimaryTab = 'conversation' | 'workflow' | 'evidence' | 'executions';

export interface BioHarnessRequestHeaderProps {
  activeTab: BioHarnessPrimaryTab;
  requestId: string | null;
  conversationId: string | null;
  activeRunId?: string | null;
  cancelRequested?: boolean;
  sseConnected?: boolean;
  showContinueFromCore?: boolean;
  continueDisabled?: boolean;
  onContinueFromCore?: () => void;
}

const BioHarnessRequestHeader = memo(function BioHarnessRequestHeader({
  activeTab,
  requestId,
  conversationId,
  activeRunId = null,
  cancelRequested = false,
  sseConnected,
  showContinueFromCore = false,
  continueDisabled = false,
  onContinueFromCore,
}: BioHarnessRequestHeaderProps) {
  const isSmallScreen = useMediaQuery('(max-width: 767px)');
  const {
    meta,
    service,
    workspace,
    selectedScopeId,
    openConversation,
    openNewResearch,
    openWorkflowView,
    openEvidenceView,
    openExecutionsView,
    openModelSettings,
  } = useBioHarnessWorkspace();

  const runtimeEnabled = meta?.runtime?.enabled === true;
  const activeModel = meta?.runtime?.model ?? null;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Read shared conversations cache to surface a non-blocking return hint if another conversation has an active run.
  const conversationsQuery = useQuery<WorkspaceConversation[]>({
    queryKey: bhKeys.conversations(service ?? 'svc', workspace ?? ''),
    queryFn: () => fetchConversations(workspace!),
    enabled: Boolean(service && workspace && runtimeEnabled),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  const otherRunningConvo = (conversationsQuery.data ?? []).find(
    (c) => c.last_run_state === 'RUNNING' && c.id !== conversationId,
  );

  const goConversation = () => {
    if (conversationId) {
      openConversation(conversationId, { requestId, scopeId: selectedScopeId });
    } else {
      openNewResearch({ requestId, scopeId: selectedScopeId });
    }
  };

  const tabActions = [
    goConversation,
    () => openWorkflowView({ requestId, conversationId }),
    () => openEvidenceView({ requestId, conversationId }),
  ];

  const handleTabKeyDown = (index: number, e: React.KeyboardEvent<HTMLButtonElement>) => {
    let nextIdx: number | null = null;
    if (e.key === 'ArrowRight') {
      nextIdx = (index + 1) % tabActions.length;
    } else if (e.key === 'ArrowLeft') {
      nextIdx = (index - 1 + tabActions.length) % tabActions.length;
    } else if (e.key === 'Home') {
      nextIdx = 0;
    } else if (e.key === 'End') {
      nextIdx = tabActions.length - 1;
    }
    if (nextIdx !== null) {
      e.preventDefault();
      tabRefs.current[nextIdx]?.focus();
      tabActions[nextIdx]();
    }
  };

  const tabClass = (active: boolean) =>
    cn(
      'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2',
      active
        ? 'bg-surface-hover text-text-primary shadow-2xs'
        : 'text-text-secondary hover:bg-surface-hover/60 hover:text-text-primary',
    );

  return (
    <header
      className="border-border-light bg-surface-canvas/95 sticky top-0 z-20 flex flex-col gap-1.5 border-b px-3 py-2 backdrop-blur-xs"
      data-testid="bh-chat-header"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 max-w-full items-center gap-2">
          {isSmallScreen && <OpenSidebar testId="header-open-sidebar-button" />}
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5 text-xs">
            <span
              className="bg-surface-hover text-text-primary max-w-[120px] truncate rounded-md px-2 py-0.5 font-medium sm:max-w-[180px]"
              data-testid="bh-header-workspace"
              title={workspace ?? undefined}
            >
              {workspace ?? '—'}
            </span>
            <span className="text-text-tertiary">/</span>
            <span
              className="text-text-primary max-w-[160px] truncate font-mono sm:max-w-[280px]"
              data-testid="bh-header-request"
              title={requestId ?? 'Unbound'}
            >
              {requestId ? requestId : 'Unbound'}
            </span>
            {conversationId && (
              <>
                <span className="text-text-tertiary">/</span>
                <span
                  className="text-text-secondary max-w-[110px] truncate font-mono"
                  data-testid="bh-header-convo"
                  title={conversationId}
                >
                  {conversationId.slice(0, 12)}
                </span>
              </>
            )}
            {activeRunId && (
              <span
                className="rounded-md bg-teal-500/15 px-2 py-0.5 font-medium text-teal-700 dark:text-teal-300"
                data-testid="bh-header-active-run"
              >
                {cancelRequested ? 'Cancel requested…' : `Run ${activeRunId.slice(0, 8)}`}
              </span>
            )}
            {otherRunningConvo && (
              <button
                type="button"
                data-testid="bh-return-active-run-btn"
                onClick={() =>
                  openConversation(otherRunningConvo.id, {
                    requestId: otherRunningConvo.request_id,
                  })
                }
                className="inline-flex max-w-[220px] items-center gap-1 rounded-md border border-teal-500/50 bg-teal-500/10 px-2 py-0.5 text-[11px] font-medium text-teal-800 hover:bg-teal-500/20 dark:text-teal-200"
                title={`Return to active run in ${otherRunningConvo.request_id || otherRunningConvo.id}`}
              >
                <CornerUpLeft className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  Running: {otherRunningConvo.request_id || otherRunningConvo.id.slice(0, 10)}
                </span>
              </button>
            )}
            {conversationId && typeof sseConnected === 'boolean' && (
              <span
                className="text-text-tertiary text-[11px]"
                data-testid="bh-sse-status"
              >
                {sseConnected ? 'SSE live' : 'SSE connecting…'}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {showContinueFromCore && onContinueFromCore && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="bh-continue-core-btn"
              disabled={continueDisabled}
              onClick={onContinueFromCore}
              className="gap-1.5 text-xs"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Continue from Core</span>
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="bh-header-models-btn"
            onClick={openModelSettings}
            className="gap-1.5 text-xs"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="max-w-[110px] truncate sm:max-w-[140px]">{activeModel || 'Models'}</span>
          </Button>
        </div>
      </div>

      <nav
        aria-label="Workspace views"
        data-testid="bh-primary-tabs"
        className="flex flex-wrap items-center justify-between gap-2 pt-0.5"
      >
        <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Primary research views">
          <button
            ref={(el) => {
              tabRefs.current[0] = el;
            }}
            type="button"
            role="tab"
            aria-selected={activeTab === 'conversation'}
            tabIndex={activeTab === 'conversation' || activeTab === 'executions' ? 0 : -1}
            data-testid="bh-tab-conversation"
            onClick={goConversation}
            onKeyDown={(e) => handleTabKeyDown(0, e)}
            className={tabClass(activeTab === 'conversation')}
          >
            <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Conversation</span>
          </button>
          <button
            ref={(el) => {
              tabRefs.current[1] = el;
            }}
            type="button"
            role="tab"
            aria-selected={activeTab === 'workflow'}
            tabIndex={activeTab === 'workflow' ? 0 : -1}
            data-testid="bh-tab-workflow"
            onClick={() => openWorkflowView({ requestId, conversationId })}
            onKeyDown={(e) => handleTabKeyDown(1, e)}
            className={tabClass(activeTab === 'workflow')}
          >
            <GitFork className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Research workflow</span>
          </button>
          <button
            ref={(el) => {
              tabRefs.current[2] = el;
            }}
            type="button"
            role="tab"
            aria-selected={activeTab === 'evidence'}
            tabIndex={activeTab === 'evidence' ? 0 : -1}
            data-testid="bh-tab-evidence"
            onClick={() => openEvidenceView({ requestId, conversationId })}
            onKeyDown={(e) => handleTabKeyDown(2, e)}
            className={tabClass(activeTab === 'evidence')}
          >
            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Evidence</span>
          </button>
        </div>

        <button
          type="button"
          data-testid="bh-tab-executions"
          aria-current={activeTab === 'executions' ? 'page' : undefined}
          onClick={() => openExecutionsView({ requestId, conversationId })}
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
            activeTab === 'executions'
              ? 'bg-surface-hover text-text-primary'
              : 'text-text-tertiary hover:bg-surface-hover/60 hover:text-text-primary',
          )}
        >
          <Activity className="h-3 w-3" aria-hidden="true" />
          <span>Execution records</span>
        </button>
      </nav>
    </header>
  );
});

export default BioHarnessRequestHeader;
