/**
 * BioHarness bilingual (zh-Hans / en) UI copy and scientific status formatters
 * powered by LibreChat's adopted react-i18next instance (not upstream LibreChat code).
 */
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

export function isChineseLanguage(lang: string | undefined): boolean {
  if (!lang) {
    return false;
  }
  return lang.toLowerCase().startsWith('zh');
}

export function useBhText() {
  const { i18n } = useTranslation();
  const zh = isChineseLanguage(i18n.resolvedLanguage || i18n.language);
  const tr = useCallback((zhText: string, enText: string) => (zh ? zhText : enText), [zh]);
  return { zh, tr };
}

export function formatPhaseLabel(phase: string | null | undefined, zh: boolean): string {
  const map: Record<string, [string, string]> = {
    IDLE: ['空闲', 'Idle'],
    NEEDS_PLAN: ['待制定计划', 'Needs plan'],
    WORKING: ['进行中', 'Working'],
    WAIT_FOR_USER: ['待用户回应', 'Waiting for user'],
    REVISE_PLAN: ['需修订计划', 'Revise plan'],
    DELIVERED: ['已交付', 'Delivered'],
    PARTIAL_DELIVERED: ['部分交付', 'Partial delivery'],
    COMPLETED: ['已完成', 'Completed'],
  };
  if (!phase) {
    return zh ? '未知阶段' : 'Unknown';
  }
  const hit = map[phase.toUpperCase()];
  return hit ? (zh ? hit[0] : hit[1]) : phase;
}

export function formatRunStateLabel(state: string | null | undefined, zh: boolean): string {
  const map: Record<string, [string, string]> = {
    RUNNING: ['运行中', 'Running'],
    FINISHED: ['已完成', 'Finished'],
    CANCELLED: ['已取消', 'Cancelled'],
    FAILED: ['失败', 'Failed'],
    INTERRUPTED: ['已中断', 'Interrupted'],
  };
  if (!state) {
    return '';
  }
  const hit = map[state.toUpperCase()];
  return hit ? (zh ? hit[0] : hit[1]) : state;
}

export function formatOpKindLabel(kind: string, zh: boolean): string {
  const map: Record<string, [string, string]> = {
    all: ['全部类型', 'All'],
    core: ['Core 主线', 'Core'],
    model: ['模型推理', 'Model'],
    tool: ['模块工具', 'Tool'],
    hook: ['宿主钩子', 'Hook'],
  };
  const hit = map[kind.toLowerCase()];
  return hit ? (zh ? hit[0] : hit[1]) : kind;
}

export function formatOpStateLabel(state: string, zh: boolean): string {
  const map: Record<string, [string, string]> = {
    all: ['全部状态', 'All'],
    STARTED: ['进行中', 'Started'],
    SUCCEEDED: ['成功', 'Succeeded'],
    REFUSED: ['已拒绝', 'Refused'],
    FAILED: ['失败', 'Failed'],
    UNKNOWN: ['结果未知', 'Unknown'],
    CANCELLED: ['已取消', 'Cancelled'],
  };
  const hit = map[state] ?? map[state.toUpperCase()];
  return hit ? (zh ? hit[0] : hit[1]) : state;
}

export function formatCompactTime(iso: string | null | undefined, zh: boolean): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso.slice(0, 16);
  }
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSec >= 0 && diffSec < 60) {
    return zh ? '刚刚' : 'just now';
  }
  if (diffSec >= 60 && diffSec < 3600) {
    const mins = Math.floor(diffSec / 60);
    return zh ? `${mins} 分钟前` : `${mins}m ago`;
  }
  if (diffSec >= 3600 && diffSec < 86400) {
    const hrs = Math.floor(diffSec / 3600);
    return zh ? `${hrs} 小时前` : `${hrs}h ago`;
  }
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${m}-${d} ${h}:${min}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
