import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import { type ApiError, getJson, invocationsUrl } from "../api/client";
import type { InvocationItem, InvocationsResponse } from "../api/types";
import type { ConversationLog } from "./useConversationEvents";

const PAGE_LIMIT = 50;

export interface InvocationsProjection {
  response: InvocationsResponse | undefined;
  items: InvocationItem[];
  nextBefore: number | null;
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  error: ApiError | undefined;
  loadMoreError: string | null;
  loadMore(): Promise<void>;
  refresh(): Promise<void>;
}

/**
 * Paginated invocation observation projection (`GET .../invocations`) reconciled by
 * operation id on live SSE events and stream reconnects. Items are returned newest-first
 * from the backend; this hook preserves stable cursor order while keeping in-flight
 * items updated across loaded pages.
 */
export default function useInvocations(
  workspace: string,
  conversationId: string | null,
  enabled: boolean,
  log: ConversationLog,
): InvocationsProjection {
  const { mutate } = useSWRConfig();
  const key =
    enabled && conversationId
      ? invocationsUrl(workspace, conversationId, { limit: PAGE_LIMIT })
      : null;

  const first = useSWR<InvocationsResponse, ApiError>(key, getJson, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    onError: (err) => {
      if (err.status === 401) void mutate("/api/meta");
    },
  });

  const [extraPages, setExtraPages] = useState<
    Array<{ before: number; response: InvocationsResponse }>
  >([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  useEffect(() => {
    setExtraPages([]);
    setLoadingMore(false);
    setLoadMoreError(null);
  }, [workspace, conversationId, enabled]);

  const extraPagesRef = useRef(extraPages);
  extraPagesRef.current = extraPages;

  const reconcileOlderStartedPages = useCallback(
    async (finishedIds?: Set<string>) => {
      if (!enabled || !conversationId) return;
      const targets = extraPagesRef.current.filter((page) =>
        page.response.items.some(
          (item) =>
            item.state === "STARTED" &&
            (!finishedIds || finishedIds.has(item.id)),
        ),
      );
      if (targets.length === 0) return;
      const refreshed = await Promise.all(
        targets.map(async (page) => {
          try {
            const next = await getJson<InvocationsResponse>(
              invocationsUrl(workspace, conversationId, {
                limit: PAGE_LIMIT,
                before: page.before,
              }),
            );
            return { before: page.before, response: next };
          } catch (err) {
            const apiErr = err as ApiError;
            if (apiErr?.status === 401) void mutate("/api/meta");
            return page;
          }
        }),
      );
      setExtraPages((prev) =>
        prev.map(
          (page) => refreshed.find((entry) => entry.before === page.before) ?? page,
        ),
      );
    },
    [enabled, conversationId, workspace, mutate],
  );

  const seenSeq = useRef(0);
  const seenConnectSeq = useRef(0);
  useEffect(() => {
    seenSeq.current = 0;
    seenConnectSeq.current = 0;
  }, [workspace, conversationId]);

  const lastSeq = log.events.length
    ? (log.events[log.events.length - 1].seq as number)
    : 0;

  useEffect(() => {
    if (!key) return;
    if (lastSeq < seenSeq.current) seenSeq.current = 0;
    const fresh = log.events.filter((e) => (e.seq ?? 0) > seenSeq.current);
    seenSeq.current = lastSeq;

    const reconnected =
      log.connectSeq > seenConnectSeq.current && seenConnectSeq.current > 0;
    seenConnectSeq.current = log.connectSeq;

    const hasLifecycleEvent = fresh.some(
      (e) =>
        e.type === "operation.started" ||
        e.type === "operation.finished" ||
        e.type === "run.started" ||
        e.type === "run.finished",
    );

    if (hasLifecycleEvent || reconnected) {
      void first.mutate();
      const finishedIds = new Set<string>();
      for (const event of fresh) {
        if (
          event.type === "operation.finished" &&
          typeof event.data.operation_id === "string"
        ) {
          finishedIds.add(event.data.operation_id);
        }
      }
      const needsAllStarted =
        reconnected || fresh.some((e) => e.type === "run.finished");
      if (needsAllStarted || finishedIds.size > 0) {
        void reconcileOlderStartedPages(needsAllStarted ? undefined : finishedIds);
      }
    }
  }, [key, lastSeq, log.events, log.connectSeq, first, reconcileOlderStartedPages]);

  const refresh = useCallback(async () => {
    if (!key) return;
    await first.mutate();
    await reconcileOlderStartedPages(undefined);
  }, [key, first, reconcileOlderStartedPages]);

  const nextBefore = useMemo(() => {
    if (extraPages.length > 0) {
      return extraPages[extraPages.length - 1].response.next_before;
    }
    return first.data?.next_before ?? null;
  }, [first.data, extraPages]);

  const loadMore = useCallback(async () => {
    if (!enabled || !conversationId || nextBefore === null || loadingMore) return;
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const response = await getJson<InvocationsResponse>(
        invocationsUrl(workspace, conversationId, {
          limit: PAGE_LIMIT,
          before: nextBefore,
        }),
      );
      setExtraPages((prev) => {
        if (prev.some((p) => p.before === nextBefore)) return prev;
        return [...prev, { before: nextBefore, response }];
      });
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr?.status === 401) void mutate("/api/meta");
      setLoadMoreError(
        (apiErr?.code ? apiErr.code + ":" : "") +
          (apiErr?.message ?? "加载更早调用记录失败"),
      );
    } finally {
      setLoadingMore(false);
    }
  }, [enabled, conversationId, nextBefore, loadingMore, workspace, mutate]);

  const items = useMemo(() => {
    const byId = new Map<string, InvocationItem>();
    // Older pages first, then page 1 overrides so latest page always wins for any shifted/updated operation id.
    for (let i = extraPages.length - 1; i >= 0; i -= 1) {
      for (const item of extraPages[i].response.items) {
        byId.set(item.id, item);
      }
    }
    for (const item of first.data?.items ?? []) {
      byId.set(item.id, item);
    }
    return [...byId.values()].sort((a, b) => b.cursor - a.cursor);
  }, [first.data, extraPages]);

  return {
    response: first.data,
    items,
    nextBefore,
    loading: Boolean(key && !first.data && first.isLoading),
    loadingMore,
    refreshing: Boolean(key && first.isValidating),
    error: first.error,
    loadMoreError,
    loadMore,
    refresh,
  };
}
