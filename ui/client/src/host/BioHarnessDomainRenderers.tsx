/**
 * R3.4 reusable domain renderers for BioHarness professional scientific modules
 * (not upstream LibreChat code).
 *
 * Strictly renders verbatim structured payloads from:
 * - Literature (`bioharness-literature` search/fetch)
 * - Statistics (`bioharness-statistics-report-binding` records/tables/render/verify — NEVER recomputes in TS)
 * - Scientific Review (Core `plan_review` / `step.last_review` / `open_concerns` / rework — non-blocking)
 * - Protein Methods (`bioharness-protein-methods` CLI audit outputs)
 */
import React from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Dna,
  ExternalLink,
  FileBarChart2,
  Scale,
  Send,
  ShieldAlert,
} from 'lucide-react';
import { Button } from '@librechat/client';
import type {
  LiteratureInspectResponse,
  LiteraturePaperRecord,
  StatisticsRecord,
  StatisticsReportBindingResponse,
} from './bioharness';
import { useBhText } from './i18n';

function safeExternalUrl(url: unknown): string | null {
  if (typeof url !== 'string' || !url.trim()) return null;
  try {
    const parsed = new URL(url.trim());
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

/* --------------------- 1. Literature Renderer --------------------- */

export function LiteratureDomainCard({
  data,
  onPrevPage,
  onNextPage,
  onStageText,
}: {
  data: Partial<LiteratureInspectResponse> & {
    papers?: LiteraturePaperRecord[];
    entries?: LiteraturePaperRecord[];
  };
  onPrevPage?: () => void;
  onNextPage?: () => void;
  onStageText?: (snippet: string) => void;
}) {
  const { tr } = useBhText();
  const items: LiteraturePaperRecord[] =
    data.items ?? data.papers ?? data.entries ?? [];
  const op = data.operation ?? (data.entries ? 'fetch' : 'search');
  const totalItems = data.total_items ?? items.length;
  const offset = data.offset ?? 0;

  return (
    <section
      data-testid="bh-domain-literature-card"
      className="border-border-light bg-surface-primary space-y-3 rounded-xl border p-4 text-xs"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <BookOpen className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
            <span className="text-text-primary text-sm font-semibold">
              {op === 'fetch'
                ? tr('文献全文获取记录 (ScanSci PDF)', 'Literature Fetch Records')
                : tr('文献检索结果 (KnowledgeSeek)', 'Literature Search Results')}
            </span>
            {data.source && (
              <span className="bg-surface-hover text-text-secondary rounded px-1.5 py-0.5 font-mono text-[10px]">
                source: {data.source}
              </span>
            )}
            {data.coverage && (
              <span
                data-testid="bh-lit-coverage-badge"
                className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] text-amber-800 dark:text-amber-200"
              >
                {data.coverage}
              </span>
            )}
          </div>
          {data.question && (
            <p className="text-text-secondary">
              {tr('检索问题：', 'Question: ')}
              {data.question}
            </p>
          )}
          <div className="text-text-tertiary flex flex-wrap gap-3 text-[11px]">
            {typeof data.reported_total_results === 'number' && (
              <span>
                {tr('上游报告总命中：', 'Reported total: ')}
                <strong>{data.reported_total_results}</strong>
              </span>
            )}
            <span>
              {tr('已返回记录：', 'Returned records: ')}
              <strong>{data.returned_records ?? totalItems}</strong>
            </span>
            {typeof data.downloaded_identifiers === 'number' && (
              <span>
                {tr('已下载 PDF：', 'Downloaded PDFs: ')}
                <strong>
                  {data.downloaded_identifiers}/{data.requested_identifiers ?? totalItems}
                </strong>
              </span>
            )}
            {data.upstream_contract && (
              <span className="font-mono text-[10px]">{data.upstream_contract}</span>
            )}
          </div>
        </div>

        {onStageText && items.length > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="bh-lit-stage-btn"
            onClick={() => {
              const summary = items
                .slice(0, 5)
                .map(
                  (p, i) =>
                    `${offset + i + 1}. ${p.title || p.identifier || 'record'} (${p.year ?? 'n.d.'}) [${p.identifier || p.doi || 'unresolved'}]`,
                )
                .join('\n');
              onStageText(`[Literature ${op}${data.source_file ? ` · ${data.source_file}` : ''}]\n${summary}`);
            }}
            className="h-7 gap-1 px-2 text-[11px]"
          >
            <Send className="h-3 w-3" aria-hidden="true" />
            <span>{tr('引用至草稿', 'Stage citations')}</span>
          </Button>
        )}
      </div>

      {data.validation_scope && (
        <p className="border-border-light bg-surface-secondary/30 text-text-tertiary rounded-lg border px-2.5 py-1.5 text-[11px]">
          {data.validation_scope}
        </p>
      )}

      {items.length === 0 ? (
        <p className="text-text-tertiary">{tr('无文献条目记录。', 'No literature entries recorded.')}</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, idx) => {
            const href = safeExternalUrl(item.url) || safeExternalUrl(item.pdf_url);
            const authorsText = Array.isArray(item.authors)
              ? item.authors.join(', ')
              : typeof item.authors === 'string'
                ? item.authors
                : '';
            const ident = item.identifier || item.doi || null;
            return (
              <article
                key={`${ident ?? 'rec'}-${offset + idx}`}
                data-testid={`bh-lit-item-${offset + idx}`}
                className="border-border-light bg-surface-secondary/20 space-y-1 rounded-lg border p-2.5"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-text-primary font-medium">
                      {typeof item.rank === 'number' && (
                        <span className="text-text-tertiary mr-1.5 font-mono">#{item.rank}</span>
                      )}
                      {item.title || ident || tr('未命名记录', 'Untitled record')}
                    </div>
                    {(authorsText || item.venue || item.year) && (
                      <div className="text-text-tertiary mt-0.5 text-[11px]">
                        {[authorsText, item.venue, item.year].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-1">
                    {ident ? (
                      <span className="rounded bg-teal-500/15 px-1.5 py-0.5 font-mono text-[10px] text-teal-700 dark:text-teal-300">
                        {ident}
                      </span>
                    ) : (
                      <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-800 dark:text-amber-200">
                        {item.identifier_status || tr('无唯一标识符', 'unresolved')}
                      </span>
                    )}
                    {item.status && (
                      <span className="bg-surface-hover text-text-secondary rounded px-1.5 py-0.5 font-mono text-[10px]">
                        {item.status}
                      </span>
                    )}
                    {href && (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 text-[11px] text-teal-700 hover:underline dark:text-teal-300"
                      >
                        <span>{tr('来源', 'Link')}</span>
                        <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                </div>

                {item.abstract && (
                  <p className="text-text-secondary line-clamp-3 text-[11px] leading-relaxed">
                    {item.abstract}
                  </p>
                )}
                {item.sha256 && (
                  <div className="text-text-tertiary font-mono text-[10px] break-all">
                    PDF sha256:{item.sha256} {item.bytes ? `(${item.bytes} B)` : ''}
                  </div>
                )}
                {item.reason && (
                  <div className="text-amber-700 dark:text-amber-300 text-[11px]">
                    {tr('说明：', 'Reason: ')}
                    {item.reason}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {(onPrevPage || onNextPage) && totalItems > 0 && (
        <div className="border-border-light flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-[11px]">
          <span className="text-text-tertiary" data-testid="bh-lit-page-info">
            {tr(
              `显示第 ${offset + 1}–${offset + items.length} 条，共 ${totalItems} 条本地记录${
                typeof data.reported_total_results === 'number' && data.reported_total_results > totalItems
                  ? `（上游总计 ${data.reported_total_results} 条，属截断子集）`
                  : ''
              }`,
              `Showing ${offset + 1}–${offset + items.length} of ${totalItems} returned records`,
            )}
          </span>
          <div className="flex gap-1.5">
            {onPrevPage && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="bh-lit-prev-btn"
                disabled={offset <= 0}
                onClick={onPrevPage}
                className="h-7 px-2 text-[11px]"
              >
                {tr('上一页', 'Prev')}
              </Button>
            )}
            {onNextPage && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="bh-lit-next-btn"
                disabled={!data.has_more}
                onClick={onNextPage}
                className="h-7 px-2 text-[11px]"
              >
                {tr('下一页', 'Next')}
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

/* --------------------- 2. Statistics Renderer --------------------- */

function formatRawCI(rec: StatisticsRecord): string {
  const low = rec.ci_low ?? rec.ci?.[0] ?? rec.CI?.[0];
  const high = rec.ci_high ?? rec.ci?.[1] ?? rec.CI?.[1];
  if (low === undefined || high === undefined) return '—';
  const lvl = typeof rec.ci_level === 'number' ? `${Math.round(rec.ci_level * 100)}% ` : '';
  return `${lvl}[${low}, ${high}]`;
}

export function StatisticsDomainCard({
  data,
  onStageText,
}: {
  data: Partial<StatisticsReportBindingResponse> & { records?: StatisticsRecord[] };
  onStageText?: (snippet: string) => void;
}) {
  const { tr } = useBhText();
  const records = data.records ?? [];
  const passed = data.status === 'PASS';
  const failed = data.status === 'FAIL';

  return (
    <section
      data-testid="bh-domain-statistics-card"
      className="border-border-light bg-surface-primary space-y-3 rounded-xl border p-4 text-xs"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <FileBarChart2 className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
            <span className="text-text-primary text-sm font-semibold">
              {tr('统计结果与确定性报告绑定 (report_binding)', 'Statistics & Deterministic Report Binding')}
            </span>
            {data.status && (
              <span
                data-testid="bh-stat-status-badge"
                className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] font-semibold ${
                  passed
                    ? 'bg-teal-500/15 text-teal-700 dark:text-teal-300'
                    : failed
                      ? 'bg-red-500/15 text-red-700 dark:text-red-300'
                      : 'bg-surface-hover text-text-secondary'
                }`}
              >
                {passed ? <CheckCircle2 className="h-3 w-3" /> : failed ? <AlertTriangle className="h-3 w-3" /> : null}
                {data.status}
              </span>
            )}
          </div>
          {data.note && <p className="text-text-tertiary text-[11px]">{data.note}</p>}
        </div>

        {onStageText && (data.rendered_markdown || records.length > 0) && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="bh-stat-stage-btn"
            onClick={() =>
              onStageText(
                `[Statistics ${data.action ?? 'inspect'} · ${data.status ?? ''}]\n${
                  data.rendered_markdown ??
                  records.map((r) => `${r.metric_id}: ${r.value} (${r.method ?? ''})`).join('\n')
                }`,
              )
            }
            className="h-7 gap-1 px-2 text-[11px]"
          >
            <Send className="h-3 w-3" aria-hidden="true" />
            <span>{tr('引用至草稿', 'Stage result')}</span>
          </Button>
        )}
      </div>

      {data.error && (
        <div
          role="alert"
          data-testid="bh-stat-binding-error"
          className="rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-red-800 dark:text-red-200"
        >
          <strong>[{data.error.code}]</strong> {data.error.message}
        </div>
      )}

      {data.binding && (
        <div className="border-border-light bg-surface-secondary/30 flex flex-wrap gap-3 rounded-lg border px-3 py-2 font-mono text-[11px]">
          <span>action={data.binding.action}</span>
          <span>bound_statements={data.binding.bound_statements ?? 0}</span>
          <span>bound_tables={data.binding.bound_tables ?? 0}</span>
          {data.binding.report_sha256 && (
            <span className="break-all">sha256={data.binding.report_sha256.slice(0, 16)}…</span>
          )}
        </div>
      )}

      {records.length > 0 && (
        <div className="overflow-x-auto">
          <table className="border-border-light w-full border-collapse text-left text-[11px]">
            <thead>
              <tr className="border-border-light bg-surface-secondary/40 text-text-tertiary border-b">
                <th className="px-2 py-1.5 font-medium">{tr('指标 / 单位', 'Metric / Unit')}</th>
                <th className="px-2 py-1.5 font-medium">{tr('人群 / 分组 (Given · Event)', 'Population / Stratum')}</th>
                <th className="px-2 py-1.5 font-medium">{tr('分子 / 分母', 'Num / Den')}</th>
                <th className="px-2 py-1.5 font-medium">{tr('数值与区间', 'Value & CI')}</th>
                <th className="px-2 py-1.5 font-medium">{tr('p 值 / 多重校正', 'p / FDR')}</th>
                <th className="px-2 py-1.5 font-medium">{tr('方法 / 模型', 'Method')}</th>
              </tr>
            </thead>
            <tbody>
              {records.map((rec) => {
                const fdrVal = rec.fdr ?? rec.p_adjusted ?? rec.q_value;
                return (
                  <tr
                    key={rec.metric_id}
                    data-testid={`bh-stat-row-${rec.metric_id}`}
                    className="border-border-light border-b last:border-b-0"
                  >
                    <td className="px-2 py-1.5 align-top font-mono">
                      <div className="text-text-primary font-semibold">{rec.metric_id}</div>
                      <div className="text-text-tertiary text-[10px]">
                        {rec.unit || rec.kind || '—'}
                        {rec.status ? ` · ${rec.status}` : ''}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      <div>{rec.population || '—'}</div>
                      <div className="text-text-tertiary text-[10px]">{rec.stratum || '—'}</div>
                    </td>
                    <td className="px-2 py-1.5 align-top font-mono">
                      {rec.numerator !== undefined && rec.denominator !== undefined
                        ? `${rec.numerator} / ${rec.denominator}`
                        : '—'}
                    </td>
                    <td className="px-2 py-1.5 align-top font-mono">
                      <div className="text-text-primary font-semibold">{String(rec.value ?? '—')}</div>
                      <div className="text-text-tertiary text-[10px]">{formatRawCI(rec)}</div>
                    </td>
                    <td className="px-2 py-1.5 align-top font-mono">
                      <div>{rec.p_value !== undefined ? `p=${rec.p_value}` : '—'}</div>
                      {fdrVal !== undefined && (
                        <div className="text-text-tertiary text-[10px]">FDR={String(fdrVal)}</div>
                      )}
                    </td>
                    <td className="px-2 py-1.5 align-top text-text-secondary">{rec.method || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {data.rendered_markdown && (
        <div className="space-y-1">
          <div className="text-text-tertiary text-[11px] font-medium">
            {tr('模块确定性渲染报告 (report_binding 输出)', 'Deterministic Rendered Report')}
          </div>
          <pre
            data-testid="bh-stat-rendered-md"
            className="border-border-light bg-surface-secondary/30 max-h-60 overflow-auto rounded-lg border p-2.5 font-mono text-[11px] whitespace-pre-wrap"
          >
            {data.rendered_markdown}
          </pre>
        </div>
      )}
    </section>
  );
}

/* --------------------- 3. Scientific Review Renderer --------------------- */

function parseConcernParts(raw: string): { issue: string; basis?: string; impact?: string } {
  const parts = raw.split(' | ');
  if (parts.length === 1) return { issue: raw };
  let basis: string | undefined;
  let impact: string | undefined;
  const issue = parts[0];
  for (const p of parts.slice(1)) {
    if (p.startsWith('Basis:')) basis = p.slice(6).trim();
    else if (p.startsWith('Scientific impact:')) impact = p.slice(18).trim();
  }
  return { issue, basis, impact };
}

const VERDICT_STYLE: Record<string, string> = {
  SUPPORTED: 'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  SUPPORTED_WITH_LIMITATIONS: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  CONCERNS: 'bg-amber-500/15 text-amber-800 dark:text-amber-200',
  NOT_SUPPORTED: 'bg-red-500/15 text-red-700 dark:text-red-300',
  UNCLASSIFIED: 'bg-surface-hover text-text-secondary',
};

export function ScientificReviewCard({
  title,
  advice,
  reviewLabel,
  openConcerns,
  attempts,
  previousAttempt,
  versionNote,
}: {
  title: string;
  advice?: Record<string, unknown> | null;
  reviewLabel?: string | null;
  openConcerns?: Array<{ about: string; concern: string }>;
  attempts?: number;
  previousAttempt?: { status?: string; summary?: string };
  versionNote?: string;
}) {
  const { tr } = useBhText();
  const verdict = typeof advice?.verdict === 'string' ? advice.verdict : null;
  const summary = typeof advice?.summary === 'string' ? advice.summary : null;
  const concerns = Array.isArray(advice?.concerns) ? advice.concerns.map(String) : [];
  const suggestions = Array.isArray(advice?.suggestions) ? advice.suggestions.map(String) : [];
  const advisorId = typeof advice?.advisor_id === 'string' ? advice.advisor_id : null;

  return (
    <section
      data-testid="bh-domain-review-card"
      className="border-border-light bg-surface-primary/80 space-y-2.5 rounded-xl border p-3.5 text-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Scale className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
          <span className="text-text-primary font-semibold">{title}</span>
          {verdict && (
            <span
              data-testid="bh-review-verdict"
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                VERDICT_STYLE[verdict] ?? 'bg-surface-hover text-text-secondary'
              }`}
            >
              {verdict}
            </span>
          )}
          {advisorId && (
            <span className="text-text-tertiary font-mono text-[10px]">{advisorId}</span>
          )}
        </div>
        <span className="text-text-tertiary text-[10px]">
          {tr('咨询意见 · 不自动阻断科研主线', 'Advisory only · Non-blocking')}
          {typeof attempts === 'number' && attempts > 0
            ? ` · ${tr(`尝试次数 ${attempts}`, `Attempts ${attempts}`)}`
            : ''}
        </span>
      </div>

      {reviewLabel && !summary && (
        <p className="text-text-primary whitespace-pre-wrap">{reviewLabel}</p>
      )}
      {summary && <p className="text-text-primary whitespace-pre-wrap leading-relaxed">{summary}</p>}

      {concerns.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-text-tertiary text-[11px] font-medium">
            {tr('审查关切与依据', 'Substantive Concerns & Basis')}
          </div>
          {concerns.map((raw, idx) => {
            const parsed = parseConcernParts(raw);
            return (
              <div
                key={idx}
                className="border-border-light bg-surface-secondary/30 space-y-0.5 rounded-lg border p-2"
              >
                <div className="text-text-primary font-medium">{parsed.issue}</div>
                {parsed.basis && (
                  <div className="text-text-secondary text-[11px]">
                    <strong>{tr('依据：', 'Basis: ')}</strong>
                    {parsed.basis}
                  </div>
                )}
                {parsed.impact && (
                  <div className="text-text-tertiary text-[11px]">
                    <strong>{tr('科学影响：', 'Impact: ')}</strong>
                    {parsed.impact}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {openConcerns && openConcerns.length > 0 && (
        <div className="space-y-1">
          <div className="text-text-tertiary text-[11px] font-medium">
            {tr('当前未关闭分歧 / 关注点', 'Open Concerns / Disagreements')}
          </div>
          <ul className="space-y-1">
            {openConcerns.map((c, idx) => (
              <li key={`${c.about}-${idx}`} className="text-text-secondary">
                <code className="bg-surface-hover mr-1 rounded px-1 py-0.5 font-mono text-[10px]">
                  {c.about}
                </code>
                {c.concern}
              </li>
            ))}
          </ul>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="space-y-1">
          <div className="text-text-tertiary text-[11px] font-medium">{tr('改进建议', 'Suggestions')}</div>
          <ul className="text-text-secondary list-disc space-y-0.5 pl-4">
            {suggestions.map((s, idx) => (
              <li key={idx}>{s}</li>
            ))}
          </ul>
        </div>
      )}

      {previousAttempt && (
        <div className="border-border-light bg-surface-secondary/20 rounded-lg border p-2 text-[11px]">
          <span className="font-medium">
            {tr('修订前上一轮记录：', 'Previous attempt before rework: ')}
          </span>
          <span className="font-mono">{previousAttempt.status}</span>
          {previousAttempt.summary ? ` — ${previousAttempt.summary}` : ''}
        </div>
      )}

      {versionNote && (
        <div className="flex items-start gap-1.5 text-[11px] text-amber-800 dark:text-amber-200">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{versionNote}</span>
        </div>
      )}
    </section>
  );
}

/* --------------------- 4. Protein Methods Renderer --------------------- */

export function ProteinMethodsDomainCard({
  operation,
  result,
  inputFile,
  onStageText,
}: {
  operation: string;
  result: Record<string, unknown>;
  inputFile?: string;
  onStageText?: (snippet: string) => void;
}) {
  const { tr } = useBhText();
  const status = String(result.status ?? 'unknown');
  const modVer = typeof result.module_version === 'string' ? result.module_version : null;
  const residues = Array.isArray(result.residues)
    ? (result.residues as Array<Record<string, unknown>>)
    : [];
  const warnings = Array.isArray(result.parser_warnings) ? result.parser_warnings.map(String) : [];
  const limitations = Array.isArray(result.limitations) ? result.limitations.map(String) : [];

  return (
    <section
      data-testid="bh-domain-protein-card"
      className="border-border-light bg-surface-primary space-y-3 rounded-xl border p-4 text-xs"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <Dna className="h-4 w-4 text-teal-600 dark:text-teal-400" aria-hidden="true" />
          <span className="text-text-primary text-sm font-semibold">
            Protein Methods · <code className="font-mono">{operation}</code>
          </span>
          <span className="rounded bg-teal-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-teal-700 dark:text-teal-300">
            {status}
          </span>
          {modVer && (
            <span className="bg-surface-hover text-text-tertiary rounded px-1.5 py-0.5 font-mono text-[10px]">
              v{modVer}
            </span>
          )}
          {inputFile && <span className="text-text-tertiary font-mono text-[10px]">{inputFile}</span>}
        </div>
        {onStageText && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onStageText(`[Protein Methods ${operation}${inputFile ? ` · ${inputFile}` : ''}]\n${JSON.stringify(result, null, 2)}`)
            }
            className="h-7 gap-1 px-2 text-[11px]"
          >
            <Send className="h-3 w-3" aria-hidden="true" />
            <span>{tr('引用至草稿', 'Stage output')}</span>
          </Button>
        )}
      </div>

      {operation === 'structure-inventory' && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="border-border-light bg-surface-secondary/30 rounded-lg border p-2">
            <div className="text-text-tertiary text-[10px]">{tr('结构格式', 'Format')}</div>
            <div className="font-mono font-semibold">{String(result.format ?? '—')}</div>
          </div>
          <div className="border-border-light bg-surface-secondary/30 rounded-lg border p-2">
            <div className="text-text-tertiary text-[10px]">{tr('蛋白残基数', 'Protein Residues')}</div>
            <div className="font-mono font-semibold" data-testid="bh-protein-residue-count">
              {String(result.protein_residue_count ?? '—')}
            </div>
          </div>
          <div className="border-border-light bg-surface-secondary/30 rounded-lg border p-2">
            <div className="text-text-tertiary text-[10px]">{tr('明确原子数', 'Unambiguous Atoms')}</div>
            <div className="font-mono font-semibold" data-testid="bh-protein-atom-count">
              {String(result.unambiguous_atom_count ?? '—')}
            </div>
          </div>
          <div className="border-border-light bg-surface-secondary/30 rounded-lg border p-2">
            <div className="text-text-tertiary text-[10px]">{tr('坐标单位 / 模型', 'Units / Models')}</div>
            <div className="font-mono font-semibold">
              {String(result.coordinate_units ?? '—')} · {String(result.model_count ?? 1)}
            </div>
          </div>
        </div>
      )}

      {residues.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {residues.slice(0, 24).map((res, i) => (
            <span
              key={i}
              className="border-border-light bg-surface-secondary/20 rounded border px-1.5 py-0.5 font-mono text-[10px]"
            >
              {String(res.chain ?? '')}:{String(res.residue_name ?? '')}
              {String(res.residue_number ?? '')} ({String(res.unambiguous_atom_count ?? 0)} atoms)
            </span>
          ))}
          {residues.length > 24 && (
            <span className="text-text-tertiary text-[10px]">+{residues.length - 24} more</span>
          )}
        </div>
      )}

      {warnings.length > 0 && (
        <div className="text-amber-700 dark:text-amber-300 text-[11px]">
          <strong>{tr('解析提示：', 'Parser warnings: ')}</strong>
          {warnings.join('; ')}
        </div>
      )}

      {limitations.length > 0 && (
        <ul className="text-text-tertiary list-disc space-y-0.5 pl-4 text-[11px]">
          {limitations.map((lim, i) => (
            <li key={i}>{lim}</li>
          ))}
        </ul>
      )}

      {operation !== 'structure-inventory' && (
        <pre className="border-border-light bg-surface-secondary/30 max-h-60 overflow-auto rounded-lg border p-2.5 font-mono text-[11px]">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </section>
  );
}

/* --------------------- 5. Execution Inspector Auto-Detector --------------------- */

export function ObservedDomainOutputBanner({
  output,
  name,
  server,
}: {
  output: unknown;
  name?: string;
  server?: string | null;
}) {
  const { tr } = useBhText();
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    return null;
  }
  const obj = output as Record<string, unknown>;
  if (obj.omitted === true) {
    return null;
  }
  // Unwrap MCP structured_content when present
  const payload =
    obj.structured_content && typeof obj.structured_content === 'object'
      ? (obj.structured_content as Record<string, unknown>)
      : obj;

  if (
    (payload.operation === 'search' && Array.isArray(payload.papers)) ||
    (payload.operation === 'fetch' && Array.isArray(payload.entries))
  ) {
    return (
      <LiteratureDomainCard
        data={payload as Partial<LiteratureInspectResponse> & { papers?: LiteraturePaperRecord[] }}
      />
    );
  }
  if (Array.isArray(payload.records) || typeof payload.bound_statements === 'number') {
    return (
      <StatisticsDomainCard
        data={payload as Partial<StatisticsReportBindingResponse> & { records?: StatisticsRecord[] }}
      />
    );
  }
  if (
    typeof payload.verdict === 'string' &&
    (typeof payload.summary === 'string' || Array.isArray(payload.concerns))
  ) {
    return (
      <ScientificReviewCard
        title={tr(`观察到的科学审查输出 (${name ?? server ?? 'advisor'})`, `Observed Scientific Review (${name ?? 'advisor'})`)}
        advice={payload}
      />
    );
  }
  if (
    typeof payload.module_version === 'string' &&
    typeof payload.operation === 'string' &&
    typeof payload.status === 'string'
  ) {
    return <ProteinMethodsDomainCard operation={payload.operation} result={payload} />;
  }
  return null;
}
