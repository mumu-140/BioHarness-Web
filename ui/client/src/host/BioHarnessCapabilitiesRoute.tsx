/**
 * R3.3 Capabilities, Memory Workbench, and Governance Project Documents View
 * (not upstream LibreChat code).
 *
 * Strictly delegates to BioHarness Web thin BFF (`/capabilities`, `/memory/*`):
 * - Separates retrieval depth (`FAST` / `STANDARD` / unimplemented `DEEP`) from information tier (`T1` / `T2` / `T3`).
 * - Surfaces four-state Capabilities matrix (Declared / Installed / Callable / Actually Used).
 * - Preserves honest Curator / R4 Compute boundary disclosures without fabricating unavailable operations.
 */
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BookOpen,
  Boxes,
  Brain,
  CheckCircle2,
  Cpu,
  Database,
  FileCode2,
  FileText,
  Layers,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { Button, Input, Spinner } from '@librechat/client';
import BioHarnessRequestHeader from './BioHarnessRequestHeader';
import BioHarnessDomainModulesPanel from './BioHarnessDomainModulesPanel';
import {
  bhKeys,
  expandMemory,
  extractTreeProjects,
  extractTreeScopes,
  fetchCapabilities,
  fetchMemoryStatus,
  fetchView,
  proposeMemory,
  recallMemory,
  reportMemoryUse,
  type CapabilitiesResponse,
  type MemoryExpandDetail,
  type MemoryExpandResponse,
  type MemoryOverviewResponse,
  type MemoryRecallMode,
  type MemoryRecallResponse,
  type MemoryUseStage,
  type Snapshot,
  type TreeData,
} from './bioharness';
import { formatCompactTime, useBhText } from './i18n';
import { useBioHarnessWorkspace } from './workspace';

type CapabilitiesSubTab = 'memory' | 'capabilities' | 'documents' | 'modules';
type DocRole = 'contract' | 'guide' | 'status' | 'findings_index';

function FourStateBadges({
  declared,
  installed,
  callable,
  callableNullLabel,
  actuallyUsed,
  useCount,
  zh,
}: {
  declared: boolean;
  installed: boolean;
  callable: boolean | null;
  callableNullLabel?: string;
  actuallyUsed: boolean;
  useCount?: number;
  zh: boolean;
}) {
  const pill = (active: boolean | null, yesLabel: string, noLabel: string, unknownLabel = '—') => {
    if (active === null) {
      return (
        <span className="bg-surface-hover text-text-tertiary rounded px-1.5 py-0.5 text-[10px]">
          {unknownLabel}
        </span>
      );
    }
    return (
      <span
        className={
          active
            ? 'rounded bg-teal-500/15 px-1.5 py-0.5 text-[10px] font-medium text-teal-700 dark:text-teal-300'
            : 'bg-surface-hover text-text-tertiary rounded px-1.5 py-0.5 text-[10px]'
        }
      >
        {active ? yesLabel : noLabel}
      </span>
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {pill(declared, zh ? '已声明' : 'Declared', zh ? '未声明' : 'Not declared')}
      {pill(installed, zh ? '已安装' : 'Installed', zh ? '未安装' : 'Not installed')}
      {pill(callable, zh ? '可调用' : 'Callable', zh ? '不可调用' : 'Uncallable', callableNullLabel ?? (zh ? '未探测' : 'Unprobed'))}
      {pill(
        actuallyUsed,
        zh ? `已实际调用${useCount ? ` (${useCount})` : ''}` : `Used${useCount ? ` (${useCount})` : ''}`,
        zh ? '尚未使用' : 'Unused',
      )}
    </div>
  );
}

const BioHarnessCapabilitiesRoute = memo(function BioHarnessCapabilitiesRoute() {
  const { tr, zh } = useBhText();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    service,
    workspace,
    selectedRequestId,
    selectedScopeId,
    linkedConversationId,
    stageTextInConversation,
  } = useBioHarnessWorkspace();

  const rawTab = searchParams.get('tab');
  const activeTab: CapabilitiesSubTab =
    rawTab === 'capabilities' || rawTab === 'documents' || rawTab === 'modules' ? rawTab : 'memory';

  const setActiveTab = (nextTab: CapabilitiesSubTab) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', nextTab);
    setSearchParams(next, { replace: true });
  };

  const contextKey = `${service ?? 'svc'}::${workspace ?? 'ws'}::${selectedScopeId ?? 'none'}::${selectedRequestId ?? 'none'}`;
  const contextKeyRef = useRef(contextKey);
  contextKeyRef.current = contextKey;

  // --- Track last confirmed Memory health timestamp for calm 503 degradation ---
  const [lastConfirmedAt, setLastConfirmedAt] = useState<string | null>(null);
  const [probeMcp, setProbeMcp] = useState<boolean>(activeTab === 'capabilities');

  useEffect(() => {
    if (activeTab === 'capabilities') {
      setProbeMcp(true);
    }
  }, [activeTab]);

  // --- Governance tree for scope picking on the Documents tab ---
  const treeQuery = useQuery<Snapshot<TreeData>>({
    queryKey: bhKeys.view(service ?? 'svc', workspace ?? '', 'tree'),
    queryFn: () => fetchView<TreeData>(workspace!, 'tree'),
    enabled: Boolean(service && workspace),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  const projectScopes = useMemo(() => {
    const combined = [
      ...extractTreeScopes(treeQuery.data),
      ...extractTreeProjects(treeQuery.data),
    ];
    const seen = new Set<string>();
    return combined.filter((item) => {
      if (!item.scope_id || seen.has(item.scope_id)) return false;
      seen.add(item.scope_id);
      return true;
    });
  }, [treeQuery.data]);

  const [docScopeOverride, setDocScopeOverride] = useState<string>('');
  const effectiveDocScopeId =
    docScopeOverride || selectedScopeId || projectScopes[0]?.scope_id || null;

  const [docSelections, setDocSelections] = useState<Partial<Record<DocRole, string>>>({});
  const [appliedDocSelections, setAppliedDocSelections] = useState<Partial<Record<DocRole, string>>>({});

  // --- Capabilities snapshot (lazy when capabilities or documents tab opened) ---
  const capabilitiesQuery = useQuery<CapabilitiesResponse>({
    queryKey: [
      ...bhKeys.capabilities(
        service ?? 'svc',
        workspace ?? '',
        effectiveDocScopeId,
        selectedRequestId,
        probeMcp,
      ),
      appliedDocSelections.contract ?? '',
      appliedDocSelections.guide ?? '',
      appliedDocSelections.status ?? '',
      appliedDocSelections.findings_index ?? '',
    ],
    queryFn: () =>
      fetchCapabilities(workspace!, {
        scopeId: effectiveDocScopeId,
        requestId: selectedRequestId,
        probeMcp,
        documents: appliedDocSelections,
      }),
    enabled: Boolean(service && workspace && (activeTab === 'capabilities' || activeTab === 'documents')),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  // --- Memory Status & Diagnose ---
  const memoryStatusQuery = useQuery<MemoryOverviewResponse>({
    queryKey: bhKeys.memoryStatus(service ?? 'svc', workspace ?? ''),
    queryFn: () => fetchMemoryStatus(workspace!),
    enabled: Boolean(service && workspace && activeTab === 'memory'),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (memoryStatusQuery.data?.callable && memoryStatusQuery.data.checked_at) {
      setLastConfirmedAt(memoryStatusQuery.data.checked_at);
    }
  }, [memoryStatusQuery.data]);

  // --- Memory Recall state (domain-neutral, dynamically driven by Memory MCP metadata) ---
  const [recallQuery, setRecallQuery] = useState('');
  const [recallMode, setRecallMode] = useState<MemoryRecallMode>('FAST');
  const [taskConditions, setTaskConditions] = useState<Array<{ key: string; value: string }>>([]);
  const [extraCondKey, setExtraCondKey] = useState('');
  const [extraCondVal, setExtraCondVal] = useState('');
  const [recallLimit, setRecallLimit] = useState<number>(6);
  const [recallResult, setRecallResult] = useState<MemoryRecallResponse | null>(null);
  const [recallError, setRecallError] = useState<string | null>(null);

  const buildTaskConditions = (): Record<string, string> => {
    const cond: Record<string, string> = {};
    for (const item of taskConditions) {
      if (item.key.trim() && item.value.trim()) {
        cond[item.key.trim()] = item.value.trim();
      }
    }
    if (extraCondKey.trim() && extraCondVal.trim()) {
      cond[extraCondKey.trim()] = extraCondVal.trim();
    }
    return cond;
  };

  const recallMutation = useMutation({
    mutationFn: async () => {
      if (!workspace) {
        throw new Error('No workspace selected');
      }
      const snapKey = contextKeyRef.current;
      const data = await recallMemory(workspace, {
        query: recallQuery.trim(),
        task_conditions: buildTaskConditions(),
        mode: recallMode,
        limit: recallLimit,
      });
      return { snapKey, data };
    },
    onSuccess: ({ snapKey, data }) => {
      if (contextKeyRef.current !== snapKey) return;
      setRecallResult(data);
      setRecallError(null);
      setLastConfirmedAt(new Date().toISOString());
    },
    onError: (err) => {
      setRecallError(err instanceof Error ? err.message : String(err));
    },
  });

  // --- Memory Expand (T1 / T2 / T3) ---
  const [expandedDetail, setExpandedDetail] = useState<MemoryExpandResponse | null>(null);
  const [expandError, setExpandError] = useState<string | null>(null);
  const expandMutation = useMutation({
    mutationFn: async (vars: { memoryRef: string; detail: MemoryExpandDetail }) => {
      if (!workspace) {
        throw new Error('No workspace selected');
      }
      const snapKey = contextKeyRef.current;
      const data = await expandMemory(workspace, {
        memory_ref: vars.memoryRef,
        task_conditions: buildTaskConditions(),
        detail: vars.detail,
      });
      return { snapKey, data };
    },
    onSuccess: ({ snapKey, data }) => {
      if (contextKeyRef.current !== snapKey) return;
      setExpandedDetail(data);
      setExpandError(null);
    },
    onError: (err) => {
      setExpandError(err instanceof Error ? err.message : String(err));
    },
  });

  // --- Usage Feedback (`memory_report_use`) ---
  const [usageNotice, setUsageNotice] = useState<string | null>(null);
  const reportUseMutation = useMutation({
    mutationFn: async (vars: { memoryRef: string; stage: MemoryUseStage; outcome?: string }) => {
      if (!workspace) {
        throw new Error('No workspace selected');
      }
      const snapKey = contextKeyRef.current;
      const snapSvc = service;
      const snapWs = workspace;
      const eventId = `evt-web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const taskRef = selectedRequestId || `web-${workspace}`;
      const data = await reportMemoryUse(workspace, {
        event_id: eventId,
        memory_ref: vars.memoryRef,
        task_ref: taskRef,
        stage: vars.stage,
        outcome: vars.outcome,
      });
      return { snapKey, snapSvc, snapWs, data };
    },
    onSuccess: ({ snapKey, snapSvc, snapWs, data }, vars) => {
      if (snapSvc && snapWs) {
        void queryClient.invalidateQueries({ queryKey: bhKeys.memoryStatus(snapSvc, snapWs) });
      }
      if (contextKeyRef.current !== snapKey) return;
      setUsageNotice(
        tr(
          `已向 Memory MCP 上报 ${vars.stage} 反馈（${vars.memoryRef}）。`,
          `Reported ${vars.stage} feedback to Memory MCP (${vars.memoryRef}).`,
        ) + ` [${data.server}]`,
      );
    },
    onError: (err) => {
      setUsageNotice(
        (err instanceof Error ? err.message : String(err)) || tr('使用反馈失败', 'Feedback failed'),
      );
    },
  });

  // --- Propose / Capture Candidate ---
  const [proposeKind, setProposeKind] = useState<'candidate' | 'scientific'>('candidate');
  const [candSummary, setCandSummary] = useState('');
  const [candLocator, setCandLocator] = useState('');
  const [sciMemoryId, setSciMemoryId] = useState('');
  const [sciT1Core, setSciT1Core] = useState('');
  const [sciT2Json, setSciT2Json] = useState('{"note": ""}');
  const [sciCondJson, setSciCondJson] = useState('{}');
  const [sciEvidJson, setSciEvidJson] = useState('[{"relative_path": "", "line": 1, "exact_excerpt": ""}]');
  const [proposeFeedback, setProposeFeedback] = useState<string | null>(null);
  const [proposeError, setProposeError] = useState<string | null>(null);

  const proposeMutation = useMutation({
    mutationFn: async () => {
      if (!workspace) throw new Error('No workspace selected');
      const snapKey = contextKeyRef.current;
      const snapSvc = service;
      const snapWs = workspace;
      const eventId = `evt-prop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (proposeKind === 'candidate') {
        const res = await proposeMemory(workspace, {
          kind: 'candidate',
          event_id: eventId,
          summary: candSummary.trim(),
          evidence_locator: candLocator.trim() || undefined,
        });
        return { snapKey, snapSvc, snapWs, res };
      }
      const parsedT2 = JSON.parse(sciT2Json) as Record<string, unknown>;
      const parsedCond = JSON.parse(sciCondJson) as Record<string, string>;
      const parsedEvid = JSON.parse(sciEvidJson) as Array<Record<string, unknown>>;
      const res = await proposeMemory(workspace, {
        kind: 'scientific',
        event_id: eventId,
        memory_id: sciMemoryId.trim(),
        t1_core: sciT1Core.trim(),
        t2_detail: parsedT2,
        required_conditions: parsedCond,
        evidence: parsedEvid,
      });
      return { snapKey, snapSvc, snapWs, res };
    },
    onSuccess: ({ snapKey, snapSvc, snapWs, res }) => {
      if (snapSvc && snapWs) {
        void queryClient.invalidateQueries({ queryKey: bhKeys.memoryStatus(snapSvc, snapWs) });
      }
      if (contextKeyRef.current !== snapKey) return;
      setProposeError(null);
      const status = String((res.result as Record<string, unknown>)?.status ?? 'UNREVIEWED_PENDING_IMPORT');
      setProposeFeedback(
        tr(
          `已写入待审收件箱（status=${status}，未自动入正式记忆库；正式发布需 Curator 审核流）。`,
          `Captured to pending inbox (status=${status}; Curator publish remains separate).`,
        ),
      );
      setCandSummary('');
      setCandLocator('');
    },
    onError: (err) => {
      setProposeFeedback(null);
      setProposeError(err instanceof Error ? err.message : String(err));
    },
  });

  // Reset local workbench state when workspace / scope / request changes so stale context never leaks
  useEffect(() => {
    setRecallResult(null);
    setRecallError(null);
    setExpandedDetail(null);
    setExpandError(null);
    setUsageNotice(null);
    setProposeFeedback(null);
    setProposeError(null);
    setDocScopeOverride('');
    setDocSelections({});
    setAppliedDocSelections({});
    setLastConfirmedAt(null);
  }, [workspace, selectedScopeId, selectedRequestId]);
  const memData = memoryStatusQuery.data;
  const capsData = capabilitiesQuery.data;
  const diagnose = memData?.diagnose;
  const memStatus = memData?.status;
  const triggerKeys = useMemo(() => {
    const raw = diagnose?.context_trigger_keys as unknown;
    if (Array.isArray(raw)) {
      return raw.filter((k): k is string => typeof k === "string" && k.trim().length > 0);
    }
    if (raw && typeof raw === "object") {
      return Object.keys(raw as Record<string, unknown>).filter((k) => k.trim().length > 0);
    }
    return [];
  }, [diagnose?.context_trigger_keys]);

  return (
    <div className="bg-surface-canvas flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <BioHarnessRequestHeader
        activeTab="capabilities"
        requestId={selectedRequestId}
        conversationId={linkedConversationId}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
          {/* Page Header & Sub-tab Switcher */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-text-primary flex items-center gap-2 text-base font-semibold">
                <Database className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
                <span>{tr('科研记忆、能力与项目文档中心', 'Research Memory, Capabilities & Documents')}</span>
              </h1>
              <p className="text-text-tertiary mt-0.5 text-xs">
                {tr(
                  '真实接入 bioharness-memory MCP、Core 资源目录与 Governance 文档接口；未实现能力以透明声明替代虚假操作。',
                  'Backed directly by bioharness-memory MCP, Core registry, and Governance documents without simulated controls.',
                )}
              </p>
            </div>

            <div
              className="border-border-light bg-surface-primary inline-flex flex-wrap gap-1 rounded-xl border p-1"
              role="tablist"
              aria-label={tr('能力视图切换', 'Capabilities sections')}
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'memory'}
                data-testid="bh-cap-subtab-memory"
                onClick={() => setActiveTab('memory')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === 'memory'
                    ? 'bg-surface-hover text-text-primary shadow-2xs'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                <Brain className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{tr('科研记忆', 'Research Memory')}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'capabilities'}
                data-testid="bh-cap-subtab-capabilities"
                onClick={() => setActiveTab('capabilities')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === 'capabilities'
                    ? 'bg-surface-hover text-text-primary shadow-2xs'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{tr('Skills 与能力四态', 'Skills & Capabilities')}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'documents'}
                data-testid="bh-cap-subtab-documents"
                onClick={() => setActiveTab('documents')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === 'documents'
                    ? 'bg-surface-hover text-text-primary shadow-2xs'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{tr('项目文档', 'Project Documents')}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'modules'}
                data-testid="bh-cap-subtab-modules"
                onClick={() => setActiveTab('modules')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  activeTab === 'modules'
                    ? 'bg-surface-hover text-text-primary shadow-2xs'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                <Boxes className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{tr('专业模块', 'Domain Modules')}</span>
              </button>
            </div>
          </div>

          {/* ===================== TAB 1: RESEARCH MEMORY ===================== */}
          {activeTab === 'memory' && (
            <div data-testid="bh-cap-memory-panel" className="space-y-4">
              {/* Status Card + Last Confirmed Banner */}
              <section className="border-border-light bg-surface-primary rounded-xl border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-text-primary text-sm font-semibold">
                        {tr('Memory MCP 状态', 'Memory MCP Status')}
                      </span>
                      {memoryStatusQuery.isLoading ? (
                        <Spinner className="h-3.5 w-3.5" />
                      ) : memData?.callable ? (
                        <span
                          data-testid="bh-memory-callable-badge"
                          className="inline-flex items-center gap-1 rounded bg-teal-500/15 px-2 py-0.5 text-[11px] font-medium text-teal-700 dark:text-teal-300"
                        >
                          <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                          {tr(`已连通 (${memData.server})`, `Connected (${memData.server})`)}
                        </span>
                      ) : (
                        <span
                          data-testid="bh-memory-unavailable-badge"
                          className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-200"
                        >
                          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                          {tr('未连接 / 降级', 'Unavailable / Degraded')}
                        </span>
                      )}
                      {memData?.checked_at && (
                        <span className="text-text-tertiary text-[11px]">
                          {tr('检测时间：', 'Checked: ')}
                          {formatCompactTime(memData.checked_at, zh) || memData.checked_at}
                        </span>
                      )}
                    </div>
                    {memData?.error && (
                      <div
                        data-testid="bh-memory-degraded-alert"
                        role="alert"
                        className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-900 dark:text-amber-200"
                      >
                        <p className="font-medium">
                          [{memData.error.code}] {memData.error.message}
                        </p>
                        <p className="mt-1 opacity-90">
                          {lastConfirmedAt
                            ? tr(
                                `最后成功确认时间：${formatCompactTime(lastConfirmedAt, zh) || lastConfirmedAt}（当前处于降级状态，不覆盖真实失败）`,
                                `Last confirmed working at: ${lastConfirmedAt} (currently degraded)`,
                              )
                            : tr(
                                '尚无历史成功连接记录；请检查服务端的 BIOHARNESS_WEB_MCP_SERVERS 配置。',
                                'No prior confirmed connection in this session; check BIOHARNESS_WEB_MCP_SERVERS.',
                              )}
                        </p>
                      </div>
                    )}
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="bh-memory-refresh-btn"
                    onClick={() => void memoryStatusQuery.refetch()}
                    className="gap-1.5 text-xs"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{tr('刷新状态', 'Refresh')}</span>
                  </Button>
                </div>

                {/* Telemetry & Diagnose Summary */}
                {memData?.callable && (
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <div className="border-border-light bg-surface-secondary/40 rounded-lg border p-2.5">
                      <div className="text-text-tertiary text-[11px]">{tr('有效经验条目', 'Active Memories')}</div>
                      <div className="text-text-primary mt-0.5 text-base font-semibold" data-testid="bh-memory-active-count">
                        {memStatus?.active_memory_count ?? diagnose?.active_count ?? 0}
                      </div>
                    </div>
                    <div className="border-border-light bg-surface-secondary/40 rounded-lg border p-2.5">
                      <div className="text-text-tertiary text-[11px]">{tr('T1 主题簇', 'T1 Themes')}</div>
                      <div className="text-text-primary mt-0.5 text-base font-semibold">
                        {memStatus?.theme_count ?? diagnose?.theme_count ?? 0}
                        {typeof diagnose?.stale_theme_count === 'number' && diagnose.stale_theme_count > 0 && (
                          <span className="ml-1 text-[11px] font-normal text-amber-600 dark:text-amber-300">
                            ({diagnose.stale_theme_count} {tr('陈旧', 'stale')})
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="border-border-light bg-surface-secondary/40 rounded-lg border p-2.5">
                      <div className="text-text-tertiary text-[11px]">{tr('待审提案数', 'Pending Inbox')}</div>
                      <div className="text-text-primary mt-0.5 text-base font-semibold" data-testid="bh-memory-pending-count">
                        {diagnose?.pending_candidates?.count ?? memStatus?.pending_candidate_count ?? 0}
                      </div>
                    </div>
                    <div className="border-border-light bg-surface-secondary/40 rounded-lg border p-2.5">
                      <div className="text-text-tertiary text-[11px]">{tr('已反馈消费', 'Reported Consumed')}</div>
                      <div className="text-text-primary mt-0.5 text-base font-semibold" data-testid="bh-memory-consumed-count">
                        {diagnose?.use_feedback?.consumed ?? 0}
                        <span className="text-text-tertiary ml-1 text-[11px] font-normal">
                          / {diagnose?.use_feedback?.events ?? 0} {tr('事件', 'events')}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Honest Capability & Curator Gap Disclosure */}
                <div className="border-border-light bg-surface-secondary/30 mt-3 space-y-1.5 rounded-lg border p-3 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-text-secondary font-medium">
                      {tr('检索深度与信息层级边界：', 'Recall Depth & Tier Separation:')}
                    </span>
                    <span className="rounded bg-teal-500/15 px-1.5 py-0.5 text-[11px] text-teal-700 dark:text-teal-300">
                      FAST ✓
                    </span>
                    <span className="rounded bg-teal-500/15 px-1.5 py-0.5 text-[11px] text-teal-700 dark:text-teal-300">
                      STANDARD ✓
                    </span>
                    <span
                      data-testid="bh-memory-deep-gap-badge"
                      className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-800 dark:text-amber-200"
                    >
                      DEEP ✕ ({tr('未公开 · RECALL_MODE_NOT_IMPLEMENTED', 'Unexposed')})
                    </span>
                  </div>
                  <p className="text-text-tertiary">
                    {memData?.capabilities?.deep_unavailable_reason ??
                      tr(
                        'bioharness-module-memory 当前仅公开 FAST 与 STANDARD 检索深度；DEEP 尚未实现。T1/T2/T3 为信息展示层级，与检索深度相互独立。',
                        'FAST and STANDARD recall modes are exposed; DEEP throws RECALL_MODE_NOT_IMPLEMENTED. T1/T2/T3 detail tiers are orthogonal.',
                      )}
                  </p>
                  {memData?.capabilities && !memData.capabilities.curator_interactive_publish && (
                    <div
                      data-testid="bh-memory-curator-gap-note"
                      className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-[11px] text-amber-900 dark:text-amber-200"
                    >
                      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span>{memData.capabilities.curator_gap_note}</span>
                    </div>
                  )}
                </div>
              </section>

              {/* Recall & T1/T2/T3 Expansion */}
              <section className="border-border-light bg-surface-primary space-y-3 rounded-xl border p-4">
                <h2 className="text-text-primary flex items-center gap-1.5 text-sm font-semibold">
                  <Search className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
                  <span>{tr('任务条件记忆检索（T1/T2/T3 逐层展开）', 'Task-Conditioned Memory Recall')}</span>
                </h2>

                <form
                  data-testid="bh-memory-recall-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!recallQuery.trim() || recallMode === 'DEEP') return;
                    recallMutation.mutate();
                  }}
                  className="space-y-3"
                >
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      data-testid="bh-memory-query-input"
                      value={recallQuery}
                      onChange={(e) => setRecallQuery(e.target.value)}
                      placeholder={tr('输入科研检索问题或方法关键词…', 'Query scientific memory by topic or method…')}
                      className="flex-1 text-xs"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      data-testid="bh-memory-recall-submit"
                      disabled={!recallQuery.trim() || recallMutation.isLoading || recallMode === 'DEEP'}
                      className="gap-1.5 text-xs"
                    >
                      {recallMutation.isLoading ? <Spinner className="h-3.5 w-3.5" /> : <Search className="h-3.5 w-3.5" />}
                      <span>{tr('检索记忆', 'Recall')}</span>
                    </Button>
                  </div>

                  {/* Recall Mode (Depth) + Task Conditions */}
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="space-y-1">
                      <span className="text-text-tertiary block text-[11px] font-medium">
                        {tr('检索深度 (Mode)', 'Retrieval Depth')}
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {(['FAST', 'STANDARD'] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            data-testid={`bh-memory-mode-${m.toLowerCase()}`}
                            onClick={() => setRecallMode(m)}
                            className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                              recallMode === m
                                ? 'border-teal-600 bg-teal-600/15 text-teal-800 dark:border-teal-400 dark:text-teal-200'
                                : 'border-border-medium text-text-secondary hover:bg-surface-hover'
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                        <button
                          type="button"
                          disabled
                          aria-disabled="true"
                          data-testid="bh-memory-mode-deep"
                          title={
                            memData?.capabilities?.deep_unavailable_reason ??
                            'RECALL_MODE_NOT_IMPLEMENTED'
                          }
                          className="border-border-light text-text-tertiary cursor-not-allowed rounded-md border border-dashed px-2 py-1 text-[11px] opacity-65"
                        >
                          DEEP ({tr('未公开', 'N/A')})
                        </button>
                      </div>
                    </div>

                    <label className="space-y-1 text-[11px]">
                      <span className="text-text-tertiary block font-medium">
                        {tr('任务条件 Key（可选）', 'Task condition key (optional)')}
                      </span>
                      <Input
                        data-testid="bh-memory-cond-key"
                        value={extraCondKey}
                        onChange={(e) => setExtraCondKey(e.target.value)}
                        placeholder={tr('例如 domain / method / organism', 'e.g. domain / method')}
                        className="h-8 text-xs"
                      />
                    </label>
                    <label className="space-y-1 text-[11px]">
                      <span className="text-text-tertiary block font-medium">
                        {tr('条件 Value', 'Condition value')}
                      </span>
                      <div className="flex gap-1">
                        <Input
                          data-testid="bh-memory-cond-val"
                          value={extraCondVal}
                          onChange={(e) => setExtraCondVal(e.target.value)}
                          placeholder={tr('输入对应条件值…', 'Enter value…')}
                          className="h-8 flex-1 text-xs"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          data-testid="bh-memory-add-cond-btn"
                          disabled={!extraCondKey.trim() || !extraCondVal.trim()}
                          onClick={() => {
                            const k = extraCondKey.trim();
                            const v = extraCondVal.trim();
                            if (!k || !v) return;
                            setTaskConditions((prev) => [...prev.filter((c) => c.key !== k), { key: k, value: v }]);
                            setExtraCondKey('');
                            setExtraCondVal('');
                          }}
                          className="h-8 shrink-0 px-2 text-[11px]"
                        >
                          {tr('添加', 'Add')}
                        </Button>
                      </div>
                    </label>
                    <label className="space-y-1 text-[11px]">
                      <span className="text-text-tertiary block font-medium">Limit</span>
                      <Input
                        type="number"
                        min={1}
                        max={20}
                        value={recallLimit}
                        onChange={(e) => setRecallLimit(Math.max(1, Math.min(20, Number(e.target.value) || 6)))}
                        className="h-8 text-xs"
                      />
                    </label>
                  </div>
                  {(triggerKeys.length > 0 || taskConditions.length > 0) && (
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      {taskConditions.map((c) => (
                        <span
                          key={c.key}
                          data-testid={`bh-memory-cond-chip-${c.key}`}
                          className="inline-flex items-center gap-1 rounded-md bg-teal-500/15 px-2 py-0.5 font-mono text-teal-800 dark:text-teal-200"
                        >
                          {c.key}={c.value}
                          <button
                            type="button"
                            onClick={() => setTaskConditions((prev) => prev.filter((x) => x.key !== c.key))}
                            className="hover:text-text-primary ml-0.5"
                            aria-label={`Remove ${c.key}`}
                          >
                            ×
                          </button>
                        </span>
                      ))}
                      {triggerKeys.map((triggerKey) => (
                        <button
                          key={triggerKey}
                          type="button"
                          data-testid={`bh-memory-trigger-key-${triggerKey}`}
                          onClick={() => setExtraCondKey(triggerKey)}
                          className="border-border-light bg-surface-secondary/50 text-text-secondary hover:bg-surface-hover rounded border px-1.5 py-0.5 font-mono text-[10px]"
                          title={tr('来自当前 Memory 库的触发条件键，点击填入 Key', 'Observed trigger key in this Memory store')}
                        >
                          +{triggerKey}
                        </button>
                      ))}
                    </div>
                  )}
                </form>

                {recallError && (
                  <div role="alert" className="text-text-destructive text-xs">
                    {recallError}
                  </div>
                )}

                {recallResult && (
                  <div data-testid="bh-memory-recall-results" className="border-border-light space-y-3 border-t pt-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-text-secondary font-medium">
                          {tr('后端引擎：', 'Backend: ')}
                          <code className="bg-surface-hover rounded px-1 py-0.5">{recallResult.result.backend ?? 'FTS5'}</code>
                        </span>
                        {recallResult.result.scientific_validation && (
                          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-800 dark:text-amber-200">
                            {tr('科学验证状态：', 'Scientific Validation: ')}
                            {recallResult.result.scientific_validation}
                          </span>
                        )}
                      </div>
                      <span className="text-text-tertiary text-[11px]">
                        {tr('结果仅作参考背景，不替代实验验证', 'Recall is advisory context only')}
                      </span>
                    </div>

                    {/* Themes (T1) */}
                    {(recallResult.result.themes ?? []).length > 0 && (
                      <div className="space-y-1.5">
                        <h3 className="text-text-secondary text-xs font-semibold">
                          {tr('关联 T1 主题', 'Matched T1 Themes')}
                        </h3>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {(recallResult.result.themes ?? []).map((t) => (
                            <div
                              key={t.t1_ref}
                              data-testid={`bh-memory-theme-${t.t1_ref}`}
                              className="border-border-light bg-surface-secondary/30 flex items-start justify-between gap-2 rounded-lg border p-2.5 text-xs"
                            >
                              <div className="min-w-0">
                                <div className="text-text-primary flex items-center gap-1.5 font-medium">
                                  <span className="truncate">{t.title}</span>
                                  {t.stale && (
                                    <span className="rounded bg-amber-500/15 px-1 text-[10px] text-amber-700 dark:text-amber-300">
                                      {tr('待更新', 'Stale')}
                                    </span>
                                  )}
                                </div>
                                <p className="text-text-tertiary mt-0.5 line-clamp-2 text-[11px]">{t.scope}</p>
                                <div className="text-text-tertiary mt-1 font-mono text-[10px]">
                                  {t.t1_ref} · {t.member_count} {tr('成员', 'members')}
                                </div>
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                data-testid={`bh-memory-expand-t1-${t.t1_ref}`}
                                onClick={() => expandMutation.mutate({ memoryRef: t.t1_ref, detail: 'T1' })}
                                className="h-7 shrink-0 px-2 text-[11px]"
                              >
                                {tr('展开 T1', 'T1')}
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Candidates (T2 / T3 + Use feedback) */}
                    {(recallResult.result.candidates ?? []).length === 0 ? (
                      <p className="text-text-tertiary text-xs">
                        {tr('未匹配到适用候选经验，请调整查询词或放宽任务条件。', 'No matching memory candidates.')}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        <h3 className="text-text-secondary text-xs font-semibold">
                          {tr('匹配经验候选', 'Matched Candidates')} ({recallResult.result.candidates?.length})
                        </h3>
                        {(recallResult.result.candidates ?? []).map((cand) => (
                          <div
                            key={cand.memory_ref}
                            data-testid={`bh-memory-cand-${cand.memory_ref}`}
                            className="border-border-light bg-surface-secondary/20 space-y-2 rounded-lg border p-3 text-xs"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <code className="text-text-primary font-mono font-semibold">{cand.memory_ref}</code>
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                    cand.applicability === 'APPLICABLE'
                                      ? 'bg-teal-500/15 text-teal-700 dark:text-teal-300'
                                      : cand.applicability === 'NEEDS_REVIEW'
                                        ? 'bg-amber-500/15 text-amber-800 dark:text-amber-200'
                                        : 'bg-surface-hover text-text-tertiary'
                                  }`}
                                >
                                  {cand.applicability}
                                </span>
                                {cand.verification_status && (
                                  <span className="bg-surface-hover text-text-secondary rounded px-1.5 py-0.5 text-[10px]">
                                    {cand.verification_status}
                                  </span>
                                )}
                                {cand.source_status && (
                                  <span className="bg-surface-hover text-text-tertiary rounded px-1.5 py-0.5 text-[10px]">
                                    src: {cand.source_status}
                                  </span>
                                )}
                              </div>

                              <div className="flex flex-wrap items-center gap-1">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  data-testid={`bh-memory-expand-t2-${cand.memory_ref}`}
                                  onClick={() => expandMutation.mutate({ memoryRef: cand.memory_ref, detail: 'T2' })}
                                  className="h-7 px-2 text-[11px]"
                                >
                                  {tr('展开 T2', 'Expand T2')}
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  data-testid={`bh-memory-expand-t3-${cand.memory_ref}`}
                                  onClick={() => expandMutation.mutate({ memoryRef: cand.memory_ref, detail: 'T3' })}
                                  className="h-7 px-2 text-[11px]"
                                >
                                  {tr('核验 T3 来源', 'T3 Sources')}
                                </Button>
                              </div>
                            </div>

                            {cand.missing_conditions && cand.missing_conditions.length > 0 && (
                              <div className="text-[11px] text-amber-700 dark:text-amber-300">
                                {tr('待确认条件：', 'Missing conditions: ')}
                                {cand.missing_conditions.join(', ')}
                              </div>
                            )}

                            {/* Explicit Use Feedback (`memory_report_use`) */}
                            <div className="border-border-light flex flex-wrap items-center gap-1.5 border-t pt-2">
                              <span className="text-text-tertiary text-[11px]">
                                {tr('显式使用反馈：', 'Report use:')}
                              </span>
                              {(['selected', 'consumed', 'outcome_reported'] as const).map((stage) => (
                                <button
                                  key={stage}
                                  type="button"
                                  data-testid={`bh-memory-use-${stage}-${cand.memory_ref}`}
                                  disabled={reportUseMutation.isLoading}
                                  onClick={() =>
                                    reportUseMutation.mutate({
                                      memoryRef: cand.memory_ref,
                                      stage,
                                      outcome: stage === 'outcome_reported' ? 'succeeded' : undefined,
                                    })
                                  }
                                  className="border-border-medium hover:bg-surface-hover text-text-secondary rounded border px-2 py-0.5 text-[11px] transition-colors"
                                >
                                  {stage === 'selected'
                                    ? tr('已选定 (selected)', 'selected')
                                    : stage === 'consumed'
                                      ? tr('已采纳执行 (consumed)', 'consumed')
                                      : tr('上报结果 (outcome)', 'outcome_reported')}
                                </button>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {usageNotice && (
                      <div
                        data-testid="bh-memory-usage-notice"
                        className="rounded-lg border border-teal-500/30 bg-teal-500/10 p-2 text-xs text-teal-800 dark:text-teal-200"
                      >
                        {usageNotice}
                      </div>
                    )}

                    {expandError && (
                      <div role="alert" className="text-text-destructive text-xs">
                        {expandError}
                      </div>
                    )}

                    {/* Expanded T1 / T2 / T3 Panel */}
                    {expandedDetail && (
                      <div
                        data-testid="bh-memory-expanded-panel"
                        className="border-border-medium bg-surface-secondary/40 space-y-2.5 rounded-xl border p-3 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-text-primary font-semibold">
                            {tr(`层级展开结果 · ${expandedDetail.detail}`, `Expanded Detail · ${expandedDetail.detail}`)}
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            data-testid="bh-memory-stage-btn"
                            onClick={() =>
                              stageTextInConversation({
                                conversationId: linkedConversationId,
                                requestId: selectedRequestId,
                                snippet: `[Memory ${expandedDetail.detail}] ${JSON.stringify(expandedDetail.result, null, 2)}`,
                              })
                            }
                            className="h-7 gap-1 px-2 text-[11px]"
                          >
                            <Send className="h-3 w-3" aria-hidden="true" />
                            <span>{tr('引用到对话草稿', 'Stage into draft')}</span>
                          </Button>
                        </div>

                        {expandedDetail.detail === 'T1' && (
                          <div className="space-y-1.5">
                            <div className="font-medium">{expandedDetail.result.title}</div>
                            <p className="text-text-secondary">{expandedDetail.result.summary}</p>
                            {(expandedDetail.result.members ?? []).map((m) => (
                              <div
                                key={m.memory_ref}
                                className="border-border-light bg-surface-primary rounded border p-2"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <code className="font-mono text-[11px]">{m.memory_ref}</code>
                                  <div className="flex gap-1">
                                    <button
                                      type="button"
                                      onClick={() => expandMutation.mutate({ memoryRef: m.memory_ref, detail: 'T2' })}
                                      className="text-teal-700 hover:underline dark:text-teal-300"
                                    >
                                      T2
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => expandMutation.mutate({ memoryRef: m.memory_ref, detail: 'T3' })}
                                      className="text-teal-700 hover:underline dark:text-teal-300"
                                    >
                                      T3
                                    </button>
                                  </div>
                                </div>
                                {m.gist && <p className="text-text-secondary mt-1">{m.gist}</p>}
                              </div>
                            ))}
                          </div>
                        )}

                        {expandedDetail.detail === 'T2' && (
                          <pre className="border-border-light bg-surface-primary max-h-64 overflow-auto rounded-lg border p-2.5 font-mono text-[11px] leading-relaxed">
                            {JSON.stringify(expandedDetail.result.content ?? expandedDetail.result, null, 2)}
                          </pre>
                        )}

                        {expandedDetail.detail === 'T3' && (
                          <div className="space-y-2">
                            {(expandedDetail.result.sources ?? []).map((src) => (
                              <div
                                key={src.source_ref}
                                className="border-border-light bg-surface-primary space-y-1 rounded-lg border p-2.5"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-1 font-mono text-[11px]">
                                  <span>
                                    {src.relative_path}#L{src.line}
                                  </span>
                                  <span className="text-text-tertiary">{src.source_ref}</span>
                                </div>
                                <div className="text-text-tertiary font-mono text-[10px] break-all">
                                  rev={src.source_revision} · line_sha={src.record_sha256}
                                </div>
                                {src.text ? (
                                  <pre className="bg-surface-secondary/40 rounded p-2 font-mono text-[11px] whitespace-pre-wrap">
                                    {src.text}
                                  </pre>
                                ) : (
                                  <p className="text-text-tertiary italic text-[11px]">
                                    {tr(
                                      '已通过 SHA-256 校验。bioharness-memory MCP 按 allow_text=False 脱敏边界仅回传行定位与校验摘要，不通过检索接口外泄原文。',
                                      'SHA-256 verified. Memory MCP uses allow_text=False on expand(T3) and returns line anchor + digest without raw text.',
                                    )}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* Propose / Capture Candidate */}
              <section
                data-testid="bh-memory-propose-panel"
                className="border-border-light bg-surface-primary space-y-3 rounded-xl border p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-text-primary flex items-center gap-1.5 text-sm font-semibold">
                    <Sparkles className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
                    <span>{tr('记录记忆候选（写入 UNREVIEWED_PENDING_IMPORT）', 'Capture / Propose Memory Candidate')}</span>
                  </h2>
                  <div className="inline-flex gap-1 text-xs">
                    <button
                      type="button"
                      onClick={() => setProposeKind('candidate')}
                      className={`rounded-md px-2 py-1 ${
                        proposeKind === 'candidate'
                          ? 'bg-surface-hover text-text-primary font-medium'
                          : 'text-text-secondary hover:bg-surface-hover/50'
                      }`}
                    >
                      {tr('快速笔记候选', 'Candidate Note')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setProposeKind('scientific')}
                      className={`rounded-md px-2 py-1 ${
                        proposeKind === 'scientific'
                          ? 'bg-surface-hover text-text-primary font-medium'
                          : 'text-text-secondary hover:bg-surface-hover/50'
                      }`}
                    >
                      {tr('结构化 T1/T2 科学提案', 'Structured T1/T2 Proposal')}
                    </button>
                  </div>
                </div>

                {proposeKind === 'candidate' ? (
                  <div className="space-y-2">
                    <textarea
                      data-testid="bh-memory-candidate-summary"
                      rows={2}
                      value={candSummary}
                      onChange={(e) => setCandSummary(e.target.value)}
                      placeholder={tr('描述在真实科研中观察到的注意事项或经验摘要…', 'Summarize an observed methodological finding or caveat…')}
                      className="border-border-medium bg-surface-primary text-text-primary w-full rounded-lg border px-3 py-2 text-xs"
                    />
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <Input
                        data-testid="bh-memory-candidate-locator"
                        value={candLocator}
                        onChange={(e) => setCandLocator(e.target.value)}
                        placeholder={tr('证据位置锚点（可选，如 notes.md#L12）', 'Optional evidence locator (e.g. notes.md#L12)')}
                        className="flex-1 text-xs"
                      />
                      <Button
                        type="button"
                        size="sm"
                        data-testid="bh-memory-propose-submit"
                        disabled={!candSummary.trim() || proposeMutation.isLoading}
                        onClick={() => proposeMutation.mutate()}
                        className="text-xs"
                      >
                        {proposeMutation.isLoading ? <Spinner className="mr-1 h-3.5 w-3.5" /> : null}
                        {tr('提交待审候选', 'Submit Pending Candidate')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 text-xs">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <Input
                        value={sciMemoryId}
                        onChange={(e) => setSciMemoryId(e.target.value)}
                        placeholder="memory_id (e.g. mem:ppgr-gc-check)"
                        className="text-xs"
                      />
                      <Input
                        value={sciT1Core}
                        onChange={(e) => setSciT1Core(e.target.value)}
                        placeholder={tr('T1 核心摘要', 'T1 core summary')}
                        className="text-xs"
                      />
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <label className="space-y-1">
                        <span className="text-text-tertiary block text-[11px]">t2_detail (JSON)</span>
                        <textarea
                          rows={3}
                          value={sciT2Json}
                          onChange={(e) => setSciT2Json(e.target.value)}
                          className="border-border-medium bg-surface-primary text-text-primary w-full rounded-lg border p-2 font-mono text-[11px]"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-text-tertiary block text-[11px]">required_conditions (JSON)</span>
                        <textarea
                          rows={3}
                          value={sciCondJson}
                          onChange={(e) => setSciCondJson(e.target.value)}
                          className="border-border-medium bg-surface-primary text-text-primary w-full rounded-lg border p-2 font-mono text-[11px]"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="text-text-tertiary block text-[11px]">evidence[] (JSON)</span>
                        <textarea
                          rows={3}
                          value={sciEvidJson}
                          onChange={(e) => setSciEvidJson(e.target.value)}
                          className="border-border-medium bg-surface-primary text-text-primary w-full rounded-lg border p-2 font-mono text-[11px]"
                        />
                      </label>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      disabled={!sciMemoryId.trim() || !sciT1Core.trim() || proposeMutation.isLoading}
                      onClick={() => proposeMutation.mutate()}
                      className="text-xs"
                    >
                      {tr('提交科学提案（UNREVIEWED）', 'Submit Unreviewed Scientific Proposal')}
                    </Button>
                  </div>
                )}

                {proposeFeedback && (
                  <div
                    data-testid="bh-memory-propose-feedback"
                    className="rounded-lg border border-teal-500/30 bg-teal-500/10 p-2 text-xs text-teal-800 dark:text-teal-200"
                  >
                    {proposeFeedback}
                  </div>
                )}
                {proposeError && (
                  <div role="alert" className="text-text-destructive text-xs">
                    {proposeError}
                  </div>
                )}
              </section>
            </div>
          )}

          {/* ===================== TAB 2: SKILLS & CAPABILITIES ===================== */}
          {activeTab === 'capabilities' && (
            <div data-testid="bh-cap-skills-panel" className="space-y-4">
              {capabilitiesQuery.isLoading ? (
                <div className="flex items-center gap-2 py-8 text-xs">
                  <Spinner className="h-4 w-4" />
                  <span>{tr('正在盘点 Skills、Core 资源与 MCP 服务…', 'Inspecting skills, resources & MCP servers…')}</span>
                </div>
              ) : capabilitiesQuery.isError ? (
                <div role="alert" className="text-text-destructive text-xs">
                  {(capabilitiesQuery.error as Error)?.message || tr('能力读取失败', 'Capabilities load failed')}
                </div>
              ) : capsData ? (
                <>
                  {/* Doctor & Four-State Legend */}
                  <section className="border-border-light bg-surface-primary space-y-2.5 rounded-xl border p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-text-primary text-sm font-semibold">
                          {tr('能力四态矩阵与 Core Doctor 校验', 'Four-State Capability Matrix & Core Doctor')}
                        </span>
                        <span
                          className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                            capsData.core_state_present
                              ? 'bg-teal-500/15 text-teal-700 dark:text-teal-300'
                              : 'bg-surface-hover text-text-tertiary'
                          }`}
                        >
                          {capsData.core_state_present
                            ? tr('.bioharness 状态目录存在', '.bioharness present')
                            : tr('未初始化 .bioharness', 'No .bioharness state yet')}
                        </span>
                        {capsData.doctor?.status && (
                          <span className="bg-surface-hover text-text-secondary rounded px-2 py-0.5 text-[11px]">
                            doctor: {capsData.doctor.status}
                          </span>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-testid="bh-cap-probe-btn"
                        onClick={() => {
                          setProbeMcp(true);
                          void capabilitiesQuery.refetch();
                        }}
                        className="gap-1.5 text-xs"
                      >
                        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>{tr('探测 MCP 与刷新四态', 'Probe MCP & Refresh')}</span>
                      </Button>
                    </div>
                    <p className="text-text-tertiary text-xs">
                      {tr(
                        '每项能力严格区分四态：已声明（配置/规范中有记载）· 已安装（本地二进制/SKILL.md 真实存在）· 可调用（实际探活成功）· 实际已调用（Web 运行账本中有调用记录）。',
                        'Four distinct states: Declared · Installed · Callable (probed) · Actually Used (observed in Web ledger).',
                      )}
                    </p>
                  </section>

                  {/* Workspace SKILL.md */}
                  <section className="border-border-light bg-surface-primary space-y-2 rounded-xl border p-4">
                    <h2 className="text-text-primary flex items-center gap-1.5 text-sm font-semibold">
                      <FileCode2 className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
                      <span>
                        {tr('工作区 SKILL.md 技能', 'Workspace SKILL.md Skills')} ({capsData.skills.length})
                      </span>
                    </h2>
                    {capsData.skills.length === 0 ? (
                      <p className="text-text-tertiary text-xs">
                        {tr('当前工作区 .claude/skills 或 skills/ 下未发现 SKILL.md。', 'No SKILL.md found in .claude/skills or skills/.')}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {capsData.skills.map((sk) => (
                          <div
                            key={sk.id}
                            data-testid={`bh-cap-skill-${sk.id}`}
                            className="border-border-light bg-surface-secondary/20 flex flex-wrap items-start justify-between gap-2 rounded-lg border p-2.5 text-xs"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="text-text-primary font-medium">
                                {sk.name} <span className="text-text-tertiary font-mono text-[11px]">({sk.id})</span>
                              </div>
                              <p className="text-text-secondary mt-0.5">{sk.description}</p>
                              <div className="text-text-tertiary mt-0.5 font-mono text-[10px]">{sk.source}</div>
                            </div>
                            <FourStateBadges
                              declared={sk.declared}
                              installed={sk.installed}
                              callable={sk.callable}
                              callableNullLabel={zh ? '按需读取 (文档)' : 'Advisory doc'}
                              actuallyUsed={sk.actually_used}
                              useCount={sk.use_count}
                              zh={zh}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* Core Resources */}
                  <section className="border-border-light bg-surface-primary space-y-2 rounded-xl border p-4">
                    <h2 className="text-text-primary flex items-center gap-1.5 text-sm font-semibold">
                      <Layers className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
                      <span>
                        {tr('Core 声明资源 ([[resources]])', 'Core Declared Resources')} ({capsData.resources.length})
                      </span>
                    </h2>
                    {capsData.resources.length === 0 ? (
                      <p className="text-text-tertiary text-xs">
                        {tr('未发现 Core 配置的资源条目录。', 'No declared Core resources found.')}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {capsData.resources.map((res) => (
                          <div
                            key={res.id}
                            data-testid={`bh-cap-resource-${res.id}`}
                            className="border-border-light bg-surface-secondary/20 flex flex-wrap items-start justify-between gap-2 rounded-lg border p-2.5 text-xs"
                          >
                            <div>
                              <div className="text-text-primary font-medium">
                                {res.title || res.id}{' '}
                                {res.kind && <span className="text-text-tertiary text-[11px]">[{res.kind}]</span>}
                              </div>
                              {res.how_to_use && <p className="text-text-secondary mt-0.5">{res.how_to_use}</p>}
                            </div>
                            <FourStateBadges
                              declared={res.declared}
                              installed={res.installed}
                              callable={res.callable}
                              actuallyUsed={res.actually_used}
                              useCount={res.use_count}
                              zh={zh}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* MCP Servers + CLI Modules + R4 Compute Disclosure */}
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                    <section className="border-border-light bg-surface-primary space-y-2 rounded-xl border p-4">
                      <h2 className="text-text-primary flex items-center gap-1.5 text-sm font-semibold">
                        <Cpu className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
                        <span>{tr('已配置 MCP 服务', 'Configured MCP Servers')} ({capsData.mcp_servers.length})</span>
                      </h2>
                      {capsData.mcp_servers.length === 0 ? (
                        <p className="text-text-tertiary text-xs">
                          {tr('当前环境变量未配置 BIOHARNESS_WEB_MCP_SERVERS。', 'No MCP servers configured.')}
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {capsData.mcp_servers.map((srv) => (
                            <div
                              key={srv.server}
                              className="border-border-light bg-surface-secondary/20 space-y-1.5 rounded-lg border p-2.5 text-xs"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-1">
                                <span className="font-mono font-semibold">{srv.server}</span>
                                <FourStateBadges
                                  declared={srv.declared}
                                  installed={srv.installed}
                                  callable={srv.callable}
                                  actuallyUsed={Boolean(srv.actually_used)}
                                  useCount={srv.use_count}
                                  zh={zh}
                                />
                              </div>
                              <div className="text-text-tertiary text-[11px]">
                                cmd: <code>{srv.command}</code> · {srv.tools.length} {tr('个工具', 'tools')}
                              </div>
                              {srv.error && (
                                <p className="text-text-destructive text-[11px]">
                                  {srv.error.code}: {srv.error.message}
                                </p>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </section>

                    <section className="border-border-light bg-surface-primary space-y-2 rounded-xl border p-4">
                      <h2 className="text-text-primary text-sm font-semibold">
                        {tr('本地 BioHarness CLI 模块', 'Local CLI Modules')}
                      </h2>
                      <div className="space-y-2">
                        {capsData.cli_modules.map((mod) => (
                          <div
                            key={mod.id}
                            className="border-border-light bg-surface-secondary/20 flex flex-wrap items-start justify-between gap-2 rounded-lg border p-2.5 text-xs"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="font-mono font-medium">{mod.command}</div>
                              <p className="text-text-tertiary text-[11px]">{mod.description}</p>
                            </div>
                            <FourStateBadges
                              declared={mod.declared}
                              installed={mod.installed}
                              callable={mod.callable}
                              actuallyUsed={mod.actually_used}
                              useCount={mod.use_count}
                              zh={zh}
                            />
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>

                  {/* Compute R4 Boundary Disclosure */}
                  <section
                    data-testid="bh-cap-compute-disclosure"
                    className="border-border-light bg-surface-secondary/30 rounded-xl border p-3.5 text-xs"
                  >
                    <div className="text-text-primary font-semibold">
                      {tr('Compute 远端算力与长作业状态', 'Remote Compute & Long-Job Scope')} ·{' '}
                      <span className="font-mono text-[11px]">{capsData.compute.phase}</span>
                    </div>
                    <p className="text-text-secondary mt-1">{capsData.compute.note}</p>
                  </section>
                </>
              ) : null}
            </div>
          )}

          {/* ===================== TAB 3: GOVERNANCE PROJECT DOCUMENTS ===================== */}
          {activeTab === 'documents' && (
            <div data-testid="bh-cap-docs-panel" className="space-y-4">
              <section className="border-border-light bg-surface-primary space-y-3 rounded-xl border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-text-primary flex items-center gap-1.5 text-sm font-semibold">
                      <FileText className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
                      <span>{tr('Governance 受控项目文档阅读器', 'Governance Project Documents')}</span>
                    </h2>
                    <p className="text-text-tertiary text-xs">
                      {tr(
                        '通过 bioharness-governance context 严格按角色加载 contract / guide / status / findings_index。',
                        'Loads contract, guide, status, and findings_index safely via bioharness-governance context.',
                      )}
                    </p>
                  </div>

                  <Button
                    type="button"
                    size="sm"
                    data-testid="bh-doc-load-btn"
                    onClick={() => {
                      setAppliedDocSelections({ ...docSelections });
                      void capabilitiesQuery.refetch();
                    }}
                    className="gap-1.5 text-xs"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{tr('加载选定文档', 'Load Documents')}</span>
                  </Button>
                </div>

                {/* Scope & Role Mapping Selectors */}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-5">
                  <label className="space-y-1 text-[11px]">
                    <span className="text-text-tertiary block font-medium">{tr('项目 Scope', 'Scope ID')}</span>
                    <select
                      data-testid="bh-doc-scope-select"
                      value={effectiveDocScopeId ?? ''}
                      onChange={(e) => setDocScopeOverride(e.target.value)}
                      className="border-border-medium bg-surface-primary text-text-primary w-full rounded-lg border px-2 py-1.5 text-xs"
                    >
                      {projectScopes.length === 0 && <option value="">{tr('（无 Scope）', '(none)')}</option>}
                      {projectScopes.map((p) => (
                        <option key={p.scope_id} value={p.scope_id}>
                          {p.scope_id}
                        </option>
                      ))}
                    </select>
                  </label>

                  {(['contract', 'guide', 'status', 'findings_index'] as const).map((role) => {
                    const currentVal = docSelections[role] ?? capsData?.documents?.selected?.[role] ?? '';
                    return (
                      <label key={role} className="space-y-1 text-[11px]">
                        <span className="text-text-tertiary block font-medium uppercase">{role}</span>
                        <select
                          data-testid={`bh-doc-role-${role}`}
                          value={currentVal}
                          onChange={(e) =>
                            setDocSelections((prev) => ({
                              ...prev,
                              [role]: e.target.value || undefined,
                            }))
                          }
                          className="border-border-medium bg-surface-primary text-text-primary w-full rounded-lg border px-2 py-1.5 text-xs"
                        >
                          <option value="">{tr('（自动/不加载）', '(auto / none)')}</option>
                          {(capsData?.documents?.candidates ?? []).map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                </div>

                {capsData?.documents?.error && (
                  <div role="alert" className="text-text-destructive text-xs">
                    {capsData.documents.error}
                  </div>
                )}
              </section>

              {capabilitiesQuery.isLoading ? (
                <div className="flex items-center gap-2 py-4 text-xs">
                  <Spinner className="h-4 w-4" />
                  <span>{tr('正在通过 Governance 读取项目文档…', 'Reading Governance documents…')}</span>
                </div>
              ) : (
                <div className="space-y-3">
                  {Object.entries(capsData?.documents?.loaded ?? {}).length === 0 ? (
                    <div className="border-border-light bg-surface-primary text-text-tertiary rounded-xl border p-6 text-center text-xs">
                      {effectiveDocScopeId
                        ? tr(
                            '当前工作区下未匹配到可展示的 Markdown/Text 项目文档，或在上方下拉框中选择文件后点击加载。',
                            'No loaded documents yet for this scope. Pick candidate files above and load.',
                          )
                        : tr('当前工作区尚无 Governance 项目 Scope。', 'No Governance scope found in workspace.')}
                    </div>
                  ) : (
                    Object.entries(capsData?.documents?.loaded ?? {}).map(([role, doc]) => {
                      const docName =
                        doc.path ||
                        (typeof doc.source === 'string' && doc.source ? doc.source : undefined) ||
                        capsData?.documents?.selected?.[role] ||
                        role;
                      return (
                      <section
                        key={role}
                        data-testid={`bh-doc-card-${role}`}
                        className="border-border-light bg-surface-primary space-y-2 rounded-xl border p-4 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="bg-surface-hover text-text-primary rounded px-2 py-0.5 font-mono text-[11px] font-semibold uppercase">
                              {role}
                            </span>
                            <span className="font-mono font-medium">{docName}</span>
                            {doc.sha256 && (
                              <span className="text-text-tertiary font-mono text-[10px]">
                                sha256:{String(doc.sha256).slice(0, 12)}…
                              </span>
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            data-testid={`bh-doc-stage-${role}`}
                            onClick={() =>
                              stageTextInConversation({
                                conversationId: linkedConversationId,
                                requestId: selectedRequestId,
                                snippet: `[Governance Doc ${role}: ${docName}]\n${doc.preview ?? ''}`,
                              })
                            }
                            className="h-7 gap-1 px-2 text-[11px]"
                          >
                            <Send className="h-3 w-3" aria-hidden="true" />
                            <span>{tr('引用到对话草稿', 'Stage into draft')}</span>
                          </Button>
                        </div>
                        <pre className="border-border-light bg-surface-secondary/30 max-h-72 overflow-auto rounded-lg border p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                          {doc.preview || tr('（空文档或仅返回元信息）', '(Empty preview)')}
                        </pre>
                      </section>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}
          {/* ===================== TAB 4: R3.4 PROFESSIONAL SCIENTIFIC MODULES ===================== */}
          {activeTab === 'modules' && <BioHarnessDomainModulesPanel />}
        </div>
      </div>
    </div>
  );
});

export default BioHarnessCapabilitiesRoute;
