export type TaskStatus =
  | "WAITING"
  | "RUNNING"
  | "FINISHED"
  | "FAILED"
  | "ATTENTION";

export type TaskStage =
  | "TASK"
  | "MEMORY"
  | "DATA"
  | "ASSESSMENT"
  | "PLANNING"
  | "POLICY"
  | "EXECUTION"
  | "COLLECTION"
  | "VALIDATION"
  | "RESULT";

export type NodeStatus =
  | "WAITING"
  | "ACTIVE"
  | "COMPLETED"
  | "FAILED"
  | "ATTENTION"
  | "UNKNOWN";

export interface TaskSummary {
  id: string;
  title: string;
  analysis_class: string;
  status: TaskStatus;
  stage: TaskStage;
  updated_at: string;
  needs_attention: boolean;
}

export interface TaskNode {
  id: string;
  type: TaskStage;
  label: string;
  status: NodeStatus;
  attempt_number?: number | null;
  attempt_count?: number | null;
  attention_reason?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  detail_ref: string;
}

export interface TaskEdge {
  source: string;
  target: string;
}

export interface TaskGraphModel {
  task: TaskSummary;
  nodes: TaskNode[];
  edges: TaskEdge[];
  revision: string;
}

export interface EvidencePreviewRef {
  id: string;
  role: string;
  run_attempt_id?: string | null;
  name: string;
  source_path: string;
  preview_ref: string;
}

export interface EvidencePreview {
  id: string;
  role: string;
  name: string;
  format: string;
  size_bytes: number;
  truncated: boolean;
  content: string;
}

export interface NodeDetail {
  node: TaskNode;
  summary: Record<string, unknown>;
  events: Record<string, unknown>[];
  evidence_refs: string[];
  evidence_previews?: EvidencePreviewRef[];
  links: string[];
}
