import { useEffect, useRef } from "react";
import useSWR, { useSWRConfig } from "swr";

import { type ApiError, getJson, modulesUrl } from "../api/client";
import type { ModulesResponse } from "../api/types";
import type { ConversationLog } from "./useConversationEvents";

export interface ModulesProjection {
  response: ModulesResponse | undefined;
  loading: boolean;
  refreshing: boolean;
  error: ApiError | undefined;
  refresh(): Promise<void>;
}

/**
 * Last observed MCP tool server discovery projection (`GET .../modules`).
 * Refreshes whenever `module.discovery`, `run.started`, `run.finished`, or SSE
 * reconnect occurs. Never requested when runtime is disabled or before a
 * conversation exists.
 */
export default function useModules(
  workspace: string,
  conversationId: string | null,
  enabled: boolean,
  log: ConversationLog,
): ModulesProjection {
  const { mutate } = useSWRConfig();
  const key = enabled && conversationId ? modulesUrl(workspace, conversationId) : null;

  const query = useSWR<ModulesResponse, ApiError>(key, getJson, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    onError: (err) => {
      if (err.status === 401) void mutate("/api/meta");
    },
  });

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

    const hasModuleEvent = fresh.some(
      (e) =>
        e.type === "module.discovery" ||
        e.type === "run.started" ||
        e.type === "run.finished",
    );

    if (hasModuleEvent || reconnected) {
      void query.mutate();
    }
  }, [key, lastSeq, log.events, log.connectSeq, query]);

  return {
    response: query.data,
    loading: Boolean(key && !query.data && query.isLoading),
    refreshing: Boolean(key && query.isValidating),
    error: query.error,
    refresh: async () => {
      if (key) await query.mutate();
    },
  };
}
