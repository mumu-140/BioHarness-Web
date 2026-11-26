import type { OmittedValue } from "./api/types";

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

const OP_STATE: Record<string, string> = {
  STARTED: "进行中",
  SUCCEEDED: "已返回",
  REFUSED: "被拒绝",
  FAILED: "失败",
  UNKNOWN: "结果未知",
  CANCELLED: "已取消",
  FINISHED: "已结束",
  INTERRUPTED: "已中断",
};

const OP_KIND: Record<string, string> = {
  core: "Core",
  hook: "Core hook",
  model: "模型",
  tool: "工具",
};

const MODULE_STATE: Record<string, string> = {
  NOT_OBSERVED: "未观察",
  LISTED: "已列出工具（上次观察）",
  UNAVAILABLE: "不可用",
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
export const operationStateLabel = (value: unknown) => label(OP_STATE, value);
export const operationKindLabel = (value: unknown) => label(OP_KIND, value);
export const moduleStateLabel = (value: unknown) => label(MODULE_STATE, value);

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

export function formatBytes(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "未提供";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(startedAt: unknown, endedAt: unknown): string {
  if (typeof startedAt !== "string" || typeof endedAt !== "string" || !startedAt || !endedAt) {
    return "未提供";
  }
  const start = new Date(startedAt).getTime();
  const end = new Date(endedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return "未提供";
  const ms = end - start;
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function isOmittedValue(value: unknown): value is OmittedValue {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).omitted === true &&
    typeof (value as Record<string, unknown>).characters === "number" &&
    typeof (value as Record<string, unknown>).head === "string"
  );
}

export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}
