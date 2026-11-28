/**
 * Authoritative server SSE subscriptions for BioHarness conversations and workspace snapshots
 * (not upstream LibreChat code).
 *
 * Closing or unmounting these hooks closes only the browser's EventSource subscription;
 * backend runs continue undisturbed until finished or explicitly cancelled.
 */
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ConversationEvent } from './bioharness';
import { bhKeys, conversationsPath } from './bioharness';

const EVENT_TYPES = [
  'user.message',
  'assistant.text',
  'assistant.delta',
  'operation.started',
  'operation.finished',
  'notice',
  'run.started',
  'run.finished',
  'run.cancel_requested',
  'module.discovery',
] as const;

export interface ConversationEventLog {
  events: ConversationEvent[];
  /** Live streamed tokens (`seq === null`), cleared once recorded `assistant.text` or run end lands. */
  draft: string;
  connected: boolean;
  connectSeq: number;
}

interface ScopedEventState {
  ownerKey: string | null;
  log: ConversationEventLog;
}

const EMPTY_LOG: ConversationEventLog = {
  events: [],
  draft: '',
  connected: false,
  connectSeq: 0,
};

function makeOwnerKey(service: string | null, workspace: string | null, conversationId: string | null): string | null {
  return service && workspace && conversationId ? JSON.stringify([service, workspace, conversationId]) : null;
}

export function useBioHarnessConversationEvents(
  service: string | null,
  workspace: string | null,
  conversationId: string | null,
): ConversationEventLog {
  const queryClient = useQueryClient();
  const ownerKey = makeOwnerKey(service, workspace, conversationId);
  const [scoped, setScoped] = useState<ScopedEventState>({ ownerKey, log: EMPTY_LOG });
  const processedRef = useRef<{ ownerKey: string | null; seq: number }>({
    ownerKey: null,
    seq: 0,
  });

  useEffect(() => {
    processedRef.current = { ownerKey, seq: 0 };
    if (!workspace || !conversationId || !ownerKey) {
      setScoped({ ownerKey: null, log: EMPTY_LOG });
      return;
    }

    let closed = false;
    setScoped({ ownerKey, log: EMPTY_LOG });

    const url = conversationsPath(workspace, `/${encodeURIComponent(conversationId)}/events`);
    const source = new EventSource(url);

    source.onopen = () => {
      if (closed) {
        return;
      }
      if (service) {
        void queryClient.invalidateQueries({ queryKey: bhKeys.invocations(service, workspace, conversationId) }, { cancelRefetch: false });
        void queryClient.invalidateQueries({ queryKey: bhKeys.modules(service, workspace, conversationId) }, { cancelRefetch: false });
      }
      setScoped((prev) => {
        if (prev.ownerKey !== ownerKey) {
          return prev;
        }
        return {
          ownerKey,
          log: {
            ...prev.log,
            connected: true,
            connectSeq: prev.log.connectSeq + 1,
            /* Drop transient unrecorded delta on reconnect so replay doesn't duplicate text. */
            draft: !prev.log.connected && prev.log.events.length > 0 ? '' : prev.log.draft,
          },
        };
      });
    };

    source.onerror = () => {
      if (closed) {
        return;
      }
      setScoped((prev) => {
        if (prev.ownerKey !== ownerKey) {
          return prev;
        }
        return {
          ownerKey,
          log: { ...prev.log, connected: false },
        };
      });
    };

    /* Server explicitly resets cursor when the backing log was replaced. */
    source.addEventListener('stream.reset', () => {
      if (closed) {
        return;
      }
      processedRef.current = { ownerKey, seq: 0 };
      setScoped((prev) => {
        if (prev.ownerKey !== ownerKey) {
          return prev;
        }
        return {
          ownerKey,
          log: {
            ...EMPTY_LOG,
            connected: true,
            connectSeq: prev.log.connectSeq + 1,
          },
        };
      });
    });

    const handleEvent = (message: MessageEvent) => {
      if (closed) {
        return;
      }
      let event: ConversationEvent;
      try {
        event = JSON.parse(String(message.data)) as ConversationEvent;
      } catch {
        return;
      }
      /* Strict session-identity isolation: drop any payload targeting another conversation. */
      if (
        typeof event.conversation_id === 'string' &&
        event.conversation_id.length > 0 &&
        event.conversation_id !== conversationId
      ) {
        return;
      }

      setScoped((prev) => {
        if (prev.ownerKey !== ownerKey) {
          return prev;
        }
        const state = prev.log;
        if (event.seq === null) {
          return {
            ownerKey,
            log: {
              ...state,
              connected: true,
              draft: state.draft + String(event.data?.text ?? ''),
            },
          };
        }
        const last = state.events.length
          ? (state.events[state.events.length - 1].seq as number)
          : 0;
        if (event.seq <= last) {
          return prev;
        }
        const clearDraft =
          event.type === 'assistant.text' ||
          event.type === 'run.finished' ||
          (event.type === 'operation.finished' && event.data?.kind === 'model');
        return {
          ownerKey,
          log: {
            ...state,
            events: [...state.events, event],
            connected: true,
            draft: clearDraft ? '' : state.draft,
          },
        };
      });
    };

    for (const type of EVENT_TYPES) {
      source.addEventListener(type, handleEvent);
    }

    return () => {
      closed = true;
      source.close();
    };
  }, [service, workspace, conversationId, ownerKey, queryClient]);

  /* Synchronously isolate rendered state: never leak another conversation/workspace even for 1 frame. */
  const effectiveLog = scoped.ownerKey === ownerKey ? scoped.log : EMPTY_LOG;

  /* Propagate authoritative Core/run transitions into the single React Query cache. */
  const lastSeq = effectiveLog.events.length
    ? (effectiveLog.events[effectiveLog.events.length - 1].seq ?? 0)
    : 0;
  useEffect(() => {
    if (!service || !workspace || !conversationId || !ownerKey || scoped.ownerKey !== ownerKey || lastSeq === 0) {
      return;
    }
    if (processedRef.current.ownerKey !== ownerKey || lastSeq < processedRef.current.seq) {
      processedRef.current = { ownerKey, seq: 0 };
    }
    const fresh = effectiveLog.events.filter(
      (event) => typeof event.seq === 'number' && event.seq > processedRef.current.seq,
    );
    processedRef.current = { ownerKey, seq: lastSeq };
    if (fresh.length === 0) {
      return;
    }

    let invalidateViews = false;
    let invalidateConversation = false;
    let invalidateObservations = false;
    for (const event of fresh) {
      if (event.type === 'operation.started' || event.type === 'operation.finished' ||
          event.type === 'module.discovery' || event.type === 'run.started' ||
          event.type === 'run.finished' || event.type === 'run.cancel_requested') {
        invalidateObservations = true;
      }
      if (
        event.type === 'operation.finished' &&
        (event.data?.kind === 'core' || event.data?.kind === 'hook')
      ) {
        invalidateViews = true;
        if (event.data?.name === 'science_begin') {
          invalidateConversation = true;
        }
      }
      if (
        event.type === 'run.started' ||
        event.type === 'run.finished' ||
        event.type === 'run.cancel_requested'
      ) {
        invalidateConversation = true;
        if (event.type === 'run.finished') {
          invalidateViews = true;
        }
      }
    }

    if (invalidateObservations) {
      void queryClient.invalidateQueries({ queryKey: bhKeys.invocations(service, workspace, conversationId) }, { cancelRefetch: false });
      void queryClient.invalidateQueries({ queryKey: bhKeys.modules(service, workspace, conversationId) }, { cancelRefetch: false });
    }
    if (invalidateViews) {
      void queryClient.invalidateQueries({ queryKey: bhKeys.viewRoot(service, workspace) });
    }
    if (invalidateConversation) {
      void queryClient.invalidateQueries({ queryKey: bhKeys.conversations(service, workspace) });
      void queryClient.invalidateQueries({
        queryKey: bhKeys.conversation(service, workspace, conversationId),
      });
    }
  }, [lastSeq, effectiveLog.events, scoped.ownerKey, ownerKey, queryClient, service, workspace, conversationId]);

  return effectiveLog;
}

/** Watches Core/Governance snapshot version digests and invalidates matching queries. */
export function useBioHarnessVersionStream(
  service: string | null,
  workspace: string | null,
  requestId: string | null,
): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!service || !workspace) {
      return;
    }
    let closed = false;
    const params = new URLSearchParams();
    if (requestId) {
      params.set('request_id', requestId);
    }
    const qs = params.toString();
    const url = `/api/workspaces/${encodeURIComponent(workspace)}/stream${qs ? `?${qs}` : ''}`;
    const source = new EventSource(url);

    const onChanged = () => {
      if (closed) {
        return;
      }
      void queryClient.invalidateQueries({ queryKey: bhKeys.viewRoot(service, workspace) });
    };
    source.addEventListener('changed', onChanged);
    source.addEventListener('view', onChanged);

    return () => {
      closed = true;
      source.close();
    };
  }, [queryClient, service, workspace, requestId]);
}
