// Display labels for values the owners return. An unknown value is shown as it
// is; nothing here maps one scientific state onto another.

const PHASE: Record<string, string> = {
  IDLE: "无开放请求",
  NEEDS_PLAN: "待提交计划",
  WORK: "执行步骤",
  READY_TO_DELIVER: "可交付",
  DELIVERED: "已交付",
};

const ACTION: Record<string, string> = {
  BEGIN: "开始新请求",
  SUBMIT_PLAN: "提交计划",
  DO_STEP: "执行当前步骤",
  REVISE_PLAN: "修订计划",
  DELIVER: "交付",
  WAIT_FOR_USER: "等待用户",
  DONE: "已结束",
};

const STATUS: Record<string, string> = {
  PENDING: "未提交",
  DONE: "已完成",
  PARTIAL: "部分完成",
  SKIPPED: "已跳过",
  FAILED: "失败",
  OPEN: "开放",
  DELIVERED: "已交付",
  CLOSED: "已关闭",
};

const KIND: Record<string, string> = {
  KNOWLEDGE: "知识",
  ANALYSIS: "分析",
  EXPLORE: "探索",
};

const REVIEW: Record<string, string> = {
  UNREVIEWED: "未评审",
  NONE: "无评审记录",
};

const IDENTITY: Record<string, string> = {
  MATCHES_RECORD: "当前文件与记录一致",
  DIFFERS_FROM_RECORD: "当前文件与记录不一致",
  NOT_CHECKED: "未核对当前文件",
  MATCH: "一致",
  MISMATCH: "不一致",
  UNAVAILABLE: "不可用",
  NOT_SNAPSHOTTED: "未留存快照",
};

const UNAVAILABLE: Record<string, string> = {
  CONTENT_NOT_EXPOSED_BY_PUBLIC_INTERFACE: "公开接口不提供这类证据的内容",
  NOT_AVAILABLE_IN_CONFIGURED_ROOTS: "文件不在本服务配置的证据目录内,或已不存在",
  BINARY_PREVIEW_NOT_SUPPORTED: "二进制文件不支持预览",
};

function label(map: Record<string, string>, value: unknown): string {
  if (value === null || value === undefined || value === "") return "未提供";
  const text = String(value);
  return map[text] ?? text;
}

export const phaseLabel = (value: unknown) => label(PHASE, value);
export const actionLabel = (value: unknown) => label(ACTION, value);
export const statusLabel = (value: unknown) => label(STATUS, value);
export const kindLabel = (value: unknown) => label(KIND, value);
export function reviewLabel(value: unknown): string {
  const text = label(REVIEW, value);
  // Core reports a reviewed step as "REVIEWED:<verdict>"; the verdict is shown as given.
  return text.startsWith("REVIEWED:") ? "已评审:" + text.slice("REVIEWED:".length) : text;
}
export const identityLabel = (value: unknown) => label(IDENTITY, value);
export const unavailableLabel = (value: unknown) => label(UNAVAILABLE, value);

export function formatTime(value: unknown): string {
  if (typeof value !== "string" || !value) return "未提供";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "未提供";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value, null, 2);
}
