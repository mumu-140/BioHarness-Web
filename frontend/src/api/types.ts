// Shapes of what the backend returns. Owner data (Core, Project Governance) is
// typed loosely on purpose: the UI shows what is present and marks the rest as
// not provided, instead of assuming fields the owner did not send.

export type ViewName = "open" | "now" | "tree" | "context" | "routes" | "evidence";

export type Selector = Record<string, string | number | boolean | undefined>;

export interface SourceError {
  origin: "core" | "project-governance" | "web";
  code: string | null;
  message: string;
  detail?: Record<string, unknown>;
}

export interface Snapshot<T = Record<string, unknown>> {
  service: string;
  workspace: string;
  view: ViewName;
  selector: Selector;
  source: { owner: "core" | "project-governance"; interface: string };
  observed_at: string;
  ok: boolean;
  data: T | null;
  error: SourceError | null;
  source_version: Record<string, string> | null;
  content_sha256: string;
  shortened: { note?: string; fields?: string[] } | null;
  warnings: string[];
}

export interface Meta {
  service: string;
  workspaces: string[];
  poll_interval_seconds: number;
  tools: Record<string, { command: string; found: boolean }>;
  runtime?: { enabled: boolean; model: string | null; module_tool_servers: string[] };
}

// ---- native runtime: conversations, runs and the recorded event log ----------
export interface Conversation {
  id: string;
  workspace: string;
  request_id: string | null;
  created_at: string;
  last_run_state?: string | null;
}

export interface ConversationState {
  conversation: Conversation;
  active_run: { id: string } | null;
  begin_reconcile: "OUTCOME_UNKNOWN" | "EXISTING_REQUEST" | null;
  begin_candidates: (OpenRequest & { question_match: string })[];
  open_listing: { listed: number; may_be_incomplete: boolean; source_message: string | null } | null;
}

export interface ConversationEvent {
  seq: number | null; // null: text still being written, not a recorded event
  run_id: string | null;
  type: string;
  data: Record<string, unknown>;
  at?: string;
}

// ---- Core: science_now ------------------------------------------------------
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
  review: string;
}

export interface NowData {
  request_id: string;
  question?: string;
  original_task_text?: string;
  question_type?: string;
  phase: string;
  action: string;
  must_not_stop?: boolean;
  instruction?: string;
  anchor?: string;
  call?: { tool: string; arguments?: Record<string, unknown> };
  plan?: Plan;
  progress?: { done: number; total: number; steps: StepProgress[] };
  step?: PlanStep & { attempt?: number; last_review?: Record<string, unknown> };
  also_available?: string[];
  optional_explore_steps?: string[];
  unresolved_steps?: { id: string; status: string; summary: string }[];
  open_concerns?: { about: string; concern: string }[];
  mainline?: {
    version: number;
    purpose: string;
    requirements: Record<string, string>;
    amendments?: Record<string, unknown>[];
  };
  mainline_amendment_pending?: { id: string; proposed: unknown; reason: string; note: string };
  waiting_for_user?: { question?: string; at?: string };
  deviations?: unknown[];
  retained_historical_submissions?: number;
  evidence_changed_since_submission?: string[];
  scope_context?: Record<string, unknown>;
  // delivered requests
  delivery_kind?: string;
  answer?: string;
  limitations?: string[];
  disclosure?: string;
  scientific_truth_verified?: boolean;
  execution_verified?: boolean;
}

export interface OpenRequest {
  request_id: string;
  question?: string;
  updated_at?: string;
  scope_id?: string;
  project_id?: string;
}

export interface OpenData {
  core_state_present: boolean;
  open_requests: OpenRequest[];
  may_be_incomplete: boolean;
  source_message: string | null;
}

// ---- Project Governance -----------------------------------------------------
export interface RecordRef {
  request_id: string;
  scope_id: string | null;
  revision?: number;
  request_status: string;
  delivery_kind?: string | null;
}

export interface ScopeNode {
  scope_id: string;
  path: string[];
  parent_scope_id: string | null;
  objective: string;
  mainline_version: number;
  origin: RecordRef;
  request_count: number;
  requests?: RecordRef[];
}

export interface GoalChange extends RecordRef {
  changed_scope_goals: { scope_id: string; bound_version: number; current_version: number }[];
}

export interface RelatedRequest {
  source_request_id: string;
  target_request_id: string;
  type: string;
  target_available: boolean;
}

export interface EvidenceRef {
  request_id: string;
  submission_index: number;
  evidence_id: string;
  sha256: string;
  source?: string;
  kind?: string;
  bytes?: number | null;
  snapshot?: boolean;
}

export interface TreeData {
  project_id?: string;
  projects?: ScopeNode[];
  nodes: ScopeNode[];
  related_requests?: RelatedRequest[];
  shared_evidence?: { sha256: string; references: EvidenceRef[] }[];
  goal_version_changes?: GoalChange[];
  request_binding?: RecordRef & { path?: string[] | null };
  binding_note?: string;
  review_note?: string;
  note?: string;
}

export interface Attempt extends RecordRef {
  submission_index: number;
  step_id: string;
  plan_version?: number | null;
  at?: string | null;
  submission_status: string;
  summary: string;
  method_used: string;
  parameters_used: Record<string, unknown>;
  declared_conditions: unknown;
  condition_gaps: string[];
  execution_verified: boolean;
  evidence: EvidenceRef[];
}

export interface RoutesData {
  scope_id: string;
  included_scope_ids: string[];
  attempt_count: number;
  offset: number;
  attempts: Attempt[];
  note?: string;
}

export interface EvidencePreview {
  evidence_id: string;
  kind: string;
  name: string;
  recorded_sha256: string;
  recorded_bytes: number | null;
  content_available: boolean;
  unavailable_reason: string | null;
  current_file_identity: "MATCHES_RECORD" | "DIFFERS_FROM_RECORD" | "NOT_CHECKED";
  format?: string;
  size_bytes?: number;
  truncated?: boolean;
  content: string | null;
}

export interface EvidencePreviewResponse {
  ok: boolean;
  selector: Selector;
  error?: SourceError;
  recorded_reference?: string;
  snapshot_integrity?: string;
  source_note?: string;
  preview?: EvidencePreview;
}
