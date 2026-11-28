/**
 * Independent request/conversation execution records and module discovery view, following
 * dsh-context pulseEvents/pulseSelection filtering & calm inspection presentation
 * (not upstream LibreChat code).
 *
 * Queries `GET .../invocations` (cursor-paginated) and `GET .../modules` directly, completely
 * independent of whether the Conversation component is mounted.
 */
import React, { memo, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Activity, ArrowLeft, Cpu, RefreshCw, Search } from 'lucide-react';
import { Button, Spinner } from '@librechat/client';
import type {
  InvocationItem,
  InvocationsResponse,
  ModulesResponse,
  WorkspaceConversation,
} from './bioharness';
import { bhKeys, fetchConversations, fetchInvocations, fetchModules } from './bioharness';
import { useBioHarnessWorkspace } from './workspace';
import { formatOpKindLabel, formatOpStateLabel, useBhText } from './i18n';
import { assertObservationOwner, resolveBoundConversation } from './scientificViews';
import { useBioHarnessConversationEvents } from './events';
import BioHarnessRequestHeader from './BioHarnessRequestHeader';

const KIND_OPTIONS = ['all', 'core', 'hook', 'model', 'tool'] as const;
const STATE_OPTIONS = ['all', 'STARTED', 'SUCCEEDED', 'REFUSED', 'FAILED', 'UNKNOWN', 'CANCELLED'] as const;

const STATE_BADGE: Record<string, string> = {
  SUCCEEDED: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  STARTED: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  REFUSED: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  UNKNOWN: 'bg-amber-500/20 text-amber-800 dark:text-amber-200',
  CANCELLED: 'bg-surface-hover text-text-secondary',
  FAILED: 'bg-red-500/15 text-red-700 dark:text-red-300',
};

function isOmittedPayload(value: unknown): value is { omitted: true; characters: number; head: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).omitted === true &&
    typeof (value as Record<string, unknown>).characters === 'number'
  );
}

/** Per AGENTS.md: collapse raw IDs/JSON by default, auto-expanding on failure, UNKNOWN, or partial/omitted payloads. */
export function shouldAutoExpandExecutionDetails(item: InvocationItem): boolean {
  return (
    item.state === 'FAILED' ||
    item.state === 'UNKNOWN' ||
    item.state === 'REFUSED' ||
    Boolean(item.error) ||
    isOmittedPayload(item.input) ||
    isOmittedPayload(item.output)
  );
}

function PayloadBlock({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) {
    return (
      <div className="text-xs">
        <div className="text-text-tertiary font-semibold uppercase">{label}</div>
        <p className="text-text-tertiary mt-0.5 italic">Not recorded / empty</p>
      </div>
    );
  }
  if (isOmittedPayload(value)) {
    return (
      <div className="text-xs" data-testid={`bh-omitted-${label.toLowerCase()}`}>
        <div className="text-text-tertiary font-semibold uppercase">{label}</div>
        <div className="mt-1 rounded-lg border border-amber-400/60 bg-amber-50/70 p-2 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
          <p className="font-medium">
            Omitted by host ({value.characters.toLocaleString()} characters total — remainder unknown)
          </p>
          {value.head && (
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px]">
              {value.head}
            </pre>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="text-xs">
      <div className="text-text-tertiary font-semibold uppercase">{label}</div>
      <pre className="bg-surface-secondary mt-1 max-h-72 overflow-auto rounded-lg p-2.5 font-mono text-[11px] whitespace-pre-wrap">
        {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

const BioHarnessExecutionsRoute = memo(function BioHarnessExecutionsRoute() {
  const { zh, tr } = useBhText();
  const { meta, service, workspace, selectedRequestId, linkedConversationId } =
    useBioHarnessWorkspace();
  const runtimeEnabled = meta?.runtime?.enabled === true;

  const conversationsQuery = useQuery<WorkspaceConversation[]>({
    queryKey: bhKeys.conversations(service ?? 'svc', workspace ?? ''),
    queryFn: () => fetchConversations(workspace!),
    enabled: Boolean(service && workspace && runtimeEnabled),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  const conversation = resolveBoundConversation(conversationsQuery.data, workspace,
    selectedRequestId, linkedConversationId);
  const resolvedConversationId = conversation?.id ?? null;
  const identity = JSON.stringify([service, workspace, selectedRequestId, resolvedConversationId]);
  const bindingProblem = Boolean(linkedConversationId && !conversation && !conversationsQuery.isLoading);
  const pagesQuery = useInfiniteQuery<InvocationsResponse>({
    queryKey: [...bhKeys.invocations(service ?? 'svc', workspace ?? '', resolvedConversationId ?? ''),
      conversation?.request_id],
    queryFn: async ({ pageParam = null }) => assertObservationOwner(
      await fetchInvocations(workspace!, conversation!.id, { limit: 25, before: pageParam }),
      service!, workspace!, conversation!),
    getNextPageParam: (last) => last.next_before ?? undefined,
    enabled: Boolean(service && workspace && conversation && runtimeEnabled),
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });
  const firstPageQuery = { ...pagesQuery, data: pagesQuery.data?.pages[0] };
  const pages = pagesQuery.data?.pages ?? [];
  const nextCursor = pagesQuery.hasNextPage ? (pages[pages.length - 1]?.next_before ?? null) : null;
  const loadingMore = pagesQuery.isFetchingNextPage;
  const loadMoreError = pagesQuery.isError && pages.length > 0 ? (pagesQuery.error as Error)?.message : null;
  const modulesQuery = useQuery<ModulesResponse>({
    queryKey: [...bhKeys.modules(service ?? 'svc', workspace ?? '', resolvedConversationId ?? ''),
      conversation?.request_id],
    queryFn: async () => assertObservationOwner(await fetchModules(workspace!, conversation!.id),
      service!, workspace!, conversation!),
    enabled: Boolean(service && workspace && conversation && runtimeEnabled),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });
  // Existing conversation events refresh observations even when chat is not mounted.
  const executionLog = useBioHarnessConversationEvents(service, runtimeEnabled ? workspace : null,
    runtimeEnabled ? resolvedConversationId : null);

  const [kindFilter, setKindFilter] = useState<string>('all');
  const [stateFilter, setStateFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selection, setSelection] = useState<{ identity: string; id: string } | null>(null);
  const selectedId = selection?.identity === identity ? selection.id : null;
  const setSelectedId = (id: string | null) => setSelection(id ? { identity, id } : null);

  const allLoadedItems = useMemo(() => {
    const seen = new Set<string>();
    return (pagesQuery.data?.pages ?? []).flatMap((p) => p.items).filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [pagesQuery.data]);

  const filteredItems = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allLoadedItems.filter((item) => {
      if (kindFilter !== 'all' && item.kind !== kindFilter) return false;
      if (stateFilter !== 'all' && item.state !== stateFilter) return false;
      if (needle) {
        const hay = `${item.name} ${item.kind} ${item.state} ${item.server ?? ''} ${item.run_id}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [allLoadedItems, kindFilter, stateFilter, search]);

  const selectedItem = useMemo(
    () => (selectedId ? allLoadedItems.find((item) => item.id === selectedId) ?? null : null),
    [selectedId, allLoadedItems],
  );

  const handleLoadOlder = async () => {
    if (pagesQuery.hasNextPage && !pagesQuery.isFetching) {
      await pagesQuery.fetchNextPage();
    }
  };

  return (
    <main
      className="bg-surface-canvas flex h-full min-h-0 w-full flex-col overflow-hidden"
      role="main"
      data-testid="bh-executions-route"
    >
      <BioHarnessRequestHeader
        activeTab="executions"
        requestId={conversation?.request_id ?? selectedRequestId}
        conversationId={resolvedConversationId}
        sseConnected={executionLog.connected}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {bindingProblem && <p role="alert" className="p-3 text-xs">
          The requested conversation is not verified for this workspace/request. Select the correct
          conversation from the sidebar. Existing research runs are not interrupted.
        </p>}
        <div className="mx-auto w-full max-w-5xl space-y-4">
          {!runtimeEnabled ? (
            <div className="border-border-light bg-surface-primary/60 rounded-xl border p-6 text-center text-sm">
              Native runtime is disabled; no host execution ledger is active.
            </div>
          ) : !resolvedConversationId ? (
            <div
              data-testid="bh-executions-empty"
              className="border-border-light bg-surface-primary/60 rounded-xl border p-6 text-center text-sm"
            >
              Select a conversation from the sidebar to inspect its observed execution records.
            </div>
          ) : selectedItem ? (
            /* Single invocation detail subpage (replaces list for focused inspection) */
            <section data-testid="bh-execution-detail" className="space-y-4">
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="bh-back-to-executions-btn"
                onClick={() => setSelectedId(null)}
                className="gap-1.5 text-xs"
              >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Back to execution records</span>
              </Button>

              <div className="border-border-light bg-surface-primary space-y-4 rounded-xl border p-4">
                <div className="border-border-light flex flex-wrap items-center justify-between gap-2 border-b pb-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-text-primary font-mono text-base font-semibold">
                        {selectedItem.name}
                      </h1>
                      <span className="bg-surface-hover text-text-secondary rounded px-2 py-0.5 text-xs">
                        {formatOpKindLabel(selectedItem.kind, zh)}
                      </span>
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${
                          STATE_BADGE[selectedItem.state] ?? 'bg-surface-hover text-text-secondary'
                        }`}
                      >
                        {formatOpStateLabel(selectedItem.state, zh)}
                      </span>
                    </div>
                  </div>
                  <div className="text-text-tertiary text-right font-mono text-[11px]">
                    <div>Started: {selectedItem.started_at}</div>
                    <div>Ended: {selectedItem.ended_at ?? 'In progress / unrecorded'}</div>
                  </div>
                </div>

                {selectedItem.note && (
                  <p className="text-text-secondary text-xs">{selectedItem.note}</p>
                )}

                <details
                  key={selectedItem.id}
                  data-testid="bh-exec-tech-details"
                  open={shouldAutoExpandExecutionDetails(selectedItem)}
                  className="border-border-light bg-surface-secondary/30 rounded-lg border p-3"
                >
                  <summary className="text-text-secondary cursor-pointer select-none text-xs font-medium">
                    Technical details (raw operation IDs &amp; redacted JSON payloads)
                  </summary>
                  <div className="mt-3 space-y-3">
                    <p className="text-text-tertiary font-mono text-[11px]">
                      op={selectedItem.id} · run={selectedItem.run_id}
                      {selectedItem.server ? ` · server=${selectedItem.server}` : ''}
                      {selectedItem.initiator ? ` · initiator=${selectedItem.initiator}` : ''}
                    </p>
                    <PayloadBlock label="Input" value={selectedItem.input} />
                    <PayloadBlock label="Output" value={selectedItem.output} />
                    {selectedItem.error && <PayloadBlock label="Error" value={selectedItem.error} />}
                    {selectedItem.details && Object.keys(selectedItem.details).length > 0 && (
                      <PayloadBlock label="Details" value={selectedItem.details} />
                    )}
                  </div>
                </details>
              </div>
            </section>
          ) : (
            <>
              {/* Header + Refresh */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h1 className="text-text-primary flex items-center gap-1.5 text-base font-semibold">
                    <Activity className="h-4 w-4" aria-hidden="true" />
                    <span>Observed execution records</span>
                  </h1>
                  <p className="text-text-tertiary text-xs">
                    {firstPageQuery.data?.note ??
                      'Technical host observations only; not scientific validation. Missing/omitted payloads remain unknown.'}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="bh-executions-refresh-btn"
                  onClick={() => {
                    void firstPageQuery.refetch();
                    void modulesQuery.refetch();
                  }}
                  className="gap-1.5 text-xs"
                >
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Refresh</span>
                </Button>
              </div>

              {/* Filter controls (dsh-context pulseEvents style pills + search) */}
              <div className="border-border-light bg-surface-primary/60 flex flex-wrap items-center gap-2 rounded-xl border p-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by kind">
                  {KIND_OPTIONS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      data-testid={`bh-exec-kind-${k}`}
                      onClick={() => setKindFilter(k)}
                      className={`rounded-md px-2 py-0.5 font-medium transition-colors ${
                        kindFilter === k
                          ? 'bg-surface-hover text-text-primary'
                          : 'text-text-tertiary hover:text-text-primary'
                      }`}
                    >
                      {k}
                    </button>
                  ))}
                </div>

                <select
                  aria-label="Filter by state"
                  data-testid="bh-exec-state-select"
                  value={stateFilter}
                  onChange={(e) => setStateFilter(e.target.value)}
                  className="border-border-medium bg-surface-primary text-text-primary rounded-md border px-2 py-1 text-xs"
                >
                  {STATE_OPTIONS.map((st) => (
                    <option key={st} value={st}>
                      {tr(`状态：${formatOpStateLabel(st, true)}`, `State: ${st}`)}
                    </option>
                  ))}
                </select>

                <div className="relative min-w-[160px] flex-1">
                  <Search
                    className="text-text-tertiary pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
                    aria-hidden="true"
                  />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter loaded records…"
                    aria-label="Filter loaded execution records"
                    data-testid="bh-exec-search"
                    className="border-border-medium bg-surface-primary text-text-primary w-full rounded-md border py-1 pl-7 pr-2 text-xs"
                  />
                </div>

                <span className="text-text-tertiary text-[11px]" data-testid="bh-exec-page-disclosure">
                  Showing {filteredItems.length} of {allLoadedItems.length} loaded
                  {firstPageQuery.isError ? ' (refresh unavailable)' : nextCursor !== null ? ' (more older records available)' : firstPageQuery.data ? ' (all loaded)' : ' (not yet confirmed)'}
                </span>
              </div>

              {firstPageQuery.isError && allLoadedItems.length > 0 && (
                <p role="alert" className="text-xs">Execution refresh unavailable; showing last loaded observations.</p>
              )}
              {firstPageQuery.isLoading ? (
                <div className="text-text-secondary flex items-center gap-2 py-6 text-sm">
                  <Spinner className="h-4 w-4" />
                  <span>Loading execution records…</span>
                </div>
              ) : firstPageQuery.isError && allLoadedItems.length === 0 ? (
                <div role="alert" className="border-status-error-border bg-status-error-subtle rounded-xl border p-3 text-xs">
                  {(firstPageQuery.error as Error)?.message || 'Failed to load execution records.'}
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="border-border-light bg-surface-primary/50 text-text-secondary rounded-xl border p-6 text-center text-xs">
                  No execution records match the current filter.
                </div>
              ) : (
                <ul className="space-y-1.5" data-testid="bh-executions-list">
                  {filteredItems.map((item) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        data-testid={`bh-exec-row-${item.id}`}
                        onClick={() => setSelectedId(item.id)}
                        className="border-border-light bg-surface-primary hover:bg-surface-hover/50 flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-colors"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="bg-surface-hover text-text-secondary shrink-0 rounded px-1.5 py-0.5 text-[10px]">
                            {formatOpKindLabel(item.kind, zh)}
                          </span>
                          <span className="text-text-primary truncate font-mono font-medium">
                            {item.name}
                          </span>
                          {item.server && (
                            <span className="text-text-tertiary truncate text-[11px]">
                              @{item.server}
                            </span>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                              STATE_BADGE[item.state] ?? 'bg-surface-hover text-text-secondary'
                            }`}
                          >
                            {formatOpStateLabel(item.state, zh)}
                          </span>
                          <span className="text-text-tertiary font-mono text-[10px]">
                            {item.started_at}
                          </span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {loadMoreError && (
                <div role="alert" className="text-text-destructive text-xs">
                  {loadMoreError}
                </div>
              )}

              {nextCursor !== null && (
                <div className="flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="bh-exec-load-older-btn"
                    disabled={pagesQuery.isFetching}
                    onClick={() => void handleLoadOlder()}
                    className="text-xs"
                  >
                    {loadingMore ? 'Loading older records…' : 'Load older records'}
                  </Button>
                </div>
              )}

              {/* Configured module discovery summary */}
              {modulesQuery.isError && <p role="alert" className="text-xs">
                Module observations unavailable; this does not establish that modules were unused.
              </p>}
              {modulesQuery.data && (
                <section
                  data-testid="bh-modules-section"
                  className="border-border-light bg-surface-primary/50 space-y-2 rounded-xl border p-3 text-xs"
                >
                  <div className="flex items-center gap-1.5 font-semibold">
                    <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Configured module tool servers ({modulesQuery.data.servers.length})</span>
                  </div>
                  <p className="text-text-tertiary text-[11px]">{modulesQuery.data.note}</p>
                  {modulesQuery.data.servers.length === 0 ? (
                    <p className="text-text-tertiary">No external module tool servers configured.</p>
                  ) : (
                    <ul className="space-y-1">
                      {modulesQuery.data.servers.map((srv) => (
                        <li
                          key={srv.server}
                          className="border-border-light bg-surface-primary flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5"
                        >
                          <span className="font-mono font-medium">{srv.server}</span>
                          <span className="text-text-secondary">
                            {srv.state}
                            {srv.offered_tools ? ` · ${srv.offered_tools.length} tools` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
});

export default BioHarnessExecutionsRoute;
