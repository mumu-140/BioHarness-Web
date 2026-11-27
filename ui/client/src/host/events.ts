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

const EMPTY_LOG: ConversationEventLog = {
  events: [],
  draft: '',
  connected: false,
  connectSeq: 0,
};

export function useBioHarnessConversationEvents(
  service: string | null,
  workspace: string | null,
  conversationId: string | null,
): ConversationEventLog {
  const queryClient = useQueryClient();
  const [log, setLog] = useState<ConversationEventLog>(EMPTY_LOG);
  const processedSeqRef = useRef(0);

  useEffect(() => {
    setLog(EMPTY_LOG);
    processedSeqRef.current = 0;
    if (!workspace || !conversationId) {
      return;
    }

    const url = conversationsPath(workspace, `/${encodeURIComponent(conversationId)}/events`);
    const source = new EventSource(url);

    source.onopen = () => {
      setLog((state) => ({
        ...state,
        connected: true,
        connectSeq: state.connectSeq + 1,
        /* Drop transient unrecorded delta on reconnect so replay doesn't duplicate text. */
        draft: !state.connected && state.events.length > 0 ? '' : state.draft,
      }));
    };

    source.onerror = () => {
      setLog((state) => ({ ...state, connected: false }));
    };

    /* Server explicitly resets cursor when the backing log was replaced. */
    source.addEventListener('stream.reset', () => {
      processedSeqRef.current = 0;
      setLog((state) => ({
        ...EMPTY_LOG,
        connected: true,
        connectSeq: state.connectSeq + 1,
      }));
    });

    const handleEvent = (message: MessageEvent) => {
      let event: ConversationEvent;
      try {
        event = JSON.parse(String(message.data)) as ConversationEvent;
      } catch {
        return;
      }

      setLog((state) => {
        if (event.seq === null) {
          return {
            ...state,
            connected: true,
            draft: state.draft + String(event.data?.text ?? ''),
          };
        }
        const last = state.events.length
          ? (state.events[state.events.length - 1].seq as number)
          : 0;
        if (event.seq <= last) {
          return state;
        }
        const clearDraft =
          event.type === 'assistant.text' ||
          event.type === 'run.finished' ||
          (event.type === 'operation.finished' && event.data?.kind === 'model');
        return {
          ...state,
          events: [...state.events, event],
          connected: true,
          draft: clearDraft ? '' : state.draft,
        };
      });
    };

    for (const type of EVENT_TYPES) {
      source.addEventListener(type, handleEvent);
    }

    return () => {
      source.close();
    };
  }, [workspace, conversationId]);

  /* Propagate authoritative Core/run transitions into the single React Query cache. */
  const lastSeq = log.events.length ? (log.events[log.events.length - 1].seq ?? 0) : 0;
  useEffect(() => {
    if (!service || !workspace || !conversationId || lastSeq === 0) {
      return;
    }
    if (lastSeq < processedSeqRef.current) {
      processedSeqRef.current = 0;
    }
    const fresh = log.events.filter(
      (event) => typeof event.seq === 'number' && event.seq > processedSeqRef.current,
    );
    processedSeqRef.current = lastSeq;
    if (fresh.length === 0) {
      return;
    }

    let invalidateViews = false;
    let invalidateConversation = false;
    for (const event of fresh) {
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

    if (invalidateViews) {
      void queryClient.invalidateQueries({ queryKey: bhKeys.viewRoot(service, workspace) });
    }
    if (invalidateConversation) {
      void queryClient.invalidateQueries({ queryKey: bhKeys.conversations(service, workspace) });
      void queryClient.invalidateQueries({
        queryKey: bhKeys.conversation(service, workspace, conversationId),
      });
    }
  }, [lastSeq, log.events, queryClient, service, workspace, conversationId]);

  return log;
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
    const params = new URLSearchParams();
    if (requestId) {
      params.set('request_id', requestId);
    }
    const qs = params.toString();
    const url = `/api/workspaces/${encodeURIComponent(workspace)}/stream${qs ? `?${qs}` : ''}`;
    const source = new EventSource(url);

    const onChanged = () => {
      void queryClient.invalidateQueries({ queryKey: bhKeys.viewRoot(service, workspace) });
    };
    source.addEventListener('changed', onChanged);
    source.addEventListener('view', onChanged);

    return () => {
      source.close();
    };
  }, [queryClient, service, workspace, requestId]);
}
