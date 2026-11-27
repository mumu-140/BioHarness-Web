import {
  bhKeys,
  deriveRunStatus,
  eventsToMessages,
  extractOpenRequests,
  type ConversationEvent,
} from '../bioharness';

describe('BioHarness host projections and cache keys', () => {
  it('scopes React Query keys by service and workspace', () => {
    expect(bhKeys.conversations('svc-a', 'ws1')).not.toEqual(
      bhKeys.conversations('svc-a', 'ws2'),
    );
    expect(bhKeys.conversations('svc-a', 'ws1')).not.toEqual(
      bhKeys.conversations('svc-b', 'ws1'),
    );
    expect(bhKeys.view('svc-a', 'ws1', 'now', { request_id: 'r1' })).not.toEqual(
      bhKeys.view('svc-a', 'ws1', 'now', { request_id: 'r2' }),
    );
  });

  it('distinguishes cancellation requested from run termination confirmation', () => {
    const requested: ConversationEvent[] = [
      { seq: 1, run_id: 'run-1', type: 'run.started', data: {} },
      { seq: 2, run_id: 'run-1', type: 'run.cancel_requested', data: {} },
    ];
    expect(deriveRunStatus(requested, 'run-1')).toEqual({
      activeRunId: 'run-1',
      cancelRequested: true,
      lastSeq: 2,
      lastFinishedState: null,
    });

    const confirmed: ConversationEvent[] = [
      ...requested,
      { seq: 3, run_id: 'run-1', type: 'run.finished', data: { state: 'CANCELLED' } },
    ];
    expect(deriveRunStatus(confirmed, null)).toEqual({
      activeRunId: null,
      cancelRequested: false,
      lastSeq: 3,
      lastFinishedState: 'CANCELLED',
    });
  });

  it('projects verbatim user text, assistant text, provider errors, Core UNKNOWN, and streaming draft', () => {
    const events: ConversationEvent[] = [
      { seq: 1, run_id: 'r1', type: 'user.message', data: { text: 'Original exact question?' } },
      {
        seq: 2,
        run_id: 'r1',
        type: 'operation.finished',
        data: { kind: 'core', name: 'science_begin', state: 'UNKNOWN', output: {} },
      },
      {
        seq: 3,
        run_id: 'r1',
        type: 'operation.finished',
        data: { kind: 'model', name: 'chat', state: 'FAILED', error: { code: 'HTTP_502', message: 'bad gateway' } },
      },
      { seq: 4, run_id: 'r1', type: 'assistant.text', data: { text: 'Final **markdown** reply.' } },
    ];
    const msgs = eventsToMessages(events, 'streaming…', 'conv-1', 'gpt-test');
    expect(msgs).toHaveLength(5);
    expect(msgs[0].isCreatedByUser).toBe(true);
    expect(msgs[0].text).toBe('Original exact question?');
    expect(msgs[1].error).toBe(true);
    expect(msgs[1].text).toContain('UNKNOWN');
    expect(msgs[2].error).toBe(true);
    expect(msgs[2].text).toContain('HTTP_502');
    expect(msgs[3].text).toBe('Final **markdown** reply.');
    expect(msgs[4].unfinished).toBe(true);
    expect(msgs[4].text).toBe('streaming…');
    expect(msgs[4].parentMessageId).toBe(msgs[3].messageId);
  });

  it('extracts open requests only from ok snapshots', () => {
    expect(
      extractOpenRequests({
        service: 's',
        workspace: 'w',
        view: 'open',
        selector: {},
        source: { owner: 'core', interface: 'cli' },
        observed_at: '',
        ok: true,
        data: { requests: [{ request_id: 'req-1', question: 'Q1' }] },
        error: null,
        source_version: null,
        content_sha256: '',
        warnings: [],
      }),
    ).toEqual([{ request_id: 'req-1', question: 'Q1' }]);
  });
});
