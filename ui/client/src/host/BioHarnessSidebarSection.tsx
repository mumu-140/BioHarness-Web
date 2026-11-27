/**
 * BioHarness workspace selector, conversations list, and open research requests
 * seated inside LibreChat's adopted UnifiedSidebar (not upstream code).
 */
import { memo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  Cpu,
  FolderGit2,
  MessageSquare,
  Plus,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import { Button, Spinner } from '@librechat/client';
import useDrawerViewport from '~/hooks/Nav/useDrawerViewport';
import useSidebarToggle from '~/hooks/Nav/useSidebarToggle';
import { cn } from '~/utils';
import type { OpenRequestsData, Snapshot, WorkspaceConversation } from './bioharness';
import {
  bhKeys,
  extractOpenRequests,
  fetchConversations,
  fetchView,
} from './bioharness';
import { useBioHarnessWorkspace } from './workspace';

const RUN_BADGE: Record<string, { label: string; cls: string }> = {
  RUNNING: { label: 'Running', cls: 'bg-teal-500/15 text-teal-700 dark:text-teal-300' },
  CANCELLED: { label: 'Cancelled', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  FAILED: { label: 'Failed', cls: 'bg-red-500/15 text-red-700 dark:text-red-300' },
  INTERRUPTED: { label: 'Interrupted', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
};

const BioHarnessSidebarSection = memo(function BioHarnessSidebarSection() {
  const { conversationId: routeConversationId } = useParams();
  const isSmallScreen = useDrawerViewport();
  const { setSidebarOpen } = useSidebarToggle();
  const {
    meta,
    metaLoading,
    metaError,
    service,
    workspaces,
    workspace,
    selectedRequestId,
    selectWorkspace,
    openConversation,
    openNewResearch,
    openModelSettings,
  } = useBioHarnessWorkspace();

  const runtimeEnabled = meta?.runtime?.enabled === true;

  const conversationsQuery = useQuery<WorkspaceConversation[]>({
    queryKey: bhKeys.conversations(service ?? 'svc', workspace ?? ''),
    queryFn: () => fetchConversations(workspace!),
    enabled: Boolean(service && workspace && runtimeEnabled),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  const openRequestsQuery = useQuery<Snapshot<OpenRequestsData>>({
    queryKey: bhKeys.view(service ?? 'svc', workspace ?? '', 'open'),
    queryFn: () => fetchView<OpenRequestsData>(workspace!, 'open'),
    enabled: Boolean(service && workspace),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  const conversations = conversationsQuery.data ?? [];
  const openRequests = extractOpenRequests(openRequestsQuery.data);
  const closeDrawerIfMobile = () => {
    if (isSmallScreen) {
      setSidebarOpen(false);
    }
  };

  return (
    <div
      className="flex h-full min-h-0 flex-col gap-3 px-2.5 py-2 text-sm"
      data-testid="bh-sidebar"
    >
      {/* Service & explicit workspace selector */}
      <div className="border-border-light bg-surface-primary/60 rounded-xl border p-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-text-tertiary truncate text-[11px] font-medium uppercase tracking-wide">
            {service ?? 'BioHarness'}
          </span>
          <button
            type="button"
            data-testid="bh-sidebar-models-btn"
            onClick={() => {
              closeDrawerIfMobile();
              openModelSettings();
            }}
            className="text-text-secondary hover:text-text-primary hover:bg-surface-hover inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] transition-colors"
            title="Model settings"
          >
            <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
            <span>Models</span>
          </button>
        </div>

        {metaLoading ? (
          <div className="text-text-secondary flex items-center gap-2 py-1 text-xs">
            <Spinner className="h-3.5 w-3.5" />
            <span>Loading workspaces…</span>
          </div>
        ) : metaError ? (
          <div className="text-text-destructive flex items-center gap-1.5 text-xs" role="alert">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Failed to load service metadata.</span>
          </div>
        ) : (
          <>
            <label className="block">
              <span className="sr-only">Workspace</span>
              <select
                aria-label="Workspace"
                data-testid="bh-workspace-select"
                value={workspace ?? ''}
                onChange={(e) => {
                  selectWorkspace(e.target.value);
                  closeDrawerIfMobile();
                }}
                className="border-border-medium bg-surface-primary text-text-primary w-full rounded-lg border px-2 py-1.5 text-xs font-medium focus:outline-hidden focus:ring-2"
              >
                {workspaces.map((ws) => (
                  <option key={ws} value={ws}>
                    {ws}
                  </option>
                ))}
              </select>
            </label>
            <div className="text-text-secondary mt-1.5 flex items-center gap-1.5 truncate text-[11px]">
              <Cpu className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate" data-testid="bh-active-model-label">
                {runtimeEnabled
                  ? meta?.runtime?.model || 'Model configured'
                  : 'Runtime disabled (read-only)'}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Dominant action: new research question */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid="bh-new-research-btn"
        className="w-full justify-start gap-2"
        onClick={() => {
          openNewResearch();
          closeDrawerIfMobile();
        }}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        <span>New research question</span>
      </Button>

      {/* Scrollable workspace conversations & open Core requests */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pe-0.5">
        {/* Conversations */}
        <section aria-label="Conversations" data-testid="bh-conversations-section">
          <div className="text-text-tertiary mb-1.5 flex items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-wide">
            <span>Conversations</span>
            {runtimeEnabled && (
              <button
                type="button"
                aria-label="Refresh conversations"
                onClick={() => void conversationsQuery.refetch()}
                className="hover:text-text-primary rounded p-0.5 transition-colors"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
              </button>
            )}
          </div>

          {!runtimeEnabled ? (
            <p className="text-text-secondary px-1 text-xs" data-testid="bh-runtime-unavailable">
              Native runtime is not enabled on this service.
            </p>
          ) : conversationsQuery.isLoading ? (
            <div className="text-text-secondary flex items-center gap-2 px-1 py-2 text-xs">
              <Spinner className="h-3.5 w-3.5" />
              <span>Loading conversations…</span>
            </div>
          ) : conversationsQuery.isError ? (
            <div
              className="border-status-error-border bg-status-error-subtle text-text-secondary rounded-lg border p-2 text-xs"
              data-testid="convo-list-error"
              role="alert"
            >
              <p>Could not load conversations.</p>
              <button
                type="button"
                onClick={() => void conversationsQuery.refetch()}
                className="text-text-primary mt-1 underline"
              >
                Retry
              </button>
            </div>
          ) : conversations.length === 0 ? (
            <p className="text-text-secondary px-1 text-xs">No conversations in this workspace yet.</p>
          ) : (
            <ul className="space-y-1" data-testid="bh-conversations-list">
              {conversations.map((item) => {
                const active = routeConversationId === item.id;
                const badge = item.last_run_state ? RUN_BADGE[item.last_run_state] : undefined;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      data-testid={`bh-convo-item-${item.id}`}
                      aria-current={active ? 'page' : undefined}
                      onClick={() => {
                        openConversation(item.id, { requestId: item.request_id });
                        closeDrawerIfMobile();
                      }}
                      className={cn(
                        'hover:bg-surface-hover flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-start transition-colors',
                        active && 'bg-surface-active-alt text-text-primary font-medium',
                      )}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-xs">
                          <MessageSquare className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
                          <span className="truncate font-mono">
                            {item.request_id || item.id.slice(0, 12)}
                          </span>
                        </span>
                        {badge && (
                          <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px]', badge.cls)}>
                            {badge.label}
                          </span>
                        )}
                      </div>
                      <span className="text-text-tertiary truncate ps-5 text-[11px]">
                        {item.request_id ? `conv ${item.id.slice(0, 8)}` : 'Unbound conversation'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Open Core Requests */}
        <section aria-label="Open requests" data-testid="bh-open-requests-section">
          <div className="text-text-tertiary mb-1.5 flex items-center justify-between px-1 text-[11px] font-semibold uppercase tracking-wide">
            <span>Open Core Requests</span>
            <button
              type="button"
              aria-label="Refresh open requests"
              onClick={() => void openRequestsQuery.refetch()}
              className="hover:text-text-primary rounded p-0.5 transition-colors"
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>

          {openRequestsQuery.isLoading ? (
            <div className="text-text-secondary flex items-center gap-2 px-1 py-2 text-xs">
              <Spinner className="h-3.5 w-3.5" />
              <span>Loading requests…</span>
            </div>
          ) : openRequestsQuery.isError ? (
            <p className="text-text-secondary px-1 text-xs">Could not load open requests.</p>
          ) : openRequestsQuery.data && !openRequestsQuery.data.ok ? (
            <p className="text-text-secondary px-1 text-xs">
              {openRequestsQuery.data.error?.message || 'Core open-requests view unavailable.'}
            </p>
          ) : openRequests.length === 0 ? (
            <p className="text-text-secondary px-1 text-xs">No open Core requests.</p>
          ) : (
            <ul className="space-y-1" data-testid="bh-open-requests-list">
              {openRequests.map((req) => {
                const bound = conversations.find((c) => c.request_id === req.request_id);
                const selected = selectedRequestId === req.request_id && routeConversationId === 'new';
                return (
                  <li key={req.request_id}>
                    <button
                      type="button"
                      data-testid={`bh-open-req-${req.request_id}`}
                      onClick={() => {
                        if (bound) {
                          openConversation(bound.id, { requestId: req.request_id });
                        } else {
                          openNewResearch({ requestId: req.request_id });
                        }
                        closeDrawerIfMobile();
                      }}
                      className={cn(
                        'hover:bg-surface-hover flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-start transition-colors',
                        selected && 'bg-surface-active-alt font-medium',
                      )}
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-xs">
                          <FolderGit2 className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
                          <span className="truncate font-mono">{req.request_id}</span>
                        </span>
                        <span className="text-text-tertiary shrink-0 text-[10px]">
                          {bound ? 'Bound' : 'No chat'}
                        </span>
                      </div>
                      {(req.question || req.original_task_text) && (
                        <span className="text-text-secondary line-clamp-2 ps-5 text-[11px]">
                          {req.question || req.original_task_text}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
});

export default BioHarnessSidebarSection;
