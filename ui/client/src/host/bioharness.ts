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

export interface PlanStep {
  id: string;
  kind: string;
  objective?: string;
  serves?: string[];
  why?: string;
  needs?: string[];
  method?: string;
  parameters?: Record<string, unknown>;
  deliverable?: string;
  check?: string;
  depends_on?: string[];
}

export interface Plan {
  question_type?: string;
  objective?: string;
  requirements?: string[];
  steps: PlanStep[];
  significance?: string;
  knowledge_gap?: string;
  expected_findings?: string[];
  limits?: string[];
}

export interface StepProgress {
  id: string;
  kind: string;
  status: string;
  attempts: number;
  review?: string;
}

export interface NowData {
  request_id: string;
  question?: string;
  original_task_text?: string;
  question_type?: string;
  phase?: string;
  action?: string;
  must_not_stop?: boolean;
  instruction?: string;
  anchor?: string;
  plan?: Plan;
  plan_version?: number;
  progress?: { done: number; total: number; steps: StepProgress[] };
  step?: PlanStep & { attempt?: number; last_review?: Record<string, unknown> };
  also_available?: string[];
  optional_explore_steps?: string[];
  unresolved_steps?: Array<{ id: string; status: string; summary: string }>;
  open_concerns?: Array<{ about: string; concern: string }>;
  waiting_for_user?: { question?: string; [key: string]: unknown } | null;
  mainline_amendment_pending?: MainlineAmendmentPending | null;
  delivery_kind?: string | null;
  answer?: string;
  limitations?: string[];
  disclosure?: string;
  evidence_changed_since_submission?: string[];
  scope_context?: { scope_id?: string | null; project_id?: string | null; [key: string]: unknown } | null;
  [key: string]: unknown;
}

export interface OpenRequestsData {
  requests?: OpenRequest[];
  open_requests?: OpenRequest[];
  may_be_incomplete?: boolean;
  source_message?: string | null;
  core_state_present?: boolean;
  [key: string]: unknown;
}

export interface GovernanceRecordRef {
  request_id: string;
  scope_id?: string | null;
  revision?: number;
  request_status?: string;
  delivery_kind?: string | null;
}

export interface EvidenceAnchor {
  request_id: string;
  submission_index: number;
  evidence_id: string;
  sha256: string;
}

export interface EvidenceRef extends EvidenceAnchor {
  source?: string;
  kind?: string;
  bytes?: number | null;
  snapshot?: boolean;
  step_id?: string;
  submission_status?: string;
}

export interface TreeScopeNode {
  scope_id: string;
  parent_id?: string | null;
  parent_scope_id?: string | null;
  title?: string;
  name?: string;
  objective?: string;
  path?: string[];
  mainline_version?: number;
  request_count?: number;
  requests?: GovernanceRecordRef[];
  scopes?: TreeScopeNode[];
  [key: string]: unknown;
}

export interface RelatedRequestLink {
  source_request_id: string;
  target_request_id: string;
  [key: string]: unknown;
}

export interface GoalVersionChangeRef {
  request_id: string;
  scope_id?: string | null;
  [key: string]: unknown;
}

export interface TreeData {
  project_id?: string;
  nodes?: TreeScopeNode[];
  scopes?: TreeScopeNode[];
  projects?: Array<TreeScopeNode & { project_id?: string; scopes?: TreeScopeNode[] }>;
  related_requests?: RelatedRequestLink[];
  goal_version_changes?: GoalVersionChangeRef[];
  shared_evidence?: Array<{ sha256: string; references: EvidenceRef[] }>;
  request_binding?: GovernanceRecordRef & { path?: string[] | null };
  note?: string;
  [key: string]: unknown;
}

export interface AttemptRecord extends GovernanceRecordRef {
  submission_index: number;
  step_id: string;
  plan_version?: number | null;
  at?: string | null;
  submission_status: string;
  summary: string;
  method_used?: string;
  parameters_used?: Record<string, unknown>;
  condition_gaps?: string[];
  execution_verified?: boolean;
  evidence: EvidenceRef[];
}

export interface RoutesData {
  scope_id: string;
  included_scope_ids?: string[];
  attempt_count?: number;
  offset?: number;
  attempts: AttemptRecord[];
  note?: string;
}

export interface ContextSubmission {
  request_id: string;
  submission_index: number;
  step_id: string;
  submission_status: string;
  summary?: string;
  evidence?: EvidenceRef[];
  evidence_count?: number;
}

export interface ContextData {
  ok?: boolean;
  scope_guidance?: string;
  shared?: {
    scope?: TreeScopeNode;
    ancestors?: TreeScopeNode[];
    children?: TreeScopeNode[];
    requests?: GovernanceRecordRef[];
    recent_submissions?: ContextSubmission[];
    related_requests?: GovernanceRecordRef[];
    related_count?: number;
    unavailable_related_ids?: string[];
    goal_version_changes?: GoalVersionChangeRef[];
    goal_version_change_count?: number;
  };
  selected_request?: GovernanceRecordRef & { objective?: string; mainline_version?: number };
  note?: string;
  warnings?: string[];
}

export interface InvocationItem {
  cursor: number;
  id: string;
  run_id: string;
  kind: string;
  name: string;
  state: string;
  started_at: string;
  ended_at: string | null;
  server: string | null;
  input: unknown;
  output: unknown;
  error: { code?: string | null; message?: string; [key: string]: unknown } | string | null;
  note: string | null;
  initiator: string | null;
  details: Record<string, unknown>;
}

export interface InvocationsResponse {
  service: string;
  workspace: string;
  conversation_id: string;
  request_id: string | null;
  authority: string;
  note: string;
  items: InvocationItem[];
  next_before: number | null;
}

export interface ModuleServerObservation {
  server: string;
  configured: boolean;
  state: string;
  run_id: string | null;
  observed_at: string | null;
  tools?: string[];
  offered_tools?: string[];
  error?: { code?: string | null; message?: string; [key: string]: unknown } | null;
}

export interface ModulesResponse {
  service: string;
  workspace: string;
  conversation_id: string;
  request_id: string | null;
  authority: string;
  note: string;
  servers: ModuleServerObservation[];
}

export interface EvidencePreview {
  evidence_id: string;
  kind: string;
  name: string;
  recorded_sha256: string;
  recorded_bytes: number | null;
  content_available: boolean;
  unavailable_reason: string | null;
  current_file_identity: 'MATCHES_RECORD' | 'DIFFERS_FROM_RECORD' | 'NOT_CHECKED';
  format?: string;
  size_bytes?: number;
  truncated?: boolean;
  content: string | null;
}

export interface EvidencePreviewResponse {
  ok: boolean;
  selector: Record<string, unknown>;
  error?: { origin: string; code: string | null; message: string };
  recorded_reference?: string;
  snapshot_integrity?: string;
  source_note?: string;
  preview?: EvidencePreview;
}

export interface EvidenceTableColumn {
  id: string;
  name: string;
  index: number;
}

export interface EvidenceTableData {
  evidence_id: string;
  kind: string;
  name: string;
  recorded_sha256: string;
  recorded_bytes: number | null;
  size_bytes?: number;
  content_available: boolean;
  unavailable_reason: string | null;
  current_file_identity: 'MATCHES_RECORD' | 'DIFFERS_FROM_RECORD' | 'NOT_CHECKED';
  delimiter?: string;
  columns: EvidenceTableColumn[];
  columns_truncated?: boolean;
  cells_truncated?: boolean;
  preview_rows?: number;
  rows: Array<Record<string, unknown>>;
  offset: number;
  limit: number;
  returned_rows: number;
  has_more: boolean;
  total_rows: number | null;
  total_rows_known: boolean;
  truncated: boolean;
  row_semantics: string;
  sort_scope: string;
  filter_scope: string;
}

export interface EvidenceTableResponse {
  ok: boolean;
  selector: Record<string, unknown>;
  error?: { origin: string; code: string | null; message: string };
  recorded_reference?: string;
  snapshot_integrity?: string;
  source_note?: string;
  table?: EvidenceTableData;
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
  shortened?: unknown;
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
  invocations: (service: string, workspace: string, conversationId: string, before?: number | null) =>
    ['bh', service, workspace, 'invocations', conversationId, before ?? 'latest'] as const,
  modules: (service: string, workspace: string, conversationId: string) =>
    ['bh', service, workspace, 'modules', conversationId] as const,
  evidencePreview: (service: string, workspace: string, anchor: EvidenceAnchor) =>
    [
      'bh',
      service,
      workspace,
      'evidence-preview',
      anchor.request_id,
      anchor.submission_index,
      anchor.evidence_id,
      anchor.sha256,
    ] as const,
  evidenceTable: (
    service: string,
    workspace: string,
    anchor: EvidenceAnchor,
    offset: number,
    limit: number,
  ) =>
    [
      'bh',
      service,
      workspace,
      'evidence-table',
      anchor.request_id,
      anchor.submission_index,
      anchor.evidence_id,
      anchor.sha256,
      offset,
      limit,
    ] as const,
};

export function stableSelectorKey(selector: Record<string, string | number | boolean | undefined>): string {
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

export function extractTreeProjects(snapshot: Snapshot<TreeData> | undefined): TreeScopeNode[] {
  if (!snapshot?.ok || !snapshot.data || !Array.isArray(snapshot.data.projects)) {
    return [];
  }
  return snapshot.data.projects
    .map((proj) => {
      const id =
        typeof proj?.scope_id === 'string'
          ? proj.scope_id
          : typeof proj?.project_id === 'string'
            ? proj.project_id
            : null;
      return id ? ({ ...proj, scope_id: id } as TreeScopeNode) : null;
    })
    .filter((item): item is TreeScopeNode => item !== null);
}

export function extractTreeScopes(snapshot: Snapshot<TreeData> | undefined): TreeScopeNode[] {
  if (!snapshot?.ok || !snapshot.data) {
    return [];
  }
  const direct = snapshot.data.nodes ?? snapshot.data.scopes;
  if (Array.isArray(direct) && direct.length > 0) {
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

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Projects the authoritative server event log onto LibreChat's linear TMessage[] thread.
 *
 * Historical assistant messages preserve the recorded model from their own operation
 * (`assistant.text.data.model` or matching `operation.finished`/`operation.started`),
 * never retroactively adopting the currently active workspace model.
 */
export function eventsToMessages(
  events: ConversationEvent[],
  streamingDraft: string,
  conversationId: string,
  activeModelLabel: string | null,
): TMessage[] {
  const opModelById = new Map<string, string>();
  const runModelById = new Map<string, string>();
  const startedOps = new Map<string, string>();

  for (const event of events) {
    if (event.type === 'run.started' && event.run_id) {
      const m = nonEmptyString(event.data?.model);
      if (m) {
        runModelById.set(event.run_id, m);
      }
    } else if (event.type === 'operation.started' && event.data?.kind === 'model') {
      const opId = nonEmptyString(event.data.operation_id);
      const m = nonEmptyString(event.data.name);
      if (opId && m) {
        if (!opModelById.has(opId)) {
          opModelById.set(opId, m);
        }
        startedOps.set(opId, m);
      }
    } else if (event.type === 'operation.finished' && event.data?.kind === 'model') {
      const opId = nonEmptyString(event.data.operation_id);
      const m = nonEmptyString(event.data.reported_model) ?? nonEmptyString(event.data.name);
      if (opId) {
        if (m) {
          opModelById.set(opId, m);
        }
        startedOps.delete(opId);
      }
    } else if (event.type === 'run.finished') {
      startedOps.clear();
    }
  }

  let inFlightModel: string | null = null;
  for (const modelName of startedOps.values()) {
    inFlightModel = modelName;
  }

  const rows: Array<{
    id: string;
    isCreatedByUser: boolean;
    sender: string;
    text: string;
    model?: string;
    error?: boolean;
    unfinished?: boolean;
    createdAt?: string;
  }> = [];

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
      const opId = nonEmptyString(event.data.operation_id);
      const recordedModel =
        nonEmptyString(event.data.model) ??
        (opId ? (opModelById.get(opId) ?? null) : null) ??
        (event.run_id ? (runModelById.get(event.run_id) ?? null) : null);
      rows.push({
        id: `e-${seq}`,
        isCreatedByUser: false,
        sender: recordedModel ?? 'Assistant',
        model: recordedModel ?? undefined,
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
      const opId = nonEmptyString(event.data.operation_id);
      const failedModel =
        nonEmptyString(event.data.name) ?? (opId ? (opModelById.get(opId) ?? null) : null);
      rows.push({
        id: `e-${seq}`,
        isCreatedByUser: false,
        sender: 'Model Provider',
        model: failedModel ?? undefined,
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
    const draftModel = inFlightModel ?? nonEmptyString(activeModelLabel);
    rows.push({
      id: 'live-draft',
      isCreatedByUser: false,
      sender: draftModel ?? 'Assistant',
      model: draftModel ?? undefined,
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
      model: row.model,
      createdAt: row.createdAt ?? new Date().toISOString(),
    };
    parentId = row.id;
    return message;
  });
}


/* ---- Step 4 API fetchers & evidence identity helpers -------------------- */

export async function fetchInvocations(
  workspace: string,
  conversationId: string,
  opts: { before?: number | null; limit?: number } = {},
): Promise<InvocationsResponse> {
  const params = new URLSearchParams();
  if (typeof opts.before === 'number') {
    params.set('before', String(opts.before));
  }
  if (typeof opts.limit === 'number') {
    params.set('limit', String(opts.limit));
  }
  const qs = params.toString();
  const res = await hostFetch(
    conversationsPath(workspace, `/${encodeURIComponent(conversationId)}/invocations${qs ? `?${qs}` : ''}`),
    { headers: { Accept: 'application/json' } },
  );
  return parseJsonOrError<InvocationsResponse>(res);
}

export async function fetchModules(
  workspace: string,
  conversationId: string,
): Promise<ModulesResponse> {
  const res = await hostFetch(
    conversationsPath(workspace, `/${encodeURIComponent(conversationId)}/modules`),
    { headers: { Accept: 'application/json' } },
  );
  return parseJsonOrError<ModulesResponse>(res);
}

export function evidenceAnchorParams(anchor: EvidenceAnchor): URLSearchParams {
  const params = new URLSearchParams();
  params.set('request_id', anchor.request_id);
  params.set('submission_index', String(anchor.submission_index));
  params.set('evidence_id', anchor.evidence_id);
  params.set('sha256', anchor.sha256);
  return params;
}

export function evidenceContentUrl(workspace: string, anchor: EvidenceAnchor): string {
  return `/api/workspaces/${encodeURIComponent(workspace)}/evidence-content?${evidenceAnchorParams(anchor).toString()}`;
}

export async function fetchEvidencePreview(
  workspace: string,
  anchor: EvidenceAnchor,
): Promise<EvidencePreviewResponse> {
  const url = `/api/workspaces/${encodeURIComponent(workspace)}/evidence-preview?${evidenceAnchorParams(anchor).toString()}`;
  const res = await hostFetch(url, { headers: { Accept: 'application/json' } });
  return parseJsonOrError<EvidencePreviewResponse>(res);
}

export async function fetchEvidenceTable(
  workspace: string,
  anchor: EvidenceAnchor,
  offset: number,
  limit: number,
): Promise<EvidenceTableResponse> {
  const params = evidenceAnchorParams(anchor);
  params.set('offset', String(offset));
  params.set('limit', String(limit));
  const url = `/api/workspaces/${encodeURIComponent(workspace)}/evidence-table?${params.toString()}`;
  const res = await hostFetch(url, { headers: { Accept: 'application/json' } });
  return parseJsonOrError<EvidenceTableResponse>(res);
}

export function evidenceAnchorKey(anchor: EvidenceAnchor): string {
  return `${anchor.request_id}:${anchor.submission_index}:${anchor.evidence_id}:${anchor.sha256}`;
}

function normalizeEvidenceRef(
  raw: EvidenceRef,
  fallbackRequestId?: string,
  fallbackSubmissionIndex?: number,
): EvidenceRef | null {
  const reqId = raw.request_id || fallbackRequestId || '';
  const subIdx =
    typeof raw.submission_index === 'number' ? raw.submission_index : fallbackSubmissionIndex;
  const evId = raw.evidence_id || (raw as { id?: string }).id || '';
  if (!reqId || typeof subIdx !== 'number' || !evId || !raw.sha256) {
    return null;
  }
  return {
    ...raw,
    request_id: reqId,
    submission_index: subIdx,
    evidence_id: evId,
  };
}

/** Collects actual request-level recorded EvidenceRefs from Governance snapshots without fabricating any items. */
export function collectRequestEvidenceRefs(
  requestId: string | null,
  routesData: RoutesData | null | undefined,
  contextData: ContextData | null | undefined,
  treeData: TreeData | null | undefined,
): EvidenceRef[] {
  if (!requestId) {
    return [];
  }
  const byKey = new Map<string, EvidenceRef>();
  const add = (
    raw: EvidenceRef,
    fallbackReqId?: string,
    fallbackSubIdx?: number,
    stepId?: string,
    submissionStatus?: string,
  ) => {
    const ref = normalizeEvidenceRef(raw, fallbackReqId, fallbackSubIdx);
    if (!ref || ref.request_id !== requestId) {
      return;
    }
    const key = evidenceAnchorKey(ref);
    const prev = byKey.get(key);
    byKey.set(key, {
      ...prev,
      ...ref,
      step_id: ref.step_id ?? stepId ?? prev?.step_id,
      submission_status: ref.submission_status ?? submissionStatus ?? prev?.submission_status,
    });
  };

  for (const attempt of routesData?.attempts ?? []) {
    if (attempt.request_id !== requestId) {
      continue;
    }
    for (const ref of attempt.evidence ?? []) {
      add(ref, attempt.request_id, attempt.submission_index, attempt.step_id, attempt.submission_status);
    }
  }
  for (const sub of contextData?.shared?.recent_submissions ?? []) {
    if (sub.request_id !== requestId) {
      continue;
    }
    for (const ref of sub.evidence ?? []) {
      add(ref, sub.request_id, sub.submission_index, sub.step_id, sub.submission_status);
    }
  }
  for (const shared of treeData?.shared_evidence ?? []) {
    for (const ref of shared.references ?? []) {
      add(ref);
    }
  }
  return Array.from(byKey.values()).sort(
    (a, b) => a.submission_index - b.submission_index || a.evidence_id.localeCompare(b.evidence_id),
  );
}

/** Collects actual scope-level historical EvidenceRefs across requests in a Governance scope. */
export function collectScopeEvidenceRefs(
  scopeId: string | null,
  routesData: RoutesData | null | undefined,
  contextData: ContextData | null | undefined,
): EvidenceRef[] {
  if (!scopeId) {
    return [];
  }
  const byKey = new Map<string, EvidenceRef>();
  const add = (
    raw: EvidenceRef,
    fallbackReqId?: string,
    fallbackSubIdx?: number,
    stepId?: string,
    submissionStatus?: string,
  ) => {
    const ref = normalizeEvidenceRef(raw, fallbackReqId, fallbackSubIdx);
    if (!ref) {
      return;
    }
    const key = evidenceAnchorKey(ref);
    const prev = byKey.get(key);
    byKey.set(key, {
      ...prev,
      ...ref,
      step_id: ref.step_id ?? stepId ?? prev?.step_id,
      submission_status: ref.submission_status ?? submissionStatus ?? prev?.submission_status,
    });
  };

  if (routesData && routesData.scope_id === scopeId) {
    for (const attempt of routesData.attempts ?? []) {
      for (const ref of attempt.evidence ?? []) {
        add(ref, attempt.request_id, attempt.submission_index, attempt.step_id, attempt.submission_status);
      }
    }
  }
  if (contextData?.shared?.scope?.scope_id === scopeId) {
    for (const sub of contextData.shared.recent_submissions ?? []) {
      for (const ref of sub.evidence ?? []) {
        add(ref, sub.request_id, sub.submission_index, sub.step_id, sub.submission_status);
      }
    }
  }
  return Array.from(byKey.values()).sort(
    (a, b) =>
      a.request_id.localeCompare(b.request_id) ||
      a.submission_index - b.submission_index ||
      a.evidence_id.localeCompare(b.evidence_id),
  );
}

export function classifyEvidenceFormat(
  name: string | undefined,
  kind?: string,
): 'pdf' | 'table' | 'image' | 'html' | 'code' | 'unsupported' {
  if (kind && kind !== 'file') {
    return 'unsupported';
  }
  const lower = (name ?? '').toLowerCase();
  const dot = lower.lastIndexOf('.');
  const ext = dot >= 0 ? lower.slice(dot) : '';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.csv' || ext === '.tsv' || ext === '.tab') return 'table';
  if (ext === '.png' || ext === '.jpg' || ext === '.jpeg' || ext === '.gif' || ext === '.webp') {
    return 'image';
  }
  if (ext === '.html' || ext === '.htm') return 'html';
  if (
    ext === '' ||
    [
      '.txt', '.json', '.md', '.log', '.fa', '.fasta', '.faa', '.fna',
      '.tree', '.treefile', '.nwk', '.newick', '.py', '.r', '.sh',
      '.yaml', '.yml', '.xml', '.js', '.ts', '.css',
    ].includes(ext)
  ) {
    return 'code';
  }
  return 'unsupported';
}
