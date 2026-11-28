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

export interface AvailableModelOption {
  provider_id: string;
  provider_name: string;
  model: string;
}

export interface RunStrategyOption {
  id: 'standard' | 'concise' | 'thorough';
  label: string;
  label_en: string;
  max_turns: number;
  context_chars: number;
  description: string;
}

export interface ModelOverride {
  provider_id: string;
  model: string;
}

export interface WorkspaceInputFile {
  name: string;
  relative_path?: string;
  server_path: string;
  bytes: number;
  extension: string;
  modified_at?: string;
  uploaded_at?: string;
  sha256?: string;
  scope_id?: string | null;
  source_kind: 'uploaded_input' | 'workspace_file' | string;
  evidence_verified: boolean;
  note?: string;
}

export interface AttachmentRef {
  path: string;
  sha256?: string | null;
  name?: string | null;
  bytes?: number | null;
}

export interface WorkspaceInputsResponse {
  workspace: string;
  upload_enabled: boolean;
  upload_disabled_reason: string | null;
  max_upload_bytes: number;
  allowed_extensions: string[];
  files: WorkspaceInputFile[];
  truncated: boolean;
}

export interface BioHarnessMeta {
  service: string;
  workspaces: string[];
  workspace_details?: Record<string, { upload_enabled: boolean }>;
  poll_interval_seconds: number;
  tools: Record<string, { command: string; found: boolean }>;
  runtime: {
    enabled: boolean;
    model: string | null;
    module_tool_servers: string[];
    available_models?: AvailableModelOption[];
    strategies?: RunStrategyOption[];
  };
}

export interface WorkspaceConversation {
  id: string;
  workspace: string;
  request_id: string | null;
  created_at: string;
  updated_at?: string | null;
  first_message?: string | null;
  last_run_state?: string | null;
  last_model?: string | null;
  last_strategy?: string | null;
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
  inputs: (service: string, workspace: string) =>
    ['bh', service, workspace, 'inputs'] as const,
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
  capabilities: (
    service: string,
    workspace: string,
    scopeId?: string | null,
    requestId?: string | null,
    probeMcp?: boolean,
  ) =>
    [
      'bh',
      service,
      workspace,
      'capabilities',
      scopeId ?? 'none',
      requestId ?? 'none',
      Boolean(probeMcp),
    ] as const,
  diagnostics: (service: string, workspace: string) =>
    ['bh', service, workspace, 'diagnostics'] as const,
  memoryStatus: (service: string, workspace: string) =>
    ['bh', service, workspace, 'memory-status'] as const,
  domainModules: (service: string, workspace: string) =>
    ['bh', service, workspace, 'domain-modules'] as const,
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
  body: {
    text?: string;
    request_id?: string;
    scope?: NewScopeSelection;
    model_override?: ModelOverride;
    strategy?: RunStrategyOption['id'];
    attachments?: AttachmentRef[];
  },
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
  opts?: {
    model_override?: ModelOverride;
    strategy?: RunStrategyOption['id'];
    attachments?: AttachmentRef[];
  },
): Promise<{ run_id: string }> {
  const body: Record<string, unknown> = {};
  if (text !== undefined && text !== null) {
    body.text = text;
  }
  if (opts?.model_override) {
    body.model_override = opts.model_override;
  }
  if (opts?.strategy) {
    body.strategy = opts.strategy;
  }
  if (opts?.attachments && opts.attachments.length > 0) {
    body.attachments = opts.attachments;
  }
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

export async function fetchWorkspaceInputs(workspace: string): Promise<WorkspaceInputsResponse> {
  const res = await hostFetch(`/api/workspaces/${encodeURIComponent(workspace)}/inputs`);
  return parseJsonOrError<WorkspaceInputsResponse>(res);
}

export async function uploadWorkspaceInput(
  workspace: string,
  file: File,
  scopeId?: string | null,
): Promise<WorkspaceInputFile> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/octet-stream',
    'X-BioHarness-Filename': encodeURIComponent(file.name),
  };
  if (scopeId && scopeId.trim()) {
    headers['X-BioHarness-Scope'] = encodeURIComponent(scopeId.trim());
  }
  const res = await hostFetch(`/api/workspaces/${encodeURIComponent(workspace)}/inputs`, {
    method: 'POST',
    headers,
    body: file,
  });
  return parseJsonOrError<WorkspaceInputFile>(res);
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
      const rawAttachments = Array.isArray(event.data.attachments)
        ? (event.data.attachments as Array<{
            name?: string;
            server_path?: string;
            relative_path?: string;
            sha256?: string;
          }>)
        : [];
      const attachmentNote =
        rawAttachments.length > 0
          ? '\n\n---\n' +
            rawAttachments
              .map((att) => {
                const label = att.name || att.relative_path || att.server_path || 'input';
                const shortSha = att.sha256 ? ` · sha256:${att.sha256.slice(0, 12)}` : '';
                return `📎 \`${label}\`${shortSha}`;
              })
              .join('  \n')
          : '';
      rows.push({
        id: `e-${seq}`,
        isCreatedByUser: true,
        sender: 'User',
        text: text + attachmentNote,
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


/* ===================== R3.3 Capabilities, Memory & Diagnostics ===================== */

export type MemoryRecallMode = 'FAST' | 'STANDARD' | 'DEEP';
export type MemoryExpandDetail = 'T1' | 'T2' | 'T3';
export type MemoryUseStage = 'selected' | 'consumed' | 'outcome_reported';

export interface MemoryStatusCapabilities {
  recall_modes: {
    FAST: boolean;
    STANDARD: boolean;
    DEEP: boolean;
  };
  deep_unavailable_reason?: string;
  curator_interactive_publish: boolean;
  curator_tools?: string[];
  curator_gap_note?: string | null;
}

export interface MemoryStatusMetrics {
  schema_version?: string;
  scope_ref?: string;
  active_memory_count?: number;
  theme_count?: number;
  pending_candidate_count?: number;
  backend?: string;
  [key: string]: unknown;
}

export interface MemoryDiagnoseMetrics {
  scope_ref?: string;
  active_count?: number;
  theme_count?: number;
  stale_theme_count?: number;
  orphan_memory_count?: number;
  themes_with_one_member?: number;
  source_current_count?: number;
  source_issue_count?: number;
  source_issues?: unknown[];
  exact_duplicate_group_count?: number;
  shared_source_group_count?: number;
  context_trigger_keys?: string[] | Record<string, unknown>;
  use_feedback?: {
    events?: number;
    consumed?: number;
    reported_failures?: number;
    without_reported_use?: number;
  };
  pending_candidates?: {
    state?: string;
    count?: number;
  };
  [key: string]: unknown;
}

export interface MemoryOverviewResponse {
  configured: boolean;
  callable: boolean;
  server: string | null;
  checked_at: string;
  tools: string[];
  status: MemoryStatusMetrics | null;
  diagnose: MemoryDiagnoseMetrics | null;
  capabilities: MemoryStatusCapabilities;
  error: { code: string; message: string } | null;
}

export interface MemoryConditionHint {
  key: string;
  expected_value?: string;
  state: string;
  instruction?: string;
}

export interface MemoryRecallCandidate {
  memory_ref: string;
  under?: string;
  applicability: 'APPLICABLE' | 'NEEDS_REVIEW' | 'INAPPLICABLE' | string;
  missing_conditions?: string[];
  conflicting_conditions?: string[];
  condition_hints?: MemoryConditionHint[];
  source_status?: string;
  verification_status?: string;
}

export interface MemoryRecallTheme {
  t1_ref: string;
  title: string;
  scope: string;
  member_count: number;
  shown_members?: number;
  stale: boolean;
}

export interface MemoryRecallResponse {
  server: string;
  mode: MemoryRecallMode;
  result: {
    scope_ref?: string;
    backend?: string;
    included_refs?: string[];
    context_text?: string;
    warnings?: string[];
    themes?: MemoryRecallTheme[];
    candidates?: MemoryRecallCandidate[];
    relations?: Array<{ relation_id?: string; kind?: string }>;
    scientific_validation?: string;
    [key: string]: unknown;
  };
}

export interface MemoryExpandT3Source {
  source_ref: string;
  source_revision: string;
  record_sha256: string;
  relative_path: string;
  line: number;
  text: string | null;
}

export interface MemoryExpandResponse {
  server: string;
  detail: MemoryExpandDetail;
  result: {
    t1_ref?: string;
    title?: string;
    scope?: string;
    cues?: string[];
    summary?: string;
    stale?: boolean;
    members?: Array<{
      memory_ref: string;
      applicability: string;
      source_status?: string;
      gist?: string;
      expected_conditions?: Record<string, string>;
    }>;
    memory_ref?: string;
    detail?: string;
    verification_status?: string;
    source_status?: string;
    conditions_to_confirm?: string[];
    content?: unknown;
    sources?: MemoryExpandT3Source[];
    [key: string]: unknown;
  };
}

export interface CapabilityResourceItem {
  id: string;
  kind?: string;
  title?: string;
  how_to_use?: string;
  declared: boolean;
  installed: boolean;
  callable: boolean | null;
  actually_used: boolean;
  use_count: number;
}

export interface CapabilitySkillItem {
  id: string;
  name: string;
  description: string;
  source: string;
  truncated?: boolean;
  declared: boolean;
  installed: boolean;
  callable: boolean | null;
  callable_note?: string;
  actually_used: boolean;
  use_count: number;
}

export interface CapabilityMcpServerItem {
  server: string;
  command: string;
  declared: boolean;
  installed: boolean;
  callable: boolean | null;
  tools: Array<{ name: string; description?: string }>;
  error: { code: string; message: string } | null;
  actually_used?: boolean;
  use_count?: number;
}

export interface CapabilityCliModuleItem {
  id: string;
  command: string;
  description: string;
  declared: boolean;
  installed: boolean;
  callable: boolean;
  actually_used: boolean;
  use_count: number;
}

export interface GovernanceLoadedDoc {
  path?: string;
  source?: string;
  size_bytes?: number;
  sha256?: string;
  truncated?: boolean;
  preview?: string;
  [key: string]: unknown;
}

export interface CapabilitiesResponse {
  service: string;
  workspace: string;
  observed_at: string;
  core_state_present: boolean;
  doctor: {
    status?: string;
    checks?: Array<{ check?: string; status?: string; detail?: string }>;
    [key: string]: unknown;
  } | null;
  doctor_error: string | null;
  resources: CapabilityResourceItem[];
  skills: CapabilitySkillItem[];
  mcp_servers: CapabilityMcpServerItem[];
  cli_modules: CapabilityCliModuleItem[];
  documents: {
    scope_id: string | null;
    candidates: string[];
    selected: Record<string, string>;
    loaded: Record<string, GovernanceLoadedDoc>;
    error: string | null;
  };
  observed_usage: {
    servers: Record<string, number>;
    tools: Record<string, number>;
    total_tool_calls: number;
  };
  compute: {
    remote_compute_enabled: boolean;
    phase: string;
    note: string;
  };
}

export interface DiagnosticsResponse {
  service: string;
  workspace: string;
  exported_at: string;
  security_posture: {
    auth_mode: string;
    token_length_ok: boolean;
    upload_root_configured: boolean;
    symlink_containment_enforced: boolean;
    provider_keys_server_side_only: boolean;
    arbitrary_shell_blocked: boolean;
    remote_compute_enabled: boolean;
  };
  runtime: {
    enabled: boolean;
    model_configured: string | null;
    mcp_servers: CapabilityMcpServerItem[];
  };
  core_doctor: CapabilitiesResponse['doctor'];
  core_doctor_error: string | null;
  memory: {
    configured: boolean;
    callable: boolean;
    server: string | null;
    tools: string[];
    status: MemoryStatusMetrics | null;
    diagnose: MemoryDiagnoseMetrics | null;
    capabilities: MemoryStatusCapabilities;
    error: { code: string; message: string } | null;
  };
  modules: {
    skills_count: number;
    resources_count: number;
    cli_modules: CapabilityCliModuleItem[];
  };
  usage: {
    servers: Record<string, number>;
    tools: Record<string, number>;
    total_tool_calls: number;
  };
}

export async function fetchCapabilities(
  workspace: string,
  opts?: {
    scopeId?: string | null;
    requestId?: string | null;
    probeMcp?: boolean;
    documents?: Partial<Record<'contract' | 'guide' | 'status' | 'findings_index', string>>;
  },
): Promise<CapabilitiesResponse> {
  const qs = new URLSearchParams();
  if (opts?.scopeId) qs.set('scope_id', opts.scopeId);
  if (opts?.requestId) qs.set('request_id', opts.requestId);
  if (opts?.probeMcp) qs.set('probe_mcp', 'true');
  if (opts?.documents?.contract) qs.set('doc_contract', opts.documents.contract);
  if (opts?.documents?.guide) qs.set('doc_guide', opts.documents.guide);
  if (opts?.documents?.status) qs.set('doc_status', opts.documents.status);
  if (opts?.documents?.findings_index) qs.set('doc_findings_index', opts.documents.findings_index);
  const query = qs.toString();
  const res = await hostFetch(
    `/api/workspaces/${encodeURIComponent(workspace)}/capabilities${query ? `?${query}` : ''}`,
  );
  return parseJsonOrError<CapabilitiesResponse>(res);
}

export async function fetchDiagnostics(workspace: string): Promise<DiagnosticsResponse> {
  const res = await hostFetch(`/api/workspaces/${encodeURIComponent(workspace)}/diagnostics`);
  return parseJsonOrError<DiagnosticsResponse>(res);
}

export async function fetchMemoryStatus(workspace: string): Promise<MemoryOverviewResponse> {
  const res = await hostFetch(`/api/workspaces/${encodeURIComponent(workspace)}/memory/status`);
  return parseJsonOrError<MemoryOverviewResponse>(res);
}

export async function recallMemory(
  workspace: string,
  body: {
    server?: string;
    query: string;
    task_conditions?: Record<string, string>;
    mode: MemoryRecallMode;
    limit?: number;
  },
): Promise<MemoryRecallResponse> {
  const res = await hostFetch(`/api/workspaces/${encodeURIComponent(workspace)}/memory/recall`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseJsonOrError<MemoryRecallResponse>(res);
}

export async function expandMemory(
  workspace: string,
  body: {
    server?: string;
    memory_ref: string;
    task_conditions?: Record<string, string>;
    detail: MemoryExpandDetail;
  },
): Promise<MemoryExpandResponse> {
  const res = await hostFetch(`/api/workspaces/${encodeURIComponent(workspace)}/memory/expand`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseJsonOrError<MemoryExpandResponse>(res);
}

export async function reportMemoryUse(
  workspace: string,
  body: {
    server?: string;
    event_id: string;
    memory_ref: string;
    task_ref: string;
    stage: MemoryUseStage;
    outcome?: string;
  },
): Promise<{ server: string; result: Record<string, unknown> }> {
  const res = await hostFetch(`/api/workspaces/${encodeURIComponent(workspace)}/memory/report-use`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseJsonOrError(res);
}

export async function proposeMemory(
  workspace: string,
  body: {
    kind: 'candidate' | 'scientific';
    event_id: string;
    summary?: string;
    evidence_locator?: string;
    memory_id?: string;
    t1_core?: string;
    t2_detail?: Record<string, unknown>;
    required_conditions?: Record<string, string>;
    evidence?: Array<Record<string, unknown>>;
  },
): Promise<{ server: string; tool: string; result: Record<string, unknown> }> {
  const res = await hostFetch(`/api/workspaces/${encodeURIComponent(workspace)}/memory/propose`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseJsonOrError(res);
}


/* ===================== R3.4 Professional Scientific Modules ===================== */

export interface DomainModuleEntry {
  id: string;
  title: string;
  owner: string;
  command: string | null;
  version: string | null;
  source_sha: string | null;
  declared: boolean;
  installed: boolean;
  callable: boolean;
  inspectable: boolean;
  actually_used: boolean;
  use_count: number;
  status: string;
  note: string;
  providers?: Record<
    string,
    { command?: string; available: boolean; status?: string; role?: string }
  >;
  actions?: string[];
  subcomponents?: Record<string, string>;
  operations?: string[];
  releases?: Array<{ sha: string; version: string | null }>;
  advisor_config?: {
    configured: boolean;
    factory: string | null;
    timeout_seconds?: number | null;
    parse_error?: boolean;
  };
  direct_model_api_gap_note?: string;
}

export interface DomainModuleRecentInvocation {
  id: string;
  conversation_id: string | null;
  request_id?: string | null;
  scope_id?: string | null;
  module_id: string;
  operation: string;
  state: string;
  input: Record<string, unknown> | null;
  error: { code?: string; message?: string } | null;
  saved_artifact: WorkspaceInputFile | null;
  started_at?: string;
  ended_at?: string | null;
  at: string;
}

export interface DomainModulesResponse {
  service: string;
  workspace: string;
  observed_at: string;
  upload_enabled?: boolean;
  modules: DomainModuleEntry[];
  recent_invocations?: DomainModuleRecentInvocation[];
  workspace_files: {
    json: string[];
    templates: string[];
    structures: string[];
  };
  observed_usage: {
    servers: Record<string, number>;
    tools: Record<string, number>;
    total_tool_calls: number;
  };
}

export interface LiteraturePaperRecord {
  rank?: number;
  record_index?: number;
  title?: string;
  authors?: string[] | string;
  year?: number | string;
  venue?: string;
  doi?: string;
  identifier?: string | null;
  identifier_status?: string;
  abstract?: string;
  url?: string;
  pdf_url?: string;
  source?: string;
  provider?: string;
  status?: string;
  reason?: string;
  file?: string;
  bytes?: number;
  sha256?: string;
  record_indices?: number[];
  [key: string]: unknown;
}

export interface LiteratureInspectResponse {
  operation: 'search' | 'fetch';
  source_file: string;
  sha256: string;
  upstream_contract?: string;
  question?: string;
  source?: string;
  query?: string;
  coverage?: string;
  reported_total_results?: number | null;
  returned_records?: number;
  input_records?: number;
  requested_identifiers?: number;
  downloaded_identifiers?: number;
  unresolved_records?: number;
  validation_scope?: string;
  parameters?: Record<string, unknown>;
  total_items: number;
  offset: number;
  limit: number;
  has_more: boolean;
  items: LiteraturePaperRecord[];
}

export interface LiteratureRunResponse {
  operation: 'search' | 'fetch';
  cli: string;
  result: Record<string, unknown>;
  saved_artifact?: WorkspaceInputFile | null;
  saved_pdfs?: WorkspaceInputFile[];
  save_note?: string | null;
  recorded_in_ledger?: boolean;
}

export interface StatisticsRecord {
  metric_id: string;
  kind?: string;
  unit?: string;
  value?: number | string;
  numerator?: number;
  denominator?: number;
  population?: string;
  stratum?: string;
  event?: Record<string, unknown>;
  given?: Record<string, unknown>;
  method?: string;
  ci_low?: number;
  ci_high?: number;
  ci?: [number, number];
  CI?: [number, number];
  ci_level?: number;
  p_value?: number;
  p_adjusted?: number;
  fdr?: number;
  q_value?: number;
  status?: string;
  display_decimals?: number;
  [key: string]: unknown;
}

export interface StatisticsReportBindingResponse {
  action: 'inspect' | 'render' | 'verify';
  status: string;
  cli: string;
  records_file: string;
  records_sha256: string;
  template_file?: string | null;
  report_file?: string | null;
  records: StatisticsRecord[];
  tables: Array<Record<string, unknown>>;
  binding: {
    status?: string;
    action?: string;
    bound_statements?: number;
    bound_tables?: number;
    bound_total?: number;
    report?: string;
    report_sha256?: string;
  } | null;
  rendered_markdown: string | null;
  saved_artifact?: WorkspaceInputFile | null;
  save_note?: string | null;
  recorded_in_ledger?: boolean;
  error?: { code: string; message: string } | null;
  note: string;
}

export type ProteinOperation =
  | 'structure-inventory'
  | 'structure-compare'
  | 'task-review'
  | 'manifest-review'
  | 'run-audit'
  | 'outcome-audit';

export interface ProteinRunResponse {
  operation: ProteinOperation;
  cli: string;
  input_file: string;
  result: Record<string, unknown>;
  saved_artifact?: WorkspaceInputFile | null;
  save_note?: string | null;
  recorded_in_ledger?: boolean;
}

export async function fetchDomainModules(workspace: string): Promise<DomainModulesResponse> {
  const res = await hostFetch(`/api/workspaces/${encodeURIComponent(workspace)}/domain-modules`);
  return parseJsonOrError<DomainModulesResponse>(res);
}

export async function inspectLiteratureArtifact(
  workspace: string,
  body: { path: string; offset?: number; limit?: number },
): Promise<LiteratureInspectResponse> {
  const res = await hostFetch(
    `/api/workspaces/${encodeURIComponent(workspace)}/modules/literature/inspect`,
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  return parseJsonOrError<LiteratureInspectResponse>(res);
}

export async function runLiteratureModule(
  workspace: string,
  body: {
    operation: 'search' | 'fetch';
    question?: string;
    source?: string;
    maximum?: number;
    iterations?: number;
    search_json_path?: string;
    lanes?: boolean;
    save_output?: boolean;
    conversation_id?: string;
    request_id?: string;
    scope_id?: string;
  },
): Promise<LiteratureRunResponse> {
  const res = await hostFetch(
    `/api/workspaces/${encodeURIComponent(workspace)}/modules/literature/run`,
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  return parseJsonOrError<LiteratureRunResponse>(res);
}

export async function runStatisticsReportBinding(
  workspace: string,
  body: {
    action: 'inspect' | 'render' | 'verify';
    records_path: string;
    template_path?: string;
    report_path?: string;
    save_output?: boolean;
    conversation_id?: string;
    request_id?: string;
    scope_id?: string;
  },
): Promise<StatisticsReportBindingResponse> {
  const res = await hostFetch(
    `/api/workspaces/${encodeURIComponent(workspace)}/modules/statistics/report-binding`,
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  return parseJsonOrError<StatisticsReportBindingResponse>(res);
}

export async function runProteinModule(
  workspace: string,
  body: {
    operation: ProteinOperation;
    input_path: string;
    reference_path?: string;
    mapping_path?: string;
    mode?: string;
    verify_files?: boolean;
    model_index?: number;
    save_output?: boolean;
    conversation_id?: string;
    request_id?: string;
    scope_id?: string;
  },
): Promise<ProteinRunResponse> {
  const res = await hostFetch(
    `/api/workspaces/${encodeURIComponent(workspace)}/modules/protein/run`,
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  return parseJsonOrError<ProteinRunResponse>(res);
}
