/**
 * BioHarness public HTTP contracts, scoped React Query keys, and pure event-log projections
 * (not upstream LibreChat code).
 *
 * All network traffic flows exclusively through `hostFetch` in `./gate`. The browser owns no
 * transcript database and calls no model provider directly.
 */
import { Constants } from 'librechat-data-provider';
import type { EModelEndpoint, TMessage } from 'librechat-data-provider';
import { hostFetch } from './gate';

export const BIOHARNESS_ENDPOINT = 'bioharness' as unknown as EModelEndpoint;

export interface SourceError {
  origin: 'core' | 'project-governance' | 'web' | string;
  code: string | null;
  message: string;
  detail?: Record<string, unknown>;
}

export class BioHarnessApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'BioHarnessApiError';
  }
}

export interface BioHarnessMeta {
  service: string;
  workspaces: string[];
  poll_interval_seconds: number;
  tools: Record<string, { command: string; found: boolean }>;
  runtime: {
    enabled: boolean;
    model: string | null;
    module_tool_servers: string[];
  };
}

export interface WorkspaceConversation {
  id: string;
  workspace: string;
  request_id: string | null;
  created_at: string;
  last_run_state?: string | null;
}

export interface OpenRequest {
  request_id: string;
  question?: string;
  original_task_text?: string;
  phase?: string;
  action?: string;
  scope_id?: string | null;
  project_id?: string | null;
  updated_at?: string | null;
  question_match?: string;
}

export interface ConversationStateResponse {
  conversation: WorkspaceConversation;
  active_run: { id: string } | null;
  begin_reconcile: 'OUTCOME_UNKNOWN' | 'EXISTING_REQUEST' | null;
  begin_candidates: Array<OpenRequest & { question_match: string }>;
  open_listing: {
    listed: number;
    may_be_incomplete: boolean;
    source_message: string | null;
  } | null;
}

export interface ConversationEvent {
  seq: number | null;
  conversation_id?: string;
  run_id: string | null;
  type: string;
  data: Record<string, unknown>;
  at?: string;
}

export interface MainlineAmendmentPending {
  id: string;
  reason: string;
  [key: string]: unknown;
}

export interface NowData {
  request_id: string;
  question?: string;
  original_task_text?: string;
  question_type?: string;
  phase?: string;
  action?: string;
  waiting_for_user?: { question?: string; [key: string]: unknown } | null;
  mainline_amendment_pending?: MainlineAmendmentPending | null;
  delivery_kind?: string | null;
  scope_context?: { scope_id?: string | null; project_id?: string | null; [key: string]: unknown } | null;
  [key: string]: unknown;
}

export interface OpenRequestsData {
  requests?: OpenRequest[];
  open_requests?: OpenRequest[];
  [key: string]: unknown;
}

export interface TreeScopeNode {
  scope_id: string;
  parent_id?: string | null;
  title?: string;
  name?: string;
  [key: string]: unknown;
}

export interface TreeData {
  nodes?: TreeScopeNode[];
  scopes?: TreeScopeNode[];
  projects?: Array<{ project_id?: string; scopes?: TreeScopeNode[]; [key: string]: unknown }>;
  [key: string]: unknown;
}

export interface Snapshot<T = Record<string, unknown>> {
  service: string;
  workspace: string;
  view: string;
  selector: Record<string, unknown>;
  source: { owner: string; interface: string };
  observed_at: string;
  ok: boolean;
  data: T | null;
  error: SourceError | null;
  source_version: Record<string, string> | null;
  content_sha256: string;
  warnings: string[];
}

export interface ProviderItem {
  id: string;
  name: string;
  protocol: 'openai-compatible' | 'anthropic' | 'gemini';
  base_url: string;
  has_api_key: boolean;
  api_key_masked: string;
  models: string[];
  enabled: boolean;
  timeout_seconds: number;
  source: 'env' | 'user';
}

export interface SlotsState {
  chat: {
    provider_id: string | null;
    model: string;
    temperature: number | null;
    max_tokens: number | null;
  };
  vision: {
    provider_id: string | null;
    model: string;
    image_size: string;
  };
  speech: {
    provider_id: string | null;
    asr_model: string;
    tts_model: string;
    voice: string;
  };
  embedding: {
    provider_id: string | null;
    model: string;
    dimensions: number | null;
  };
}

export interface PresetItem {
  id: string;
  name: string;
  protocol: 'openai-compatible' | 'anthropic' | 'gemini';
  base_url: string;
  hint: string;
}

export interface ModelConfigResponse {
  editable: boolean;
  runtime_enabled: boolean;
  active_chat_model: string | null;
  applied_chat?: boolean;
  providers: ProviderItem[];
  slots: SlotsState;
  presets: PresetItem[];
}

export interface FetchModelsResult {
  ok: boolean;
  models: string[];
  latency_ms: number;
  error: string | null;
}

export interface NewScopeSelection {
  id: string;
  create?: boolean;
  parent_id?: string;
}

/** Strictly scoped React Query keys inside LibreChat's single QueryClient. */
export const bhKeys = {
  meta: () => ['bioharness', 'meta'] as const,
  models: (service: string) => ['bioharness', service, 'settings', 'models'] as const,
  conversations: (service: string, workspace: string) =>
    ['bioharness', service, workspace, 'conversations'] as const,
  conversation: (service: string, workspace: string, conversationId: string) =>
    ['bioharness', service, workspace, 'conversation', conversationId] as const,
  viewRoot: (service: string, workspace: string) =>
    ['bioharness', service, workspace, 'view'] as const,
  view: (
    service: string,
    workspace: string,
    view: string,
    selector: Record<string, string | number | boolean | undefined> = {},
  ) => ['bioharness', service, workspace, 'view', view, stableSelectorKey(selector)] as const,
};

function stableSelectorKey(selector: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(selector).sort()) {
    const value = selector[key];
    if (value !== undefined && value !== false && value !== '') {
      params.set(key, String(value));
    }
  }
  return params.toString();
}

async function parseJsonOrError<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail: Partial<SourceError> = {};
    try {
      const payload = (await response.json()) as { detail?: Partial<SourceError> | string };
      if (typeof payload.detail === 'string') {
        detail = { message: payload.detail };
      } else if (payload.detail && typeof payload.detail === 'object') {
        detail = payload.detail;
      }
    } catch {
      /* non-JSON body: keep HTTP status */
    }
    throw new BioHarnessApiError(
      response.status,
      detail.code ?? `HTTP_${response.status}`,
      typeof detail.message === 'string' ? detail.message : `Request failed (HTTP ${response.status})`,
      detail.detail,
    );
  }
  return (await response.json()) as T;
}

export async function fetchMeta(): Promise<BioHarnessMeta> {
  const res = await hostFetch('/api/meta');
  return parseJsonOrError<BioHarnessMeta>(res);
}

export function conversationsPath(workspace: string, rest = ''): string {
  return `/api/workspaces/${encodeURIComponent(workspace)}/conversations${rest}`;
}

export async function fetchConversations(workspace: string): Promise<WorkspaceConversation[]> {
  const res = await hostFetch(conversationsPath(workspace));
  return parseJsonOrError<WorkspaceConversation[]>(res);
}

export async function createConversation(
  workspace: string,
  body: { text?: string; request_id?: string; scope?: NewScopeSelection },
): Promise<{ conversation: WorkspaceConversation; run_id: string | null }> {
  const res = await hostFetch(conversationsPath(workspace), {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseJsonOrError(res);
}

export async function fetchConversationState(
  workspace: string,
  conversationId: string,
): Promise<ConversationStateResponse> {
  const res = await hostFetch(conversationsPath(workspace, `/${encodeURIComponent(conversationId)}`));
  return parseJsonOrError<ConversationStateResponse>(res);
}

export async function attachConversationRequest(
  workspace: string,
  conversationId: string,
  requestId: string,
): Promise<{ conversation: WorkspaceConversation }> {
  const res = await hostFetch(
    conversationsPath(workspace, `/${encodeURIComponent(conversationId)}/request`),
    {
      method: 'PUT',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: requestId }),
    },
  );
  return parseJsonOrError(res);
}

export async function startRun(
  workspace: string,
  conversationId: string,
  text?: string | null,
): Promise<{ run_id: string }> {
  const body = text !== undefined && text !== null ? { text } : {};
  const res = await hostFetch(
    conversationsPath(workspace, `/${encodeURIComponent(conversationId)}/runs`),
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  return parseJsonOrError(res);
}

export async function cancelRun(
  workspace: string,
  conversationId: string,
  runId: string,
): Promise<{ cancel: string }> {
  const res = await hostFetch(
    conversationsPath(
      workspace,
      `/${encodeURIComponent(conversationId)}/runs/${encodeURIComponent(runId)}/cancel`,
    ),
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    },
  );
  return parseJsonOrError(res);
}

export async function fetchView<T>(
  workspace: string,
  view: 'open' | 'now' | 'tree' | 'context' | 'routes' | 'evidence',
  selector: Record<string, string | number | boolean | undefined> = {},
): Promise<Snapshot<T>> {
  const qs = stableSelectorKey(selector);
  const url = `/api/workspaces/${encodeURIComponent(workspace)}/views/${view}${qs ? `?${qs}` : ''}`;
  const res = await hostFetch(url, { headers: { Accept: 'application/json' } });
  return parseJsonOrError<Snapshot<T>>(res);
}

export async function fetchModelConfig(): Promise<ModelConfigResponse> {
  const res = await hostFetch('/api/settings/models', { headers: { Accept: 'application/json' } });
  return parseJsonOrError<ModelConfigResponse>(res);
}

export async function saveModelConfig(payload: {
  providers: Array<{
    id: string;
    name: string;
    protocol: 'openai-compatible' | 'anthropic' | 'gemini';
    base_url: string;
    api_key?: string | null;
    clear_api_key?: boolean;
    models: string[];
    enabled: boolean;
    timeout_seconds: number;
  }>;
  slots: SlotsState;
}): Promise<ModelConfigResponse> {
  const res = await hostFetch('/api/settings/models', {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJsonOrError<ModelConfigResponse>(res);
}

export async function fetchRemoteModels(body: {
  provider_id?: string | null;
  base_url: string;
  api_key?: string | null;
}): Promise<FetchModelsResult> {
  const res = await hostFetch('/api/settings/models/fetch-models', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseJsonOrError<FetchModelsResult>(res);
}

export async function resetModelConfig(): Promise<ModelConfigResponse> {
  const res = await hostFetch('/api/settings/models/reset', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  return parseJsonOrError<ModelConfigResponse>(res);
}

export function extractOpenRequests(snapshot: Snapshot<OpenRequestsData> | undefined): OpenRequest[] {
  if (!snapshot?.ok || !snapshot.data) {
    return [];
  }
  const list = snapshot.data.requests ?? snapshot.data.open_requests;
  return Array.isArray(list) ? list : [];
}

export function extractTreeScopes(snapshot: Snapshot<TreeData> | undefined): TreeScopeNode[] {
  if (!snapshot?.ok || !snapshot.data) {
    return [];
  }
  const direct = snapshot.data.nodes ?? snapshot.data.scopes;
  if (Array.isArray(direct)) {
    return direct.filter((item) => typeof item?.scope_id === 'string');
  }
  const collected: TreeScopeNode[] = [];
  if (Array.isArray(snapshot.data.projects)) {
    for (const proj of snapshot.data.projects) {
      if (Array.isArray(proj?.scopes)) {
        for (const s of proj.scopes) {
          if (typeof s?.scope_id === 'string') {
            collected.push(s);
          }
        }
      }
    }
  }
  return collected;
}

const SOURCE_LABELS: Record<string, string> = {
  core: 'Core',
  host: 'Workspace',
};

const RUN_STATE_LABELS: Record<string, string> = {
  FINISHED: 'Run finished',
  CANCELLED: 'Run cancelled (confirmed)',
  FAILED: 'Run failed',
  INTERRUPTED: 'Run interrupted',
};

export interface DerivedRunStatus {
  activeRunId: string | null;
  cancelRequested: boolean;
  lastSeq: number;
  lastFinishedState: string | null;
}

/** Derives run & cancellation status purely from server-recorded events + active_run state. */
export function deriveRunStatus(
  events: ConversationEvent[],
  stateActiveRunId: string | null | undefined,
): DerivedRunStatus {
  let activeRunId: string | null = null;
  let cancelRequested = false;
  let lastSeq = 0;
  let lastFinishedState: string | null = null;

  for (const event of events) {
    if (typeof event.seq === 'number' && event.seq > lastSeq) {
      lastSeq = event.seq;
    }
    if (event.type === 'run.started' && event.run_id) {
      activeRunId = event.run_id;
      cancelRequested = false;
    } else if (event.type === 'run.cancel_requested' && event.run_id && event.run_id === activeRunId) {
      cancelRequested = true;
    } else if (event.type === 'run.finished' && event.run_id) {
      if (event.run_id === activeRunId) {
        activeRunId = null;
        cancelRequested = false;
      }
      lastFinishedState = typeof event.data.state === 'string' ? event.data.state : null;
    }
  }

  if (activeRunId === null && events.length === 0 && stateActiveRunId) {
    activeRunId = stateActiveRunId;
  }

  return { activeRunId, cancelRequested, lastSeq, lastFinishedState };
}

/** Projects the authoritative server event log onto LibreChat's linear TMessage[] thread. */
export function eventsToMessages(
  events: ConversationEvent[],
  streamingDraft: string,
  conversationId: string,
  modelLabel: string | null,
): TMessage[] {
  const rows: Array<{
    id: string;
    isCreatedByUser: boolean;
    sender: string;
    text: string;
    error?: boolean;
    unfinished?: boolean;
    createdAt?: string;
  }> = [];

  const assistantSender = modelLabel || 'BioHarness';

  for (const event of events) {
    const seq = event.seq ?? 0;
    const text = typeof event.data.text === 'string' ? event.data.text : '';
    if (event.type === 'user.message') {
      rows.push({
        id: `e-${seq}`,
        isCreatedByUser: true,
        sender: 'User',
        text,
        createdAt: event.at,
      });
    } else if (event.type === 'assistant.text') {
      rows.push({
        id: `e-${seq}`,
        isCreatedByUser: false,
        sender: assistantSender,
        text,
        createdAt: event.at,
      });
    } else if (event.type === 'notice') {
      const rawSource = String(event.data.source ?? 'host');
      const source = SOURCE_LABELS[rawSource] ?? rawSource;
      rows.push({
        id: `e-${seq}`,
        isCreatedByUser: false,
        sender: source,
        text: `**${source}:** ${text}`,
        createdAt: event.at,
      });
    } else if (
      event.type === 'operation.finished' &&
      event.data.kind === 'core' &&
      (event.data.state === 'REFUSED' || event.data.state === 'UNKNOWN')
    ) {
      const output = event.data.output as { error?: { message?: unknown } } | undefined;
      const errMsg = output?.error?.message ? String(output.error.message) : 'No reason given';
      const name = String(event.data.name ?? 'core');
      rows.push({
        id: `e-${seq}`,
        isCreatedByUser: false,
        sender: 'Core',
        error: true,
        text:
          event.data.state === 'REFUSED'
            ? `Core refused \`${name}\`: ${errMsg}`
            : `\`${name}\` outcome is **UNKNOWN** (no reply from Core). The workspace did not replay it automatically.`,
        createdAt: event.at,
      });
    } else if (
      event.type === 'operation.finished' &&
      event.data.kind === 'model' &&
      event.data.state === 'FAILED'
    ) {
      const err = event.data.error as { code?: unknown; message?: unknown } | string | undefined;
      const errText =
        typeof err === 'string'
          ? err
          : [err?.code ? String(err.code) : '', err?.message ? String(err.message) : '']
              .filter(Boolean)
              .join(': ') || 'Model provider call failed';
      rows.push({
        id: `e-${seq}`,
        isCreatedByUser: false,
        sender: 'Model Provider',
        error: true,
        text: `Provider error: ${errText}`,
        createdAt: event.at,
      });
    } else if (event.type === 'run.cancel_requested') {
      rows.push({
        id: `e-${seq}`,
        isCreatedByUser: false,
        sender: 'Workspace',
        text: '_Cancellation requested — awaiting run termination confirmation._',
        createdAt: event.at,
      });
    } else if (event.type === 'run.finished') {
      const state = typeof event.data.state === 'string' ? event.data.state : '';
      const reason = typeof event.data.reason === 'string' ? event.data.reason : '';
      if (state && state !== 'FINISHED') {
        const label = RUN_STATE_LABELS[state] ?? `Run ${state}`;
        rows.push({
          id: `e-${seq}`,
          isCreatedByUser: false,
          sender: 'Workspace',
          error: state === 'FAILED',
          text: reason ? `**${label}:** ${reason}` : `**${label}**`,
          createdAt: event.at,
        });
      }
    }
  }

  if (streamingDraft) {
    rows.push({
      id: 'live-draft',
      isCreatedByUser: false,
      sender: assistantSender,
      text: streamingDraft,
      unfinished: true,
    });
  }

  let parentId: string = Constants.NO_PARENT;
  return rows.map((row) => {
    const message: TMessage = {
      messageId: row.id,
      parentMessageId: parentId,
      conversationId,
      sender: row.sender,
      text: row.text,
      isCreatedByUser: row.isCreatedByUser,
      error: row.error ?? false,
      unfinished: row.unfinished ?? false,
      endpoint: BIOHARNESS_ENDPOINT,
      model: modelLabel ?? undefined,
      createdAt: row.createdAt ?? new Date().toISOString(),
    };
    parentId = row.id;
    return message;
  });
}
