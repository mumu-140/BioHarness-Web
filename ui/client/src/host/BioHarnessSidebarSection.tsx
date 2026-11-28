/**
 * BioHarness workspace selector, @rc-component/tree Governance research hierarchy,
 * conversations list, and open requests seated inside LibreChat's adopted UnifiedSidebar
 * (not upstream LibreChat code).
 */
import React, { memo, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import Tree from '@rc-component/tree';
import type { DataNode, Key } from '@rc-component/tree/lib/interface';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Cpu,
  FolderGit2,
  FolderTree,
  MessageSquare,
  Plus,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react';
import { Button, Spinner } from '@librechat/client';
import useDrawerViewport from '~/hooks/Nav/useDrawerViewport';
import useSidebarToggle from '~/hooks/Nav/useSidebarToggle';
import { cn } from '~/utils';
import type {
  OpenRequestsData,
  Snapshot,
  TreeData,
  TreeScopeNode,
  WorkspaceConversation,
} from './bioharness';
import {
  bhKeys,
  extractOpenRequests,
  extractTreeProjects,
  extractTreeScopes,
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

export interface ResearchTreeEntry extends DataNode {
  key: string;
  nodeKind: 'scope' | 'request';
  scopeId?: string;
  requestId?: string;
  children?: ResearchTreeEntry[];
}

/** Projects Governance `views/tree` arbitrary-depth scope hierarchy into @rc-component/tree DataNodes. */
export function buildResearchTreeNodes(scopes: TreeScopeNode[]): {
  nodes: ResearchTreeEntry[];
  allScopeKeys: string[];
} {
  if (scopes.length === 0) {
    return { nodes: [], allScopeKeys: [] };
  }
  const byId = new Map<string, ResearchTreeEntry>();
  const allScopeKeys: string[] = [];

  for (const scope of scopes) {
    const key = `scope:${scope.scope_id}`;
    allScopeKeys.push(key);
    const reqChildren: ResearchTreeEntry[] = (scope.requests ?? []).map((req) => ({
      key: `req:${req.request_id}`,
      nodeKind: 'request',
      scopeId: scope.scope_id,
      requestId: req.request_id,
      isLeaf: true,
      title: (
        <span
          className="inline-flex min-w-0 items-center gap-1 font-mono text-[11px]"
          data-testid={`bh-tree-req-${req.request_id}`}
        >
          <span className="truncate">{req.request_id}</span>
          {req.request_status && (
            <span className="text-text-tertiary shrink-0 font-sans text-[10px]">
              ({req.request_status})
            </span>
          )}
        </span>
      ),
    }));
    const label = scope.title || scope.name || scope.scope_id;
    byId.set(scope.scope_id, {
      key,
      nodeKind: 'scope',
      scopeId: scope.scope_id,
      children: reqChildren,
      title: (
        <span
          className="inline-flex min-w-0 items-center gap-1 text-xs font-medium"
          data-testid={`bh-tree-scope-${scope.scope_id}`}
          title={scope.objective || label}
        >
          <span className="truncate">{label}</span>
          {typeof scope.request_count === 'number' && (
            <span className="text-text-tertiary shrink-0 text-[10px]">({scope.request_count})</span>
          )}
        </span>
      ),
    });
  }

  const roots: ResearchTreeEntry[] = [];
  for (const scope of scopes) {
    const entry = byId.get(scope.scope_id)!;
    const parentId = scope.parent_scope_id ?? (
      Array.isArray(scope.path) && scope.path.length > 1
        ? scope.path[scope.path.length - 2]
        : null
    );
    if (parentId && parentId !== scope.scope_id && byId.has(parentId)) {
      const parent = byId.get(parentId)!;
      parent.children = [...(parent.children ?? []), entry];
    } else {
      roots.push(entry);
    }
  }

  return { nodes: roots, allScopeKeys };
}

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
    selectedScopeId,
    linkedConversationId,
    selectWorkspace,
    selectScope,
    openConversation,
    openNewResearch,
    openWorkflowView,
    openModelSettings,
  } = useBioHarnessWorkspace();

  const runtimeEnabled = meta?.runtime?.enabled === true;
  const activeConversationId = routeConversationId ?? linkedConversationId;

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

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  useEffect(() => {
    setSelectedProjectId(null);
  }, [workspace]);

  const treeQuery = useQuery<Snapshot<TreeData>>({
    queryKey: bhKeys.view(
      service ?? 'svc',
      workspace ?? '',
      'tree',
      selectedProjectId ? { project_id: selectedProjectId } : {},
    ),
    queryFn: () =>
      fetchView<TreeData>(
        workspace!,
        'tree',
        selectedProjectId ? { project_id: selectedProjectId } : {},
      ),
    enabled: Boolean(service && workspace),
    staleTime: 20_000,
    refetchOnWindowFocus: false,
  });

  const conversations = conversationsQuery.data ?? [];
  const openRequests = extractOpenRequests(openRequestsQuery.data);
  const openListIncomplete = Boolean(openRequestsQuery.data?.data?.may_be_incomplete);
  const openListSourceMessage = openRequestsQuery.data?.data?.source_message ?? null;
  const treeProjects = useMemo(() => extractTreeProjects(treeQuery.data), [treeQuery.data]);
  const treeScopes = useMemo(() => extractTreeScopes(treeQuery.data), [treeQuery.data]);
  const { nodes: treeNodes, allScopeKeys } = useMemo(
    () => buildResearchTreeNodes(treeScopes),
    [treeScopes],
  );
  const treeGoalChanges = treeQuery.data?.ok ? (treeQuery.data.data?.goal_version_changes ?? []) : [];
  const treeRelatedLinks = treeQuery.data?.ok ? (treeQuery.data.data?.related_requests ?? []) : [];

  const [expandedKeys, setExpandedKeys] = useState<Key[]>([]);
  useEffect(() => {
    setExpandedKeys(allScopeKeys);
  }, [workspace, allScopeKeys.join('|')]);

  const selectedTreeKeys = useMemo<Key[]>(() => {
    if (selectedRequestId) {
      return [`req:${selectedRequestId}`];
    }
    if (selectedScopeId) {
      return [`scope:${selectedScopeId}`];
    }
    return [];
  }, [selectedRequestId, selectedScopeId]);

  const closeDrawerIfMobile = () => {
    if (isSmallScreen) {
      setSidebarOpen(false);
    }
  };

  const handleSelectRequest = (reqId: string, scopeId?: string | null) => {
    if (!runtimeEnabled) {
      openWorkflowView({ requestId: reqId, conversationId: null });
      closeDrawerIfMobile();
      return;
    }
    const existing = conversations.find((c) => c.request_id === reqId);
    if (existing) {
      openConversation(existing.id, { requestId: reqId, scopeId });
    } else {
      openNewResearch({ requestId: reqId, scopeId });
    }
    closeDrawerIfMobile();
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

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-0.5">
        {/* Governance Research Tree (@rc-component/tree 1.5.3) */}
        <section aria-label="Research tree" data-testid="bh-research-tree-section">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-text-tertiary inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide">
              <FolderTree className="h-3 w-3" aria-hidden="true" />
              Research tree
            </span>
            <button
              type="button"
              aria-label="Refresh research tree"
              onClick={() => void treeQuery.refetch()}
              className="text-text-tertiary hover:text-text-primary rounded p-0.5 transition-colors"
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
          {treeQuery.isLoading ? (
            <div className="text-text-tertiary px-2 py-1 text-xs">Loading tree…</div>
          ) : treeQuery.isError ? (
            <div className="text-text-destructive px-2 py-1 text-xs" role="alert">
              Research tree unavailable.
            </div>
          ) : treeNodes.length === 0 && treeProjects.length > 0 ? (
            <div
              className="border-border-light bg-surface-primary/40 space-y-1 rounded-lg border p-1.5 text-xs"
              data-testid="bh-project-list"
            >
              <div className="text-text-tertiary px-1 text-[10px]">
                Select a Governance project ({treeProjects.length})
              </div>
              <ul className="space-y-1">
                {treeProjects.map((proj) => (
                  <li key={proj.scope_id}>
                    <button
                      type="button"
                      data-testid={`bh-project-item-${proj.scope_id}`}
                      onClick={() => {
                        setSelectedProjectId(proj.scope_id);
                        selectScope(proj.scope_id);
                      }}
                      className="text-text-primary hover:bg-surface-hover flex w-full items-center justify-between gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors"
                      title={proj.objective || proj.scope_id}
                    >
                      <span className="truncate font-medium">
                        {proj.title || proj.name || proj.scope_id}
                      </span>
                      {typeof proj.request_count === 'number' && (
                        <span className="text-text-tertiary shrink-0 text-[10px]">
                          ({proj.request_count})
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : treeNodes.length === 0 ? (
            <div className="text-text-tertiary px-2 py-1 text-xs">No governance scopes recorded yet.</div>
          ) : (
            <div
              className="bh-rc-tree border-border-light bg-surface-primary/40 rounded-lg border px-1.5 py-1 text-xs"
              data-testid="bh-research-tree"
            >
              {selectedProjectId && (
                <div className="border-border-light mb-1 flex items-center justify-between gap-1 border-b pb-1 text-[11px]">
                  <span className="text-text-secondary truncate font-mono" title={selectedProjectId}>
                    {selectedProjectId}
                  </span>
                  <button
                    type="button"
                    data-testid="bh-projects-back-btn"
                    onClick={() => setSelectedProjectId(null)}
                    className="text-text-tertiary hover:text-text-primary shrink-0 rounded px-1 py-0.5 text-[10px] underline"
                  >
                    All projects
                  </button>
                </div>
              )}
              <Tree<ResearchTreeEntry>
                treeData={treeNodes}
                draggable={false}
                selectable={true}
                expandedKeys={expandedKeys}
                selectedKeys={selectedTreeKeys}
                onExpand={(keys) => setExpandedKeys(keys)}
                onSelect={(_keys, info) => {
                  const node = info.node as unknown as ResearchTreeEntry;
                  if (node.nodeKind === 'request' && node.requestId) {
                    handleSelectRequest(node.requestId, node.scopeId ?? null);
                  } else if (node.nodeKind === 'scope' && node.scopeId) {
                    selectScope(node.scopeId);
                  }
                }}
                switcherIcon={({ expanded, isLeaf }) => {
                  if (isLeaf) {
                    return <span className="inline-block w-3" />;
                  }
                  return expanded ? (
                    <ChevronDown className="text-text-tertiary inline h-3 w-3" aria-hidden="true" />
                  ) : (
                    <ChevronRight className="text-text-tertiary inline h-3 w-3" aria-hidden="true" />
                  );
                }}
                showIcon={false}
              />
              {(treeGoalChanges.length > 0 || treeRelatedLinks.length > 0) && (
                <div
                  data-testid="bh-tree-context-note"
                  className="text-text-tertiary border-border-light mt-1 border-t pt-1 text-[10px] leading-snug"
                >
                  {treeGoalChanges.length > 0 && (
                    <span>{treeGoalChanges.length} ancestor goal-version diff(s)</span>
                  )}
                  {treeGoalChanges.length > 0 && treeRelatedLinks.length > 0 && <span> · </span>}
                  {treeRelatedLinks.length > 0 && (
                    <span>{treeRelatedLinks.length} related link(s)</span>
                  )}
                  <span> — advisory context, not a gate.</span>
                </div>
              )}
            </div>
          )}
        </section>

        {/* Conversations */}
        {!runtimeEnabled && (
          <div
            data-testid="bh-runtime-unavailable"
            className="border-border-light bg-surface-primary/50 text-text-secondary rounded-lg border px-2.5 py-2 text-xs"
          >
            Native model runtime is disabled (read-only mode).
          </div>
        )}
        {runtimeEnabled && (
          <section aria-label="Conversations" data-testid="bh-conversations-section">
            <div className="mb-1 flex items-center justify-between px-1">
              <span className="text-text-tertiary text-[11px] font-semibold uppercase tracking-wide">
                Conversations ({conversations.length})
              </span>
              <button
                type="button"
                aria-label="Refresh conversations"
                onClick={() => void conversationsQuery.refetch()}
                className="text-text-tertiary hover:text-text-primary rounded p-0.5 transition-colors"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
              </button>
            </div>
            {conversationsQuery.isLoading ? (
              <div className="text-text-tertiary px-2 py-1 text-xs">Loading conversations…</div>
            ) : conversations.length === 0 ? (
              <div className="text-text-tertiary px-2 py-1 text-xs">No conversations yet.</div>
            ) : (
              <ul className="space-y-1" data-testid="bh-conversations-list">
                {conversations.map((convo) => {
                  const active = activeConversationId === convo.id;
                  const badge = convo.last_run_state ? RUN_BADGE[convo.last_run_state] : null;
                  return (
                    <li key={convo.id}>
                      <button
                        type="button"
                        data-testid={`bh-convo-item-${convo.id}`}
                        onClick={() => {
                          openConversation(convo.id, { requestId: convo.request_id });
                          closeDrawerIfMobile();
                        }}
                        className={cn(
                          'flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors',
                          active
                            ? 'bg-surface-hover text-text-primary font-medium'
                            : 'text-text-secondary hover:bg-surface-hover/60 hover:text-text-primary',
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-1.5">
                          <MessageSquare className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span className="truncate font-mono">
                            {convo.request_id || convo.id.slice(0, 10)}
                          </span>
                        </span>
                        {badge && (
                          <span
                            className={cn(
                              'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
                              badge.cls,
                            )}
                          >
                            {badge.label}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {/* Open Core Requests */}
        <section aria-label="Open requests" data-testid="bh-open-requests-section">
          <div className="mb-1 flex items-center justify-between px-1">
            <span className="text-text-tertiary text-[11px] font-semibold uppercase tracking-wide">
              Open requests ({openRequests.length})
            </span>
            <button
              type="button"
              aria-label="Refresh open requests"
              onClick={() => void openRequestsQuery.refetch()}
              className="text-text-tertiary hover:text-text-primary rounded p-0.5 transition-colors"
            >
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
          {openRequestsQuery.isLoading ? (
            <div className="text-text-tertiary px-2 py-1 text-xs">Loading open requests…</div>
          ) : openRequestsQuery.isError ? (
            <div className="text-text-destructive px-2 py-1 text-xs" role="alert">
              Open requests unavailable.
            </div>
          ) : openRequests.length === 0 ? (
            <div className="text-text-tertiary px-2 py-1 text-xs" data-testid="bh-open-requests-list">No open requests in workspace.</div>
          ) : (
            <ul className="space-y-1" data-testid="bh-open-requests-list">
              {openRequests.map((req) => {
                const selected = selectedRequestId === req.request_id;
                const boundConvo = conversations.find((c) => c.request_id === req.request_id);
                return (
                  <li key={req.request_id}>
                    <button
                      type="button"
                      data-testid={`bh-open-req-${req.request_id}`}
                      onClick={() => handleSelectRequest(req.request_id, req.scope_id ?? null)}
                      className={cn(
                        'flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left text-xs transition-colors',
                        selected
                          ? 'bg-surface-hover text-text-primary'
                          : 'text-text-secondary hover:bg-surface-hover/60 hover:text-text-primary',
                      )}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="inline-flex min-w-0 items-center gap-1 font-mono font-medium">
                          <FolderGit2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span className="truncate">{req.request_id}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          {!req.scope_id && (
                            <span
                              data-testid={`bh-open-req-unscoped-${req.request_id}`}
                              className="bg-surface-hover text-text-tertiary rounded px-1 text-[10px]"
                            >
                              unscoped
                            </span>
                          )}
                          {!boundConvo && (
                            <span className="text-text-tertiary text-[10px]">unbound</span>
                          )}
                        </span>
                      </div>
                      {(req.question || req.original_task_text) && (
                        <span className="text-text-tertiary line-clamp-2 text-[11px]">
                          {req.question || req.original_task_text}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {openListIncomplete && (
            <div
              data-testid="bh-open-list-incomplete"
              className="text-text-tertiary mt-1 px-1 text-[10px] leading-snug"
            >
              Open request list may be incomplete.
              {openListSourceMessage ? ` Core: ${openListSourceMessage}` : ''}
            </div>
          )}
        </section>
      </div>
    </div>
  );
});

export default BioHarnessSidebarSection;
