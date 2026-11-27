/**
 * Shared request header and primary view tabs across BioHarness Step 3 & Step 4 routes
 * (not upstream LibreChat code).
 */
import React, { memo } from 'react';
import {
  Activity,
  FileText,
  GitFork,
  MessageSquare,
  Play,
  SlidersHorizontal,
} from 'lucide-react';
import { Button, useMediaQuery } from '@librechat/client';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import { cn } from '~/utils';
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
    workspace,
    selectedScopeId,
    openConversation,
    openNewResearch,
    openWorkflowView,
    openEvidenceView,
    openExecutionsView,
    openModelSettings,
  } = useBioHarnessWorkspace();

  const activeModel = meta?.runtime?.model ?? null;

  const goConversation = () => {
    if (conversationId) {
      openConversation(conversationId, { requestId, scopeId: selectedScopeId });
    } else {
      openNewResearch({ requestId, scopeId: selectedScopeId });
    }
  };

  const tabClass = (active: boolean) =>
    cn(
      'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
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
        <div className="flex min-w-0 items-center gap-2">
          {isSmallScreen && <OpenSidebar testId="header-open-sidebar-button" />}
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
            <span
              className="bg-surface-hover text-text-primary rounded-md px-2 py-0.5 font-medium"
              data-testid="bh-header-workspace"
            >
              {workspace ?? '—'}
            </span>
            <span className="text-text-tertiary">/</span>
            <span
              className="text-text-primary truncate font-mono"
              data-testid="bh-header-request"
            >
              {requestId ? requestId : 'Unbound'}
            </span>
            {conversationId && (
              <>
                <span className="text-text-tertiary">/</span>
                <span
                  className="text-text-secondary truncate font-mono"
                  data-testid="bh-header-convo"
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
            <span className="max-w-[140px] truncate">{activeModel || 'Models'}</span>
          </Button>
        </div>
      </div>

      <nav
        aria-label="Workspace views"
        data-testid="bh-primary-tabs"
        className="flex flex-wrap items-center justify-between gap-2 pt-0.5"
      >
        <div className="flex flex-wrap items-center gap-1" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'conversation'}
            data-testid="bh-tab-conversation"
            onClick={goConversation}
            className={tabClass(activeTab === 'conversation')}
          >
            <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Conversation</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'workflow'}
            data-testid="bh-tab-workflow"
            onClick={() => openWorkflowView({ requestId, conversationId })}
            className={tabClass(activeTab === 'workflow')}
          >
            <GitFork className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Research workflow</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'evidence'}
            data-testid="bh-tab-evidence"
            onClick={() => openEvidenceView({ requestId, conversationId })}
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
