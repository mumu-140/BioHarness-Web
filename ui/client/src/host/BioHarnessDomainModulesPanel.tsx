/**
 * R3.4 Professional Scientific Modules Workbench seated inside `/w/capabilities?tab=modules`
 * (not upstream LibreChat code).
 */
import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  BookOpen,
  Boxes,
  CheckCircle2,
  Dna,
  FileBarChart2,
  Paperclip,
  RefreshCw,
  Scale,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { Button, Input, Spinner } from '@librechat/client';
import {
  bhKeys,
  fetchDomainModules,
  fetchView,
  inspectLiteratureArtifact,
  runLiteratureModule,
  runProteinModule,
  runStatisticsReportBinding,
  type DomainModulesResponse,
  type LiteratureInspectResponse,
  type NowData,
  type ProteinOperation,
  type ProteinRunResponse,
  type Snapshot,
  type StatisticsReportBindingResponse,
  type WorkspaceInputFile,
} from './bioharness';
import {
  LiteratureDomainCard,
  ProteinMethodsDomainCard,
  ScientificReviewCard,
  StatisticsDomainCard,
} from './BioHarnessDomainRenderers';
import { useBhText } from './i18n';
import { useBioHarnessWorkspace } from './workspace';

const PROTEIN_OPERATIONS: ProteinOperation[] = [
  'structure-inventory',
  'task-review',
  'manifest-review',
  'run-audit',
  'outcome-audit',
  'structure-compare',
];

export default function BioHarnessDomainModulesPanel() {
  const { tr } = useBhText();
  const queryClient = useQueryClient();
  const {
    service,
    workspace,
    selectedRequestId,
    linkedConversationId,
    stageTextInConversation,
    attachFileToConversation,
  } = useBioHarnessWorkspace();
  const contextKey = `${service ?? 'svc'}::${workspace ?? 'ws'}::${selectedRequestId ?? 'none'}`;
  const contextKeyRef = useRef(contextKey);
  contextKeyRef.current = contextKey;

  const invalidateAfterModuleRun = (snapSvc: string | null, snapWs: string | null, snapConvo: string | null) => {
    if (!snapSvc || !snapWs) return;
    void queryClient.invalidateQueries({ queryKey: bhKeys.domainModules(snapSvc, snapWs) });
    void queryClient.invalidateQueries({ queryKey: bhKeys.inputs(snapSvc, snapWs) });
    void queryClient.invalidateQueries({ queryKey: ['bh', snapSvc, snapWs, 'capabilities'] });
    if (snapConvo) {
      void queryClient.invalidateQueries({ queryKey: ['bh', snapSvc, snapWs, 'invocations', snapConvo] });
    }
  };

  const modulesQuery = useQuery<DomainModulesResponse>({
    queryKey: bhKeys.domainModules(service ?? 'svc', workspace ?? ''),
    queryFn: () => fetchDomainModules(workspace!),
    enabled: Boolean(service && workspace),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  // Read active Core request `views/now` for live Scientific Review observations
  const nowQuery = useQuery<Snapshot<NowData>>({
    queryKey: bhKeys.view(service ?? 'svc', workspace ?? '', 'now', {
      request_id: selectedRequestId ?? undefined,
    }),
    queryFn: () => fetchView<NowData>(workspace!, 'now', { request_id: selectedRequestId ?? undefined }),
    enabled: Boolean(service && workspace && selectedRequestId),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  // --- Literature state ---
  const [litPath, setLitPath] = useState('');
  const [litOffset, setLitOffset] = useState(0);
  const [litData, setLitData] = useState<LiteratureInspectResponse | null>(null);
  const [litErr, setLitErr] = useState<string | null>(null);
  const [litQuestion, setLitQuestion] = useState('');
  const [litRunResult, setLitRunResult] = useState<Record<string, unknown> | null>(null);
  const [litSavedArtifact, setLitSavedArtifact] = useState<WorkspaceInputFile | null>(null);
  const litInspectMutation = useMutation({
    mutationFn: async (vars: { path: string; offset: number }) => {
      const snapKey = contextKeyRef.current;
      const res = await inspectLiteratureArtifact(workspace!, { path: vars.path, offset: vars.offset, limit: 10 });
      return { snapKey, res };
    },
    onSuccess: ({ snapKey, res }) => {
      if (contextKeyRef.current !== snapKey) return;
      setLitData(res);
      setLitOffset(res.offset);
      setLitErr(null);
    },
    onError: (err) => setLitErr(err instanceof Error ? err.message : String(err)),
  });
  const litRunMutation = useMutation({
    mutationFn: async () => {
      const snapKey = contextKeyRef.current;
      const snapSvc = service;
      const snapWs = workspace;
      const snapConvo = linkedConversationId;
      const res = await runLiteratureModule(workspace!, {
        operation: 'search',
        question: litQuestion.trim(),
        maximum: 10,
        iterations: 2,
        save_output: true,
        conversation_id: linkedConversationId ?? undefined,
      });
      return { snapKey, snapSvc, snapWs, snapConvo, res };
    },
    onSuccess: ({ snapKey, snapSvc, snapWs, snapConvo, res }) => {
      invalidateAfterModuleRun(snapSvc, snapWs, snapConvo);
      if (contextKeyRef.current !== snapKey) return;
      setLitRunResult(res.result);
      setLitSavedArtifact(res.saved_artifact ?? null);
      setLitErr(null);
    },
    onError: (err) => setLitErr(err instanceof Error ? err.message : String(err)),
  });

  // --- Statistics state ---
  const [statAction, setStatAction] = useState<'inspect' | 'render' | 'verify'>('render');
  const [statRecordsPath, setStatRecordsPath] = useState('');
  const [statTemplatePath, setStatTemplatePath] = useState('');
  const [statReportPath, setStatReportPath] = useState('');
  const [statResult, setStatResult] = useState<StatisticsReportBindingResponse | null>(null);
  const [lastStatSavedArtifact, setLastStatSavedArtifact] = useState<WorkspaceInputFile | null>(null);
  const [statErr, setStatErr] = useState<string | null>(null);
  const statMutation = useMutation({
    mutationFn: async (override?: {
      action?: 'inspect' | 'render' | 'verify';
      records_path?: string;
      template_path?: string;
      report_path?: string;
    }) => {
      const snapKey = contextKeyRef.current;
      const snapSvc = service;
      const snapWs = workspace;
      const snapConvo = linkedConversationId;
      const act = override?.action ?? statAction;
      const rec = (override?.records_path ?? statRecordsPath).trim();
      const tpl = (override?.template_path ?? statTemplatePath).trim() || undefined;
      const rep = (override?.report_path ?? statReportPath).trim() || undefined;
      const res = await runStatisticsReportBinding(workspace!, {
        action: act,
        records_path: rec,
        template_path: tpl,
        report_path: rep,
        save_output: true,
        conversation_id: linkedConversationId ?? undefined,
      });
      return { snapKey, snapSvc, snapWs, snapConvo, res };
    },
    onSuccess: ({ snapKey, snapSvc, snapWs, snapConvo, res }) => {
      invalidateAfterModuleRun(snapSvc, snapWs, snapConvo);
      if (contextKeyRef.current !== snapKey) return;
      setStatResult(res);
      if (res.saved_artifact) {
        setLastStatSavedArtifact(res.saved_artifact);
      }
      setStatErr(null);
    },
    onError: (err) => setStatErr(err instanceof Error ? err.message : String(err)),
  });

  // --- Protein Methods state ---
  const [protOp, setProtOp] = useState<ProteinOperation>('structure-inventory');
  const [protInputPath, setProtInputPath] = useState('');
  const [protRefPath, setProtRefPath] = useState('');
  const [protMapPath, setProtMapPath] = useState('');
  const [protResult, setProtResult] = useState<ProteinRunResponse | null>(null);
  const [protErr, setProtErr] = useState<string | null>(null);
  const protMutation = useMutation({
    mutationFn: async () => {
      const snapKey = contextKeyRef.current;
      const snapSvc = service;
      const snapWs = workspace;
      const snapConvo = linkedConversationId;
      const res = await runProteinModule(workspace!, {
        operation: protOp,
        input_path: protInputPath.trim(),
        reference_path: protRefPath.trim() || undefined,
        mapping_path: protMapPath.trim() || undefined,
        save_output: true,
        conversation_id: linkedConversationId ?? undefined,
      });
      return { snapKey, snapSvc, snapWs, snapConvo, res };
    },
    onSuccess: ({ snapKey, snapSvc, snapWs, snapConvo, res }) => {
      invalidateAfterModuleRun(snapSvc, snapWs, snapConvo);
      if (contextKeyRef.current !== snapKey) return;
      setProtResult(res);
      setProtErr(null);
    },
    onError: (err) => setProtErr(err instanceof Error ? err.message : String(err)),
  });

  // Reset module selections and results on workspace change to guarantee strict isolation
  useEffect(() => {
    setLitPath('');
    setLitOffset(0);
    setLitData(null);
    setLitErr(null);
    setLitQuestion('');
    setLitRunResult(null);
    setLitSavedArtifact(null);
    setStatAction('render');
    setStatRecordsPath('');
    setStatTemplatePath('');
    setStatReportPath('');
    setStatResult(null);
    setLastStatSavedArtifact(null);
    setStatErr(null);
    setProtOp('structure-inventory');
    setProtInputPath('');
    setProtRefPath('');
    setProtMapPath('');
    setProtResult(null);
    setProtErr(null);
  }, [workspace]);

  const isLinkedDelivered = !nowQuery.data?.ok || nowQuery.data.data?.phase === 'DELIVERED';
  const attachArtifact = (file: WorkspaceInputFile) =>
    attachFileToConversation?.({
      file,
      conversationId: isLinkedDelivered ? null : linkedConversationId,
      requestId: isLinkedDelivered ? null : selectedRequestId,
    });
  const stageSnippet = (snippet: string) =>
    stageTextInConversation({
      conversationId: linkedConversationId,
      requestId: selectedRequestId,
      snippet,
    });

  const data = modulesQuery.data;
  const byId = new Map((data?.modules ?? []).map((m) => [m.id, m]));
  const litMod = byId.get('literature');
  const statMod = byId.get('statistics');
  const revMod = byId.get('scientific-review');
  const protMod = byId.get('protein-methods');
  const nonRunnableMods = (data?.modules ?? []).filter((m) => !m.inspectable);

  const jsonFiles = data?.workspace_files?.json ?? [];
  const tplFiles = data?.workspace_files?.templates ?? [];
  const structFiles = data?.workspace_files?.structures ?? [];
  const nowData = nowQuery.data?.ok ? nowQuery.data.data : undefined;

  return (
    <div data-testid="bh-cap-modules-panel" className="space-y-4">
      {/* Module Inventory Overview */}
      <section className="border-border-light bg-surface-primary space-y-3 rounded-xl border p-4 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-text-primary flex items-center gap-1.5 text-sm font-semibold">
              <Boxes className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
              <span>{tr('BioHarness 专业科研模块能力台账', 'BioHarness Professional Scientific Modules')}</span>
            </h2>
            <p className="text-text-tertiary mt-0.5 text-[11px]">
              {tr(
                '按模块真实安装版本与公开 CLI 边界接入；未启用或仅参考的模块保持诚实标注，不提供虚假按钮。',
                'Backed by real installed module versions and public CLIs; non-runnable modules remain honestly disclosed.',
              )}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="bh-domain-modules-refresh-btn"
            onClick={() => void modulesQuery.refetch()}
            className="gap-1.5 text-xs"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{tr('刷新模块状态', 'Refresh Modules')}</span>
          </Button>
        </div>

        {modulesQuery.isLoading ? (
          <div className="flex items-center gap-2 py-4">
            <Spinner className="h-4 w-4" />
            <span>{tr('正在检测本地专业科研模块…', 'Probing installed scientific modules…')}</span>
          </div>
        ) : modulesQuery.isError ? (
          <div role="alert" className="text-text-destructive">
            {(modulesQuery.error as Error)?.message || tr('读取模块列表失败', 'Failed to load modules')}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(data?.modules ?? []).map((mod) => (
              <div
                key={mod.id}
                data-testid={`bh-domain-mod-${mod.id}`}
                className="border-border-light bg-surface-secondary/25 space-y-1 rounded-lg border p-2.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="text-text-primary font-semibold">{mod.title}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-medium ${
                      mod.callable
                        ? 'bg-teal-500/15 text-teal-700 dark:text-teal-300'
                        : mod.installed
                          ? 'bg-amber-500/15 text-amber-800 dark:text-amber-200'
                          : 'bg-surface-hover text-text-tertiary'
                    }`}
                  >
                    {mod.status}
                  </span>
                </div>
                <div className="text-text-tertiary flex flex-wrap gap-2 font-mono text-[10px]">
                  {mod.command && <span>cli={mod.command}</span>}
                  {mod.version && <span>v{mod.version}</span>}
                  {mod.source_sha && <span>sha={mod.source_sha}</span>}
                  <span>used={mod.use_count}</span>
                </div>
                <p className="text-text-secondary text-[11px] leading-snug">{mod.note}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 1. Literature Workbench */}
      <section
        data-testid="bh-domain-literature-workbench"
        className="border-border-light bg-surface-primary space-y-3 rounded-xl border p-4 text-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-text-primary flex items-center gap-1.5 text-sm font-semibold">
            <BookOpen className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
            <span>{tr('1. Literature 文献检索与产物审阅', '1. Literature Search & Artifact Inspector')}</span>
          </h3>
          <div className="flex flex-wrap gap-1 text-[10px]">
            {litMod?.providers &&
              Object.entries(litMod.providers).map(([k, p]) => (
                <span
                  key={k}
                  data-testid={`bh-lit-provider-${k}`}
                  className={`rounded px-1.5 py-0.5 font-mono ${
                    p.available
                      ? 'bg-teal-500/15 text-teal-700 dark:text-teal-300'
                      : 'bg-amber-500/15 text-amber-800 dark:text-amber-200'
                  }`}
                >
                  {k}: {p.available ? tr('可用', 'Ready') : p.status ?? tr('未在 PATH', 'Unavailable')}
                </span>
              ))}
          </div>
        </div>

        {/* Inspect existing search.json / downloads.json */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="sm:col-span-2 flex gap-2">
            <select
              data-testid="bh-lit-file-select"
              value={litPath}
              onChange={(e) => setLitPath(e.target.value)}
              className="border-border-medium bg-surface-primary text-text-primary flex-1 rounded-lg border px-2 py-1.5 text-xs"
            >
              <option value="">{tr('选择工作区内的 search.json / downloads.json…', 'Pick search.json / downloads.json…')}</option>
              {jsonFiles.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              data-testid="bh-lit-inspect-btn"
              disabled={!litPath || litInspectMutation.isLoading}
              onClick={() => litInspectMutation.mutate({ path: litPath, offset: 0 })}
              className="shrink-0 text-xs"
            >
              {litInspectMutation.isLoading ? <Spinner className="mr-1 h-3.5 w-3.5" /> : null}
              {tr('审阅文献产物', 'Inspect Artifact')}
            </Button>
          </div>

          {/* Live search via bioharness-literature (only enabled if paperseek is available) */}
          <div className="flex gap-1.5">
            <Input
              data-testid="bh-lit-search-input"
              value={litQuestion}
              onChange={(e) => setLitQuestion(e.target.value)}
              disabled={!litMod?.providers?.paperseek?.available}
              placeholder={
                litMod?.providers?.paperseek?.available
                  ? tr('输入文献检索问题…', 'Literature query…')
                  : tr('paperseek 未就绪（仅审阅产物）', 'paperseek unavailable')
              }
              className="h-8 flex-1 text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-testid="bh-lit-search-btn"
              disabled={!litMod?.providers?.paperseek?.available || !litQuestion.trim() || litRunMutation.isLoading}
              onClick={() => litRunMutation.mutate()}
              className="h-8 shrink-0 gap-1 px-2 text-xs"
            >
              <Search className="h-3 w-3" aria-hidden="true" />
              <span>{tr('检索', 'Search')}</span>
            </Button>
          </div>
        </div>

        {litErr && (
          <div role="alert" className="text-text-destructive text-xs">
            {litErr}
          </div>
        )}
        {litData && (
          <LiteratureDomainCard
            data={litData}
            onPrevPage={() =>
              litInspectMutation.mutate({ path: litData.source_file, offset: Math.max(0, litOffset - 10) })
            }
            onNextPage={() =>
              litInspectMutation.mutate({ path: litData.source_file, offset: litOffset + 10 })
            }
            onStageText={stageSnippet}
          />
        )}
        {litSavedArtifact && (
          <div
            data-testid="bh-lit-saved-artifact"
            className="border-border-light bg-surface-secondary/30 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[11px]"
          >
            <span className="font-mono">
              {tr('已落盘产物：', 'Saved artifact: ')}
              {litSavedArtifact.relative_path ?? litSavedArtifact.server_path}
              {litSavedArtifact.sha256 ? ` (sha256:${litSavedArtifact.sha256.slice(0, 12)})` : ''}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="bh-lit-attach-artifact-btn"
              onClick={() => attachArtifact(litSavedArtifact)}
              className="h-7 gap-1 px-2 text-[11px]"
            >
              <Paperclip className="h-3 w-3" aria-hidden="true" />
              <span>{tr('附加到对话输入', 'Attach to conversation')}</span>
            </Button>
          </div>
        )}
        {litRunResult && (
          <LiteratureDomainCard
            data={litRunResult as Partial<LiteratureInspectResponse>}
            onStageText={stageSnippet}
          />
        )}
      </section>

      {/* 2. Statistics Report Binding Workbench */}
      <section
        data-testid="bh-domain-statistics-workbench"
        className="border-border-light bg-surface-primary space-y-3 rounded-xl border p-4 text-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-text-primary flex items-center gap-1.5 text-sm font-semibold">
            <FileBarChart2 className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
            <span>{tr('2. Statistics 统计记录与 report_binding 核验', '2. Statistics & Report Binding')}</span>
          </h3>
          <span className="text-text-tertiary font-mono text-[10px]">
            clinical reviewers: {statMod?.subcomponents?.clinical_subgroup_reviewers ?? 'PRODUCTION_NOT_ENABLED'}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
          <label className="space-y-1 text-[11px]">
            <span className="text-text-tertiary block">{tr('操作', 'Action')}</span>
            <select
              data-testid="bh-stat-action-select"
              value={statAction}
              onChange={(e) => setStatAction(e.target.value as 'inspect' | 'render' | 'verify')}
              className="border-border-medium bg-surface-primary text-text-primary w-full rounded-lg border px-2 py-1.5 text-xs"
            >
              <option value="render">{tr('确定性渲染 (render)', 'Deterministic render')}</option>
              <option value="verify">{tr('一致性校验 (verify)', 'Verify existing report')}</option>
              <option value="inspect">{tr('仅检视记录包 (inspect)', 'Inspect bundle only')}</option>
            </select>
          </label>

          <label className="space-y-1 text-[11px]">
            <span className="text-text-tertiary block">{tr('结果 JSON 包 (--records)', 'Records JSON')}</span>
            <select
              data-testid="bh-stat-records-select"
              value={statRecordsPath}
              onChange={(e) => setStatRecordsPath(e.target.value)}
              className="border-border-medium bg-surface-primary text-text-primary w-full rounded-lg border px-2 py-1.5 text-xs"
            >
              <option value="">{tr('选择统计 JSON…', 'Select JSON…')}</option>
              {jsonFiles.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-[11px]">
            <span className="text-text-tertiary block">{tr('模板文件 (--template)', 'Template (.md/.txt)')}</span>
            <select
              data-testid="bh-stat-template-select"
              value={statTemplatePath}
              onChange={(e) => setStatTemplatePath(e.target.value)}
              disabled={statAction === 'inspect'}
              className="border-border-medium bg-surface-primary text-text-primary w-full rounded-lg border px-2 py-1.5 text-xs"
            >
              <option value="">{tr('选择模板…', 'Select template…')}</option>
              {tplFiles.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-[11px]">
            <span className="text-text-tertiary block">{tr('待核验报告 (--report)', 'Report (verify only)')}</span>
            <select
              data-testid="bh-stat-report-select"
              value={statReportPath}
              onChange={(e) => setStatReportPath(e.target.value)}
              disabled={statAction !== 'verify'}
              className="border-border-medium bg-surface-primary text-text-primary w-full rounded-lg border px-2 py-1.5 text-xs"
            >
              <option value="">{tr('选择报告文件…', 'Select report…')}</option>
              {tplFiles.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            data-testid="bh-stat-run-btn"
            disabled={
              !statRecordsPath ||
              (statAction !== 'inspect' && !statTemplatePath) ||
              (statAction === 'verify' && !statReportPath) ||
              statMutation.isLoading
            }
            onClick={() => statMutation.mutate(undefined)}
            className="text-xs"
          >
            {statMutation.isLoading ? <Spinner className="mr-1 h-3.5 w-3.5" /> : null}
            {tr('执行模块 report_binding', 'Run Statistics Report Binding')}
          </Button>
          {statErr && (
            <span role="alert" className="text-text-destructive text-xs">
              {statErr}
            </span>
          )}
        </div>
        {(statResult?.saved_artifact ?? lastStatSavedArtifact) && (() => {
          const activeArtifact = (statResult?.saved_artifact ?? lastStatSavedArtifact)!;
          return (
            <div
              data-testid="bh-stat-saved-artifact"
              className="border-border-light bg-surface-secondary/30 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[11px]"
            >
              <div className="min-w-0">
                <div className="text-text-primary font-medium">
                  {tr('渲染产物已持久化并记入技术账本', 'Artifact persisted & recorded in ledger')}
                </div>
                <div className="text-text-tertiary truncate font-mono text-[10px]">
                  {activeArtifact.relative_path ?? activeArtifact.server_path}
                  {activeArtifact.sha256 ? ` · sha256:${activeArtifact.sha256.slice(0, 12)}` : ''}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {statResult?.action === 'render' && activeArtifact.relative_path && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    data-testid="bh-stat-verify-saved-btn"
                    disabled={statMutation.isLoading}
                    onClick={() => {
                      const savedPath = activeArtifact.relative_path!;
                      setStatAction('verify');
                      setStatReportPath(savedPath);
                      statMutation.mutate({
                        action: 'verify',
                        records_path: statResult.records_file,
                        template_path: statResult.template_file ?? statTemplatePath,
                        report_path: savedPath,
                      });
                    }}
                    className="h-7 px-2 text-[11px]"
                  >
                    {tr('立即核验此产物 (verify)', 'Verify saved artifact')}
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="bh-stat-attach-artifact-btn"
                  onClick={() => attachArtifact(activeArtifact)}
                  className="h-7 gap-1 px-2 text-[11px]"
                >
                  <Paperclip className="h-3 w-3" aria-hidden="true" />
                  <span>{tr('附加到对话输入', 'Attach to conversation')}</span>
                </Button>
              </div>
            </div>
          );
        })()}

        {statResult && <StatisticsDomainCard data={statResult} onStageText={stageSnippet} />}
      </section>

      {/* 3. Scientific Review Panel */}
      <section
        data-testid="bh-domain-review-workbench"
        className="border-border-light bg-surface-primary space-y-3 rounded-xl border p-4 text-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-text-primary flex items-center gap-1.5 text-sm font-semibold">
            <Scale className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
            <span>{tr('3. Scientific Review 科学审查观测与版本状态', '3. Scientific Review Status & Records')}</span>
          </h3>
          <div className="flex flex-wrap gap-1 font-mono text-[10px]">
            {revMod?.version && (
              <span className="bg-surface-hover text-text-secondary rounded px-1.5 py-0.5">
                current: v{revMod.version} ({revMod.source_sha})
              </span>
            )}
            {(revMod?.releases ?? []).map((r) => (
              <span key={r.sha} className="bg-surface-hover text-text-tertiary rounded px-1.5 py-0.5">
                release: {r.version ?? '?'} ({r.sha})
              </span>
            ))}
          </div>
        </div>

        {revMod?.direct_model_api_gap_note && (
          <div
            data-testid="bh-review-api-gap-note"
            className="flex items-start gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-[11px] text-amber-900 dark:text-amber-200"
          >
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{revMod.direct_model_api_gap_note}</span>
          </div>
        )}

        {nowData && (nowData.plan_review || nowData.step?.last_review || (nowData.open_concerns?.length ?? 0) > 0) ? (
          <ScientificReviewCard
            title={tr(`当前科研请求审查记录 (${nowData.request_id})`, `Active Request Review (${nowData.request_id})`)}
            advice={
              ((nowData.plan_review ?? nowData.step?.last_review) as Record<string, unknown> | undefined) ?? null
            }
            openConcerns={nowData.open_concerns}
            attempts={nowData.step?.attempt}
          />
        ) : (
          <p className="text-text-tertiary text-xs">
            {selectedRequestId
              ? tr(
                  `当前请求 ${selectedRequestId} 暂无已记录的外部科学审查意见（advisor 状态：${
                    revMod?.advisor_config?.configured ? '已配置' : '工作区未配置 [advisor]'
                  }）。`,
                  `No external scientific review recorded yet for ${selectedRequestId}.`,
                )
              : tr('在侧栏选中一个科研请求后，可在此及“研究流程”页查看其非阻断科学审查与修订记录。', 'Select a request from the sidebar to inspect recorded reviews.')}
          </p>
        )}
      </section>

      {/* 4. Protein Methods CLI Workbench */}
      <section
        data-testid="bh-domain-protein-workbench"
        className="border-border-light bg-surface-primary space-y-3 rounded-xl border p-4 text-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-text-primary flex items-center gap-1.5 text-sm font-semibold">
            <Dna className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
            <span>{tr('4. Protein Methods 结构与设计审计 CLI', '4. Protein Methods Audit CLI')}</span>
          </h3>
          <span className="text-text-tertiary font-mono text-[10px]">
            {protMod?.callable ? (
              <span className="inline-flex items-center gap-1 text-teal-700 dark:text-teal-300">
                <CheckCircle2 className="h-3 w-3" /> v{protMod.version}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-3 w-3" /> {tr('未安装', 'Not installed')}
              </span>
            )}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="space-y-1 text-[11px]">
            <span className="text-text-tertiary block">{tr('子命令 (Operation)', 'Operation')}</span>
            <select
              data-testid="bh-protein-op-select"
              value={protOp}
              onChange={(e) => setProtOp(e.target.value as ProteinOperation)}
              className="border-border-medium bg-surface-primary text-text-primary w-full rounded-lg border px-2 py-1.5 text-xs"
            >
              {PROTEIN_OPERATIONS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-[11px] sm:col-span-2">
            <span className="text-text-tertiary block">
              {tr('输入文件（PDB/mmCIF 或审计 JSON）', 'Input file (PDB/mmCIF or audit JSON)')}
            </span>
            <div className="flex gap-2">
              <select
                data-testid="bh-protein-input-select"
                value={protInputPath}
                onChange={(e) => setProtInputPath(e.target.value)}
                className="border-border-medium bg-surface-primary text-text-primary flex-1 rounded-lg border px-2 py-1.5 text-xs"
              >
                <option value="">{tr('选择工作区文件…', 'Select workspace file…')}</option>
                {(protOp.startsWith('structure-') ? [...structFiles, ...jsonFiles] : [...jsonFiles, ...structFiles]).map(
                  (f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ),
                )}
              </select>
              <Button
                type="button"
                size="sm"
                data-testid="bh-protein-run-btn"
                disabled={!protMod?.callable || !protInputPath || protMutation.isLoading}
                onClick={() => protMutation.mutate()}
                className="shrink-0 text-xs"
              >
                {protMutation.isLoading ? <Spinner className="mr-1 h-3.5 w-3.5" /> : null}
                {tr('运行审计', 'Run Audit')}
              </Button>
            </div>
          </label>
        </div>

        {protOp === 'structure-compare' && (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input
              value={protRefPath}
              onChange={(e) => setProtRefPath(e.target.value)}
              placeholder={tr('参考结构相对路径 (reference.pdb)', 'Reference structure path')}
              className="h-8 text-xs"
            />
            <Input
              value={protMapPath}
              onChange={(e) => setProtMapPath(e.target.value)}
              placeholder={tr('映射 JSON 路径 (mapping.json)', 'Atom mapping JSON path')}
              className="h-8 text-xs"
            />
          </div>
        )}

        {protErr && (
          <div role="alert" className="text-text-destructive text-xs">
            {protErr}
          </div>
        )}
        {protResult?.saved_artifact && (
          <div
            data-testid="bh-protein-saved-artifact"
            className="border-border-light bg-surface-secondary/30 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-[11px]"
          >
            <div className="min-w-0">
              <div className="text-text-primary font-medium">
                {tr('审计产物已持久化并记入技术账本', 'Audit artifact persisted & recorded in ledger')}
              </div>
              <div className="text-text-tertiary truncate font-mono text-[10px]">
                {protResult.saved_artifact.relative_path ?? protResult.saved_artifact.server_path}
                {protResult.saved_artifact.sha256 ? ` · sha256:${protResult.saved_artifact.sha256.slice(0, 12)}` : ''}
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="bh-protein-attach-artifact-btn"
              onClick={() => attachArtifact(protResult.saved_artifact!)}
              className="h-7 gap-1 px-2 text-[11px]"
            >
              <Paperclip className="h-3 w-3" aria-hidden="true" />
              <span>{tr('附加到对话输入', 'Attach to conversation')}</span>
            </Button>
          </div>
        )}
        {protResult && (
          <ProteinMethodsDomainCard
            operation={protResult.operation}
            result={protResult.result}
            inputFile={protResult.input_file}
            onStageText={stageSnippet}
          />
        )}
      </section>

      {/* Persisted Technical Ledger Module Invocations */}
      {data?.recent_invocations && data.recent_invocations.length > 0 && (
        <section
          data-testid="bh-domain-recent-invocations"
          className="border-border-light bg-surface-primary space-y-2 rounded-xl border p-4 text-xs"
        >
          <h3 className="text-text-primary text-sm font-semibold">
            {tr('最近专业模块执行记录（技术账本）', 'Recent Professional Module Executions (Ledger)')}
          </h3>
          <div className="space-y-1.5">
            {data.recent_invocations.slice(0, 10).map((inv) => (
              <div
                key={inv.id}
                data-testid={`bh-domain-invocation-${inv.module_id}-${inv.operation}`}
                className="border-border-light bg-surface-secondary/20 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2.5 py-2"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-text-primary font-mono font-semibold">
                      {inv.module_id}:{inv.operation}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                        inv.state === 'SUCCEEDED'
                          ? 'bg-teal-500/15 text-teal-700 dark:text-teal-300'
                          : 'bg-amber-500/15 text-amber-800 dark:text-amber-200'
                      }`}
                    >
                      {inv.state}
                    </span>
                    <span className="text-text-tertiary font-mono text-[10px]">{inv.at}</span>
                  </div>
                  {inv.saved_artifact && (
                    <div className="text-text-tertiary truncate font-mono text-[10px]">
                      {inv.saved_artifact.relative_path ?? inv.saved_artifact.server_path}
                      {inv.saved_artifact.sha256 ? ` (sha256:${inv.saved_artifact.sha256.slice(0, 12)})` : ''}
                    </div>
                  )}
                </div>
                {inv.saved_artifact && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => attachArtifact(inv.saved_artifact!)}
                    className="h-7 gap-1 px-2 text-[11px]"
                  >
                    <Paperclip className="h-3 w-3" aria-hidden="true" />
                    <span>{tr('附加', 'Attach')}</span>
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 5. Honest Non-Runnable / Reference Domain Modules Disclosure */}
      {nonRunnableMods.length > 0 && (
        <section
          data-testid="bh-domain-nonrunnable-section"
          className="border-border-light bg-surface-secondary/25 space-y-2 rounded-xl border p-3.5 text-xs"
        >
          <div className="text-text-primary font-semibold">
            {tr('仅参考 / 未开放运行的领域模块（不提供虚假运行入口）', 'Reference-Only / Non-Runnable Modules')}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {nonRunnableMods.map((m) => (
              <div key={m.id} className="border-border-light bg-surface-primary rounded-lg border p-2.5">
                <div className="font-medium">{m.title}</div>
                <div className="text-text-tertiary mt-0.5 font-mono text-[10px]">{m.status}</div>
                <p className="text-text-secondary mt-1 text-[11px]">{m.note}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
