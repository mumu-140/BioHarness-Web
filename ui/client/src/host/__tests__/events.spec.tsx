import React from 'react';
import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useBioHarnessConversationEvents, useBioHarnessVersionStream, type ConversationEventLog } from '../events';

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  closed = false;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Array<(ev: MessageEvent) => void>>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: (ev: MessageEvent) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  emit(type: string, data: unknown) {
    const list = this.listeners.get(type) ?? [];
    const ev = { data: JSON.stringify(data) } as MessageEvent;
    for (const fn of list) {
      fn(ev);
    }
  }

  close() {
    this.closed = true;
  }
}

describe('useBioHarnessConversationEvents session identity isolation', () => {
  const OriginalEventSource = global.EventSource;

  beforeEach(() => {
    MockEventSource.instances = [];
    (global as unknown as { EventSource: typeof MockEventSource }).EventSource = MockEventSource;
  });

  afterEach(() => {
    (global as unknown as { EventSource: typeof EventSource }).EventSource = OriginalEventSource;
  });

  it('synchronously isolates state on conversation/workspace switch and drops stale/mismatched SSE payloads', () => {
    const queryClient = new QueryClient();
    const invalidateSpy = jest.spyOn(queryClient, 'invalidateQueries');
    const renderHistory: Array<{ key: string; eventCount: number; draft: string }> = [];
    let latest: ConversationEventLog | null = null;

    function Harness({ workspace, conversationId }: { workspace: string; conversationId: string }) {
      const log = useBioHarnessConversationEvents('svc-1', workspace, conversationId);
      latest = log;
      renderHistory.push({
        key: `${workspace}::${conversationId}`,
        eventCount: log.events.length,
        draft: log.draft,
      });
      return null;
    }

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <Harness workspace="ws1" conversationId="conv-A" />
      </QueryClientProvider>,
    );

    const srcA = MockEventSource.instances[0];
    expect(srcA.url).toContain('/ws1/conversations/conv-A/events');

    act(() => {
      srcA.onopen?.();
      srcA.emit('user.message', {
        seq: 1,
        conversation_id: 'conv-A',
        run_id: 'run-A',
        type: 'user.message',
        data: { text: 'Message A' },
      });
      srcA.emit('assistant.delta', {
        seq: null,
        conversation_id: 'conv-A',
        run_id: 'run-A',
        type: 'assistant.delta',
        data: { text: 'Draft A' },
      });
      /* Mismatched conversation_id payload arriving on conv-A stream must be dropped. */
      srcA.emit('assistant.text', {
        seq: 2,
        conversation_id: 'conv-OTHER',
        run_id: 'run-X',
        type: 'assistant.text',
        data: { text: 'Forged cross-session text' },
      });
    });

    expect(latest!.events).toHaveLength(1);
    expect(latest!.draft).toBe('Draft A');

    invalidateSpy.mockClear();
    renderHistory.length = 0;

    /* Switch to conv-B: the VERY FIRST render for conv-B must already see 0 events and empty draft! */
    rerender(
      <QueryClientProvider client={queryClient}>
        <Harness workspace="ws1" conversationId="conv-B" />
      </QueryClientProvider>,
    );

    expect(srcA.closed).toBe(true);
    expect(renderHistory[0]).toEqual({ key: 'ws1::conv-B', eventCount: 0, draft: '' });
    expect(invalidateSpy).not.toHaveBeenCalled();

    /* Late event firing on already-closed srcA must NOT leak into conv-B. */
    act(() => {
      srcA.emit('assistant.text', {
        seq: 3,
        conversation_id: 'conv-A',
        run_id: 'run-A',
        type: 'assistant.text',
        data: { text: 'Late event A' },
      });
    });
    expect(latest!.events).toHaveLength(0);
    expect(latest!.draft).toBe('');

    /* Switch workspace with same conversationId ('conv-B'): must also isolate synchronously. */
    const srcB = MockEventSource.instances[1];
    act(() => {
      srcB.emit('user.message', {
        seq: 1,
        conversation_id: 'conv-B',
        run_id: 'run-B',
        type: 'user.message',
        data: { text: 'Workspace 1 B' },
      });
    });
    expect(latest!.events).toHaveLength(1);

    renderHistory.length = 0;
    rerender(
      <QueryClientProvider client={queryClient}>
        <Harness workspace="ws2" conversationId="conv-B" />
      </QueryClientProvider>,
    );
    expect(srcB.closed).toBe(true);
    expect(renderHistory[0]).toEqual({ key: 'ws2::conv-B', eventCount: 0, draft: '' });
  });
});


describe('useBioHarnessVersionStream (SSE version & source.stale)', () => {
  const origES = globalThis.EventSource;
  beforeEach(() => {
    MockEventSource.instances = [];
    (globalThis as unknown as { EventSource: unknown }).EventSource = MockEventSource;
  });
  afterEach(() => {
    (globalThis as unknown as { EventSource: unknown }).EventSource = origES;
  });
  it('deduplicates identical version hashes and invalidates on changed content_sha256 or source.stale', () => {
    const qc = new QueryClient();
    const invalidateSpy = jest.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined);

    function Harness() {
      useBioHarnessVersionStream('svc-1', 'ws-1', 'req-1');
      return null;
    }

    const { unmount } = render(
      <QueryClientProvider client={qc}>
        <Harness />
      </QueryClientProvider>,
    );

    const es = MockEventSource.instances[MockEventSource.instances.length - 1];
    expect(es.url).toContain('/api/workspaces/ws-1/stream?request_id=req-1');

    act(() => {
      es.emit('version', {
        workspace: 'ws-1',
        view: 'now',
        selector: { request_id: 'req-1' },
        content_sha256: 'sha-v1',
      });
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(1);

    // Identical content_sha256 is deduplicated (no redundant refetch)
    act(() => {
      es.emit('version', {
        workspace: 'ws-1',
        view: 'now',
        selector: { request_id: 'req-1' },
        content_sha256: 'sha-v1',
      });
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(1);

    // Different content_sha256 invalidates workspace views
    act(() => {
      es.emit('version', {
        workspace: 'ws-1',
        view: 'now',
        selector: { request_id: 'req-1' },
        content_sha256: 'sha-v2',
      });
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(2);

    // Cross-workspace event is ignored
    act(() => {
      es.emit('version', {
        workspace: 'ws-other',
        view: 'now',
        selector: { request_id: 'req-1' },
        content_sha256: 'sha-other',
      });
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(2);

    // source.stale triggers invalidation so last-confirmed stale banner can surface
    act(() => {
      es.emit('source.stale', { workspace: 'ws-1', view: 'now', code: 'TOOL_FAILED' });
    });
    expect(invalidateSpy).toHaveBeenCalledTimes(3);

    unmount();
    invalidateSpy.mockRestore();
  });
});
