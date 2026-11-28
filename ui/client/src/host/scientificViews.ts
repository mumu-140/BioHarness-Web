/** Source-backed selection and paging for the adopted scientific views. */
import { useInfiniteQuery } from '@tanstack/react-query';
import type { AttemptRecord, RoutesData, Snapshot, WorkspaceConversation } from './bioharness';
import { bhKeys, fetchView } from './bioharness';

export function resolveBoundConversation(
  conversations: WorkspaceConversation[] | undefined,
  workspace: string | null,
  requestId: string | null,
  explicitId: string | null,
): WorkspaceConversation | null {
  const matches = (conversations ?? []).filter((c) =>
    c.workspace === workspace &&
    (explicitId ? c.id === explicitId : requestId !== null) &&
    (requestId === null || c.request_id === requestId),
  );
  return matches.length === 1 ? matches[0] : null;
}

export function assertObservationOwner<T extends {
  service: string;
  workspace: string;
  request_id: string | null;
  conversation_id: string;
}>(value: T, service: string, workspace: string, conversation: WorkspaceConversation): T {
  if (value.service !== service || value.workspace !== workspace ||
      value.conversation_id !== conversation.id || value.request_id !== conversation.request_id) {
    throw new Error('Execution response does not match the selected scientific conversation.');
  }
  return value;
}

export function matchesSnapshot<T>(
  snapshot: Snapshot<T> | undefined,
  service: string | null,
  workspace: string | null,
): snapshot is Snapshot<T> {
  return Boolean(snapshot && snapshot.service === service && snapshot.workspace === workspace);
}

export function isCurrentPlanAttempt(attempt: AttemptRecord, version: number | undefined): boolean {
  return typeof version === 'number' && attempt.plan_version === version;
}

export function nextRouteOffset(page: Snapshot<RoutesData>): number | undefined {
  const data = page.data;
  if (!page.ok || !data || !data.attempts.length ||
      typeof data.offset !== 'number' || typeof data.attempt_count !== 'number') return undefined;
  const next = data.offset + data.attempts.length;
  return next < data.attempt_count ? next : undefined;
}

export function useScientificRoutePages(
  service: string | null,
  workspace: string | null,
  scopeId: string | null,
  enabled = true,
) {
  const query = useInfiniteQuery<Snapshot<RoutesData>>({
    queryKey: [...bhKeys.viewRoot(service ?? 'svc', workspace ?? ''), 'routes-pages', scopeId],
    queryFn: async ({ pageParam = 0 }) => {
      const page = await fetchView<RoutesData>(workspace!, 'routes', {
        scope_id: scopeId!, offset: pageParam, limit: 100,
      });
      if (!matchesSnapshot(page, service, workspace) || !page.ok ||
          page.data?.scope_id !== scopeId) {
        throw new Error(page.error?.message ?? 'Route history unavailable or response identity mismatched.');
      }
      if (typeof page.data.offset === 'number' && page.data.offset !== pageParam) {
        throw new Error('Route history page offset mismatch.');
      }
      return page;
    },
    getNextPageParam: nextRouteOffset,
    enabled: Boolean(service && workspace && scopeId && enabled),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
  const pages = query.data?.pages ?? [];
  const first = pages[0]?.data;
  const attempts = pages.flatMap((page) => page.data?.attempts ?? []);
  const unique = Array.from(new Map(attempts.map((a) =>
    [JSON.stringify([a.request_id, a.submission_index]), a])).values());
  const partial = Boolean(first && (pages.some((p) => p.shortened) ||
    typeof first.attempt_count !== 'number' || unique.length < first.attempt_count ||
    pages.some((p) => p.data?.attempt_count !== first.attempt_count)));
  const data = first ? { ...first, attempts: unique } : null;
  return { ...query, routesData: data, partial, confirmed: Boolean(data) && !query.isError && !partial };
}
