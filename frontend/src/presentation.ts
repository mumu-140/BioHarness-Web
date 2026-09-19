import type {
  NodeStatus,
  TaskNode,
  TaskStage,
  TaskStatus,
} from "./api/types";

const STAGE_LABELS: Record<TaskStage, string> = {
  TASK: "任务",
  MEMORY: "记忆",
  DATA: "数据解析",
  ASSESSMENT: "科学评估",
  PLANNING: "分析规划",
  POLICY: "权限检查",
  EXECUTION: "执行",
  COLLECTION: "结果收集",
  VALIDATION: "验证",
  RESULT: "结果",
};

const STATUS_LABELS: Record<string, string> = {
  WAITING: "等待中",
  RUNNING: "运行中",
  FINISHED: "已完成",
  FAILED: "失败",
  ATTENTION: "需处理",
  ACTIVE: "运行中",
  COMPLETED: "已完成",
  UNKNOWN: "未知",
  SUBMITTING: "提交中",
  COLLECTING: "收集中",
  NEEDS_OPERATOR_RECONCILIATION: "需要人工核验",
};

const NODE_TITLES: Record<TaskStage, string> = {
  TASK: "研究问题",
  MEMORY: "任务记忆",
  DATA: "解析输入数据",
  ASSESSMENT: "科学可行性评估",
  PLANNING: "生成分析方案",
  POLICY: "检查执行权限",
  EXECUTION: "执行工作流",
  COLLECTION: "收集结果与产物",
  VALIDATION: "验证分析结果",
  RESULT: "整理结果",
};

const EVENT_LABELS: Record<string, string> = {
  AttemptCreated: "创建执行尝试",
  AuthorizationChecked: "完成权限检查",
  SubmissionIntentRecorded: "记录提交意图",
  ExternalProcessBound: "绑定外部进程",
  ExecutionStarted: "开始执行",
  ExecutionExited: "执行进程退出",
  ExecutionOutcomeUnknown: "执行结果未知",
  ArtifactDiscovered: "发现产物",
  ArtifactRegistered: "登记产物",
  CollectionFinished: "完成结果收集",
  ValidationReported: "生成验证报告",
  ReconciliationRequired: "需要人工核验",
  ReconciliationResolved: "完成执行核验",
};

const FIELD_LABELS: Record<string, string> = {
  current_attempt: "当前尝试",
  attempt_history: "历史尝试",
  attempt_number: "尝试次数",
  state: "状态",
  provider_attempt_name: "外部执行名称",
  submitted_at: "提交时间",
  last_reconciled_at: "最近核验时间",
  capability_snapshot: "执行器能力",
  observed_runtime_environment: "运行环境",
  logs: "日志",
  trace: "跟踪记录",
  poll: "轮询",
  cancellation: "取消能力",
  native_idempotency_key: "原生幂等键",
  reconcile_after_disconnect: "断连后核验",
  durable_external_execution_id: "持久外部执行 ID",
  run_spec_hash: "运行规格哈希",
  provider_revision: "Provider 版本",
  resolved_inputs: "已解析输入",
  preflight_evidence: "启动前检查",
  environment: "环境检查",
  logical_uri: "逻辑资源",
  manifest_sha256: "清单 SHA-256",
  member_manifest_sha256: "成员清单 SHA-256",
  role: "角色",
  uri: "路径 / URI",
  sha256: "SHA-256",
  artifact_id: "产物 ID",
  artifact_count: "产物数量",
  kind: "类型",
  statement: "内容",
  status: "状态",
  used: "已使用",
  used_refs: "已使用记忆引用",
  available_candidates: "关联记忆",
  reports: "验证报告",
  evaluations: "验证结论",
  validation_profile_id: "验证方案 ID",
  validation_profile_revision: "验证方案版本",
  outcome: "结果",
  evidence: "证据",
  exit_code: "退出码",
  terminal_outcome: "终态结果",
  active: "是否仍在运行",
  mode: "执行模式",
  executor_namespace: "执行器命名空间",
  host: "主机",
  executor: "执行器",
  cpu_count: "CPU 数量",
  memory_gb: "内存（GB）",
  pid: "进程 PID",
  process_start_token: "进程启动标识",
  external_execution_id: "外部执行 ID",
  metadata: "元数据",
  path: "路径",
  process_probe: "进程探测",
  executor_evidence: "执行器证据",
};

const EVIDENCE_ROLE_LABELS: Record<string, string> = {
  process_record: "进程记录",
  wrapper_stdout: "包装器标准输出",
  wrapper_stderr: "包装器错误输出",
  provider_invocation: "Provider 调用参数",
  resolved_manifest: "解析输入清单",
  execution_log: "执行日志",
  execution_trace: "执行跟踪",
  candidate_manifest: "候选结果清单",
  audit_table: "审计表",
  alignment: "序列比对",
  tree: "系统发育树",
};

const VALUE_LABELS: Record<string, string> = {
  unsupported: "不支持",
  limited: "有限支持",
  synchronous_process: "同步进程",
  succeeded: "成功",
  failed: "失败",
  PASS: "通过",
  FAIL: "失败",
  ALLOW: "允许",
  DENY: "拒绝",
};

export function stageLabel(stage: TaskStage): string {
  return STAGE_LABELS[stage] ?? stage;
}

export function statusLabel(status: TaskStatus | NodeStatus | string): string {
  return STATUS_LABELS[String(status)] ?? String(status);
}

export function nodeTitle(node: TaskNode): string {
  return NODE_TITLES[node.type] ?? stageLabel(node.type);
}

export function eventLabel(eventType: unknown): string {
  const value = String(eventType ?? "事件");
  return EVENT_LABELS[value] ?? value;
}

export function fieldLabel(field: string): string {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  return field
    .replaceAll("_", " ")
    .replace(/\b[a-z]/g, (value) => value.toUpperCase());
}

function looksLikeDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T/.test(value);
}

export function formatDateTime(value: unknown): string {
  if (!value) return "—";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (STATUS_LABELS[value]) return STATUS_LABELS[value];
    if (VALUE_LABELS[value]) return VALUE_LABELS[value];
    if (looksLikeDate(value)) return formatDateTime(value);
    return value;
  }
  return String(value);
}


export function evidenceRoleLabel(role: unknown): string {
  const value = String(role ?? "");
  return EVIDENCE_ROLE_LABELS[value] ?? (value || "证据文件");
}
