/**
 * R3.3 BioHarness Settings IA panels seated inside LibreChat's adopted SettingsDialog
 * (not upstream LibreChat code):
 * - Skills & Resources summary + link to `/w/capabilities?tab=capabilities`
 * - Research Memory status + boundaries + link to `/w/capabilities?tab=memory`
 * - Scientific Modules (MCP + CLI + R4 Compute notice)
 * - Diagnostics & Security Posture + redacted JSON copy & download
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';
import { Button, Spinner } from '@librechat/client';
import {
  bhKeys,
  fetchCapabilities,
  fetchDiagnostics,
  fetchMemoryStatus,
  type CapabilitiesResponse,
  type DiagnosticsResponse,
  type MemoryOverviewResponse,
} from './bioharness';
import { formatCompactTime, useBhText } from './i18n';
import { useBioHarnessWorkspace } from './workspace';

export function BioHarnessSkillsSettings() {
  const { tr } = useBhText();
  const { service, workspace, selectedScopeId, selectedRequestId, openCapabilitiesView } =
    useBioHarnessWorkspace();

  const capsQuery = useQuery<CapabilitiesResponse>({
    queryKey: bhKeys.capabilities(service ?? 'svc', workspace ?? '', selectedScopeId, selectedRequestId, false),
    queryFn: () =>
      fetchCapabilities(workspace!, {
        scopeId: selectedScopeId,
        requestId: selectedRequestId,
        probeMcp: false,
      }),
    enabled: Boolean(service && workspace),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  if (!workspace) {
    return <p className="text-text-tertiary text-xs">{tr('尚未选择工作区。', 'No workspace active.')}</p>;
  }

  return (
    <div data-testid="bh-settings-skills-panel" className="space-y-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-text-secondary">
          {tr(
            '展示当前工作区的 SKILL.md、Core [[resources]] 四态概览与 Governance 项目文档候选。',
            'Summarizes workspace SKILL.md entries, Core [[resources]], and Governance document candidates.',
          )}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => openCapabilitiesView({ tab: 'capabilities' })}
          className="gap-1.5 text-xs"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{tr('打开完整能力中心', 'Open Capabilities View')}</span>
        </Button>
      </div>

      {capsQuery.isLoading ? (
        <div className="flex items-center gap-2 py-2">
          <Spinner className="h-3.5 w-3.5" />
          <span>{tr('加载能力摘要…', 'Loading summary…')}</span>
        </div>
      ) : capsQuery.data ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div className="border-border-light bg-surface-secondary/30 rounded-lg border p-2.5">
            <div className="text-text-tertiary text-[11px]">Workspace SKILL.md</div>
            <div className="text-text-primary mt-0.5 text-base font-semibold">
              {capsQuery.data.skills.length}
            </div>
          </div>
          <div className="border-border-light bg-surface-secondary/30 rounded-lg border p-2.5">
            <div className="text-text-tertiary text-[11px]">Core [[resources]]</div>
            <div className="text-text-primary mt-0.5 text-base font-semibold">
              {capsQuery.data.resources.length}
            </div>
          </div>
          <div className="border-border-light bg-surface-secondary/30 rounded-lg border p-2.5">
            <div className="text-text-tertiary text-[11px]">{tr('可用文档候选', 'Doc Candidates')}</div>
            <div className="text-text-primary mt-0.5 text-base font-semibold">
              {capsQuery.data.documents.candidates.length}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function BioHarnessMemorySettings() {
  const { tr, zh } = useBhText();
  const { service, workspace, openCapabilitiesView } = useBioHarnessWorkspace();

  const memQuery = useQuery<MemoryOverviewResponse>({
    queryKey: bhKeys.memoryStatus(service ?? 'svc', workspace ?? ''),
    queryFn: () => fetchMemoryStatus(workspace!),
    enabled: Boolean(service && workspace),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  if (!workspace) {
    return <p className="text-text-tertiary text-xs">{tr('尚未选择工作区。', 'No workspace active.')}</p>;
  }

  return (
    <div data-testid="bh-settings-memory-panel" className="space-y-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-text-secondary">
          {tr(
            '检查 bioharness-module-memory MCP 连接、FAST/STANDARD vs DEEP 范围，以及 Curator 边界说明。',
            'Inspect bioharness-module-memory connectivity, recall scope, and Curator interface status.',
          )}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => openCapabilitiesView({ tab: 'memory' })}
          className="gap-1.5 text-xs"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{tr('进入科研记忆工作台', 'Open Memory Workbench')}</span>
        </Button>
      </div>

      {memQuery.isLoading ? (
        <Spinner className="h-3.5 w-3.5" />
      ) : memQuery.data ? (
        <div className="border-border-light bg-surface-secondary/30 space-y-2 rounded-lg border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">
              {memQuery.data.callable
                ? tr(`已连通: ${memQuery.data.server}`, `Connected: ${memQuery.data.server}`)
                : tr('未连接 / 未配置 Memory MCP', 'Memory MCP unavailable')}
            </span>
            <span className="text-text-tertiary text-[11px]">
              {formatCompactTime(memQuery.data.checked_at, zh) || memQuery.data.checked_at}
            </span>
          </div>
          {memQuery.data.error && (
            <p className="text-amber-700 dark:text-amber-300">
              [{memQuery.data.error.code}] {memQuery.data.error.message}
            </p>
          )}
          <p className="text-text-tertiary text-[11px]">
            {memQuery.data.capabilities.curator_gap_note ??
              tr('Curator 交互发布工具已可用。', 'Interactive Curator tools available.')}
          </p>
        </div>
      ) : null}
    </div>
  );
}

export function BioHarnessModulesSettings() {
  const { tr } = useBhText();
  const { service, workspace, openCapabilitiesView } = useBioHarnessWorkspace();

  const capsQuery = useQuery<CapabilitiesResponse>({
    queryKey: bhKeys.capabilities(service ?? 'svc', workspace ?? '', null, null, true),
    queryFn: () => fetchCapabilities(workspace!, { probeMcp: true }),
    enabled: Boolean(service && workspace),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  if (!workspace) {
    return <p className="text-text-tertiary text-xs">{tr('尚未选择工作区。', 'No workspace active.')}</p>;
  }

  return (
    <div data-testid="bh-settings-modules-panel" className="space-y-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-text-secondary">
          {tr(
            '查看当前环境实际可发现的 MCP 服务、BioHarness 专业 CLI 模块及 R4 远端算力范围边界。',
            'Review configured MCP servers, CLI scientific modules, and R4 deferred compute boundaries.',
          )}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => openCapabilitiesView({ tab: 'capabilities' })}
          className="gap-1.5 text-xs"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          <span>{tr('查看详情', 'Inspect Details')}</span>
        </Button>
      </div>

      {capsQuery.isLoading ? (
        <Spinner className="h-3.5 w-3.5" />
      ) : capsQuery.data ? (
        <div className="space-y-2">
          <div className="border-border-light bg-surface-secondary/30 rounded-lg border p-2.5">
            <div className="font-medium">
              MCP Servers: {capsQuery.data.mcp_servers.length} · CLI Modules:{' '}
              {capsQuery.data.cli_modules.filter((m) => m.installed).length}/{capsQuery.data.cli_modules.length}
            </div>
            <p className="text-text-tertiary mt-1 text-[11px]">{capsDataNote(capsQuery.data)}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function capsDataNote(data: CapabilitiesResponse): string {
  return data.compute.note;
}

export function BioHarnessDiagnosticsSettings() {
  const { tr } = useBhText();
  const { service, workspace } = useBioHarnessWorkspace();
  const [copied, setCopied] = useState(false);

  const diagQuery = useQuery<DiagnosticsResponse>({
    queryKey: bhKeys.diagnostics(service ?? 'svc', workspace ?? ''),
    queryFn: () => fetchDiagnostics(workspace!),
    enabled: Boolean(service && workspace),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  if (!workspace) {
    return <p className="text-text-tertiary text-xs">{tr('尚未选择工作区。', 'No workspace active.')}</p>;
  }

  const jsonString = diagQuery.data ? JSON.stringify(diagQuery.data, null, 2) : '';

  const handleCopy = async () => {
    if (!jsonString) return;
    try {
      await navigator.clipboard.writeText(jsonString);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked in headless test fallback */
    }
  };

  const handleDownload = () => {
    if (!jsonString) return;
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bioharness-diagnostics-${workspace}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div data-testid="bh-settings-diagnostics-panel" className="space-y-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-text-secondary flex items-center gap-1.5">
          <ShieldCheck className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
          <span>
            {tr(
              '仅导出经服务端脱敏的排障快照（绝不含模型 Key、Cookie、访问令牌或绝对私密路径）。',
              'Server-redacted diagnostics only (no model keys, tokens, cookies, or private host paths).',
            )}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="bh-diagnostics-refresh-btn"
            onClick={() => void diagQuery.refetch()}
            className="h-7 gap-1 px-2 text-[11px]"
          >
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
            <span>{tr('刷新', 'Refresh')}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="bh-diagnostics-copy-btn"
            disabled={!jsonString}
            onClick={() => void handleCopy()}
            className="h-7 gap-1 px-2 text-[11px]"
          >
            <Copy className="h-3 w-3" aria-hidden="true" />
            <span>{copied ? tr('已复制', 'Copied') : tr('复制 JSON', 'Copy JSON')}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="bh-diagnostics-download-btn"
            disabled={!jsonString}
            onClick={handleDownload}
            className="h-7 gap-1 px-2 text-[11px]"
          >
            <Download className="h-3 w-3" aria-hidden="true" />
            <span>{tr('下载 JSON', 'Export JSON')}</span>
          </Button>
        </div>
      </div>

      {diagQuery.isLoading ? (
        <div className="flex items-center gap-2 py-3">
          <Spinner className="h-3.5 w-3.5" />
          <span>{tr('正在汇总脱敏诊断报告…', 'Collecting redacted diagnostics…')}</span>
        </div>
      ) : diagQuery.isError ? (
        <div role="alert" className="text-text-destructive text-xs">
          {(diagQuery.error as Error)?.message || tr('诊断导出失败', 'Diagnostics failed')}
        </div>
      ) : diagQuery.data ? (
        <>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {(
              [
                ['provider_keys_server_side_only', tr('模型密钥仅存服务端', 'Server-side model key custody')],
                ['symlink_containment_enforced', tr('路径防逃逸与符号链接限制', 'Symlink & path containment')],
                ['arbitrary_shell_blocked', tr('禁止浏览器任意 Shell 执行', 'Arbitrary browser shell blocked')],
                ['upload_root_configured', tr('受控科研输入 upload_root', 'Restricted upload_root configured')],
              ] as const
            ).map(([k, label]) => {
              const ok = diagQuery.data.security_posture[k];
              return (
                <div
                  key={k}
                  className="border-border-light bg-surface-secondary/25 flex items-center justify-between rounded-lg border px-2.5 py-1.5"
                >
                  <span>{label}</span>
                  {ok ? (
                    <span className="inline-flex items-center gap-1 text-teal-700 dark:text-teal-300">
                      <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                      OK
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                      {tr('未配置', 'Not set')}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <pre
            data-testid="bh-diagnostics-json"
            className="border-border-light bg-surface-secondary/40 max-h-60 overflow-auto rounded-lg border p-2.5 font-mono text-[10px] leading-relaxed"
          >
            {jsonString}
          </pre>
        </>
      ) : null}
    </div>
  );
}
