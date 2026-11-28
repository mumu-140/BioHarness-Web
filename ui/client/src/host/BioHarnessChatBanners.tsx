/**
 * BioHarness Core domain notices and reconciliation controls rendered above the chat thread
 * (not upstream LibreChat code).
 */
import React, { memo, useCallback, useState } from 'react';
import { AlertTriangle, Check, Copy, GitBranch, HelpCircle, Link2, RefreshCw } from 'lucide-react';
import { Button } from '@librechat/client';
import type { ConversationStateResponse, NowData, TreeScopeNode } from './bioharness';
import type { BranchSourceRef } from './workspace';
import { useBhText } from './i18n';

export interface BioHarnessChatBannersProps {
  problem: string | null;
  onDismissProblem: () => void;
  stateError: string | null;
  needsExplicitRequestStart: boolean;
  selectedRequestId: string | null;
  runtimeEnabled: boolean;
  isActing: boolean;
  onStartRequestConversation: () => void;
  stateData: ConversationStateResponse | undefined;
  beginReconcile: string | null;
  onAttachRequest: (requestId: string) => void;
  nowData: NowData | null;
  activeRunId: string | null;
  onInsertIntoDraft: (snippet: string) => void;
  onBranchFromDelivered: (source: BranchSourceRef) => void;
  isNew: boolean;
  branchSource: BranchSourceRef | null;
  onClearBranchSource: () => void;
  scopes: TreeScopeNode[];
  scopeMode: 'none' | 'existing' | 'new';
  onScopeModeChange: (mode: 'none' | 'existing' | 'new') => void;
  selectedScopeId: string;
  onSelectedScopeIdChange: (id: string) => void;
  newScopeId: string;
  onNewScopeIdChange: (id: string) => void;
  parentScopeId?: string;
  onParentScopeIdChange?: (id: string) => void;
  scopeProblem: string | null;
}

const BioHarnessChatBanners = memo(function BioHarnessChatBanners({
  problem,
  onDismissProblem,
  stateError,
  needsExplicitRequestStart,
  selectedRequestId,
  runtimeEnabled,
  isActing,
  onStartRequestConversation,
  stateData,
  beginReconcile,
  onAttachRequest,
  nowData,
  activeRunId,
  onInsertIntoDraft,
  onBranchFromDelivered,
  isNew,
  branchSource,
  onClearBranchSource,
  scopes,
  scopeMode,
  onScopeModeChange,
  selectedScopeId,
  onSelectedScopeIdChange,
  newScopeId,
  onNewScopeIdChange,
  parentScopeId = '',
  onParentScopeIdChange,
  scopeProblem,
}: BioHarnessChatBannersProps) {
  const { tr } = useBhText();
  const [manualAttachId, setManualAttachId] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyConfirmationPhrase = useCallback(async (amendmentId: string) => {
    const phrase = `确认主线 ${amendmentId}`;
    try {
      await navigator.clipboard.writeText(phrase);
      setCopiedId(amendmentId);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      /* fallback: user can still use onInsertIntoDraft */
    }
  }, []);

  const amendment = nowData?.mainline_amendment_pending ?? null;
  const waitingForUser =
    nowData?.action === 'WAIT_FOR_USER' || Boolean(nowData?.waiting_for_user);
  const revisingPlan = nowData?.action === 'REVISE_PLAN';
  const isDelivered = nowData?.phase === 'DELIVERED';
  const isUnknownBegin = beginReconcile !== null;
  const requestScope =
    typeof nowData?.scope_context?.scope_id === 'string' ? nowData.scope_context.scope_id : null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-2 px-3 pt-2 text-xs">
      {problem && (
        <div
          role="alert"
          data-testid="bh-error-banner"
          className="border-status-error-border bg-status-error-subtle text-text-primary flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
        >
          <span>{problem}</span>
          <button
            type="button"
            onClick={onDismissProblem}
            className="text-text-secondary hover:text-text-primary underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {stateError && (
        <div
          role="alert"
          data-testid="bh-convo-state-error"
          className="border-status-error-border bg-status-error-subtle text-text-primary rounded-lg border px-3 py-2"
        >
          {stateError}
        </div>
      )}

      {needsExplicitRequestStart && selectedRequestId && (
        <div
          data-testid="bh-start-request-card"
          className="border-border-medium bg-surface-primary flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3"
        >
          <div>
            <p className="text-text-primary font-medium">
              Open request <code className="font-mono">{selectedRequestId}</code> has no conversation yet.
            </p>
            <p className="text-text-secondary mt-0.5">
              Explicitly start a conversation bound to this request before sending messages.
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            data-testid="bh-start-request-convo-btn"
            disabled={!runtimeEnabled || isActing}
            onClick={onStartRequestConversation}
            className="gap-1.5"
          >
            <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Start conversation for request</span>
          </Button>
        </div>
      )}

      {isUnknownBegin && stateData && (
        <div
          data-testid="bh-reconcile-card"
          role="alert"
          className="rounded-xl border border-amber-400/70 bg-amber-50/90 p-3 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
        >
          <div className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {beginReconcile === 'OUTCOME_UNKNOWN'
                ? 'science_begin outcome is UNKNOWN — not replayed automatically'
                : 'Core returned an existing open request — explicit binding required'}
            </span>
          </div>
          <p className="mt-1 opacity-90">
            Attach the matching request explicitly below instead of re-submitting the original question.
          </p>

          {stateData.begin_candidates.length > 0 && (
            <ul className="mt-2 space-y-1.5" data-testid="bh-reconcile-candidates">
              {stateData.begin_candidates.map((cand) => (
                <li
                  key={cand.request_id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300/70 bg-white/80 px-2.5 py-1.5 dark:bg-black/20"
                >
                  <div className="min-w-0">
                    <div className="font-mono font-medium">
                      {cand.request_id}{' '}
                      <span className="font-sans text-[11px] opacity-75">
                        ({cand.question_match})
                      </span>
                    </div>
                    {(cand.question || cand.original_task_text) && (
                      <div className="truncate opacity-80">
                        {cand.question || cand.original_task_text}
                      </div>
                    )}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    data-testid={`bh-attach-candidate-${cand.request_id}`}
                    disabled={isActing}
                    onClick={() => onAttachRequest(cand.request_id)}
                  >
                    Attach request
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {stateData.open_listing?.may_be_incomplete && (
            <p className="mt-2 text-[11px] opacity-80">
              Note: Core listed {stateData.open_listing.listed} open requests; the target
              request may not appear above.
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={manualAttachId}
              onChange={(e) => setManualAttachId(e.target.value)}
              placeholder="Or enter exact request_id…"
              aria-label="Manual request ID to attach"
              data-testid="bh-attach-manual-input"
              className="border-border-medium bg-surface-primary text-text-primary min-w-[200px] flex-1 rounded-md border px-2.5 py-1 font-mono text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid="bh-attach-manual-btn"
              disabled={isActing || !manualAttachId.trim()}
              onClick={() => {
                onAttachRequest(manualAttachId);
                setManualAttachId('');
              }}
            >
              Attach ID
            </Button>
          </div>
        </div>
      )}

      {(amendment || waitingForUser || revisingPlan || isDelivered) && (
        <div className="space-y-2" data-testid="bh-hitl-banner" aria-label="HITL notices">
          {amendment && (
            <div
              data-testid="bh-hitl-amendment"
              className="rounded-xl border border-amber-400/70 bg-amber-50/90 p-3 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  Mainline amendment pending confirmation ({amendment.id})
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    data-testid="bh-copy-amendment-btn"
                    onClick={() => void copyConfirmationPhrase(amendment.id)}
                    className="inline-flex items-center gap-1 rounded-md border border-amber-400 bg-white/90 px-2 py-0.5 text-[11px] font-medium text-amber-950 hover:bg-amber-100"
                  >
                    {copiedId === amendment.id ? (
                      <>
                        <Check className="h-3 w-3" aria-hidden="true" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" aria-hidden="true" />
                        Copy 确认主线 {amendment.id}
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    data-testid="bh-stage-amendment-btn"
                    onClick={() => onInsertIntoDraft(`确认主线 ${amendment.id}`)}
                    className="inline-flex items-center gap-1 rounded-md border border-amber-400 bg-white/90 px-2 py-0.5 text-[11px] font-medium text-amber-950 hover:bg-amber-100"
                  >
                    Stage in composer
                  </button>
                </div>
              </div>
              <p className="mt-1">
                <strong>Reason:</strong> {amendment.reason}
              </p>
              <p className="mt-0.5 text-[11px] opacity-85">
                Only your deliberate submission of <code>确认主线 {amendment.id}</code> confirms
                this amendment via Core&apos;s trusted native-user path. The workbench never
                auto-confirms.
              </p>
            </div>
          )}

          {waitingForUser && (
            <div
              data-testid="bh-hitl-waiting"
              className="rounded-xl border border-blue-300/70 bg-blue-50/80 p-3 text-blue-950 dark:bg-blue-950/40 dark:text-blue-100"
            >
              <div className="flex items-center gap-1.5 font-semibold">
                <HelpCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                Core is waiting for your input (WAIT_FOR_USER)
              </div>
              {nowData?.waiting_for_user?.question && (
                <p className="mt-1">{nowData.waiting_for_user.question}</p>
              )}
            </div>
          )}

          {revisingPlan && (
            <div
              data-testid="bh-hitl-revising"
              className="border-border-medium bg-surface-primary rounded-xl border p-3"
            >
              <div className="text-text-primary flex items-center gap-1.5 font-semibold">
                <RefreshCw className="h-4 w-4 shrink-0" aria-hidden="true" />
                Core requests plan revision (REVISE_PLAN)
              </div>
              <p className="text-text-secondary mt-1">
                Send guidance below or click &ldquo;Continue from Core&rdquo; to realign steps.
              </p>
            </div>
          )}

          {isDelivered && nowData && (
            <div
              data-testid="bh-hitl-delivered"
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-teal-400/60 bg-teal-50/70 p-3 text-teal-950 dark:bg-teal-950/40 dark:text-teal-100"
            >
              <span>
                Request <code className="font-mono">{nowData.request_id}</code> is delivered (
                {nowData.delivery_kind ?? 'DELIVERED'}).
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-testid="bh-branch-delivered-btn"
                disabled={activeRunId !== null}
                onClick={() =>
                  onBranchFromDelivered({ requestId: nowData.request_id, scopeId: requestScope })
                }
                className="gap-1.5 text-xs"
              >
                <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
                <span>New question from this route</span>
              </Button>
            </div>
          )}
        </div>
      )}

      {isNew && !selectedRequestId && branchSource && (
        <div
          data-testid="bh-branch-banner"
          className="border-border-medium bg-surface-primary flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2"
        >
          <span className="text-text-secondary">
            Starting follow-up from delivered request{' '}
            <code className="text-text-primary font-mono">{branchSource.requestId}</code>.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onInsertIntoDraft(`参考历史请求 ${branchSource.requestId}：`)}
              className="text-text-primary underline"
            >
              Insert reference into draft
            </button>
            <button
              type="button"
              onClick={onClearBranchSource}
              className="text-text-tertiary hover:text-text-primary"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {isNew && !selectedRequestId && runtimeEnabled && (
        <fieldset
          data-testid="bh-scope-selector"
          className="border-border-light bg-surface-primary/60 space-y-2 rounded-xl border px-3 py-2.5 text-xs"
        >
          <legend className="text-text-tertiary px-1 text-[11px] font-medium">
            {tr('科研项目归属（随首条真实科学问题建立或关联）', 'Research project / scope for new request')}
          </legend>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-text-primary inline-flex items-center gap-1.5">
              <input
                type="radio"
                name="bh-scope-mode"
                checked={scopeMode === 'none'}
                onChange={() => onScopeModeChange('none')}
              />
              <span>{tr('独立问题（不归入项目）', 'Unscoped request')}</span>
            </label>
            {scopes.length > 0 && (
              <label className="text-text-primary inline-flex items-center gap-1.5">
                <input
                  type="radio"
                  name="bh-scope-mode"
                  checked={scopeMode === 'existing'}
                  onChange={() => {
                    onScopeModeChange('existing');
                    if (!selectedScopeId && scopes[0]) {
                      onSelectedScopeIdChange(scopes[0].scope_id);
                    }
                  }}
                />
                <span>{tr('已有项目/子项目：', 'Existing project:')}</span>
                <select
                  aria-label={tr('已有项目', 'Existing scope')}
                  data-testid="bh-existing-scope-select"
                  disabled={scopeMode !== 'existing'}
                  value={selectedScopeId}
                  onChange={(e) => onSelectedScopeIdChange(e.target.value)}
                  className="border-border-medium bg-surface-primary max-w-[200px] rounded border px-1.5 py-0.5 font-mono text-xs disabled:opacity-50"
                >
                  {scopes.map((s) => (
                    <option key={s.scope_id} value={s.scope_id}>
                      {s.path && s.path.length > 1 ? s.path.join(' / ') : s.scope_id}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="text-text-primary inline-flex items-center gap-1.5">
              <input
                type="radio"
                name="bh-scope-mode"
                checked={scopeMode === 'new'}
                onChange={() => onScopeModeChange('new')}
              />
              <span>{parentScopeId ? tr('新建子项目：', 'New sub-project:') : tr('新建项目：', 'New project:')}</span>
              <input
                type="text"
                aria-label={tr('新项目或子项目标识', 'New scope ID')}
                data-testid="bh-new-scope-input"
                disabled={scopeMode !== 'new'}
                value={newScopeId}
                onChange={(e) => onNewScopeIdChange(e.target.value)}
                placeholder={parentScopeId ? tr('如 transcriptome', 'e.g. transcriptome') : tr('如 PPGR', 'e.g. PPGR')}
                className="border-border-medium bg-surface-primary w-36 rounded border px-1.5 py-0.5 font-mono text-xs disabled:opacity-50"
              />
            </label>
          </div>
          {scopeMode === 'new' && (
            <div className="border-border-light flex flex-wrap items-center gap-2 border-t pt-2 text-[11px]">
              {scopes.length > 0 && onParentScopeIdChange && (
                <label className="text-text-secondary inline-flex items-center gap-1.5">
                  <span>{tr('上级项目（可选，留空为根项目）：', 'Parent project (optional):')}</span>
                  <select
                    aria-label={tr('上级项目', 'Parent scope')}
                    data-testid="bh-parent-scope-select"
                    value={parentScopeId}
                    onChange={(e) => onParentScopeIdChange(e.target.value)}
                    className="border-border-medium bg-surface-primary max-w-[220px] rounded border px-1.5 py-0.5 font-mono text-[11px]"
                  >
                    <option value="">{tr('无（创建为根项目）', 'None (root project)')}</option>
                    {scopes.map((s) => (
                      <option key={s.scope_id} value={s.scope_id}>
                        {s.path && s.path.length > 1 ? s.path.join(' / ') : s.scope_id}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <span className="text-text-tertiary">
                {parentScopeId
                  ? tr(
                      `归属路径：${parentScopeId} / ${newScopeId.trim() || '〈子项目〉'} · Core 将以您下方输入的真实首条科学问题建立该子项目。`,
                      `Path: ${parentScopeId} / ${newScopeId.trim() || '<sub-project>'} · Core creates this sub-project on your first real scientific question below.`,
                    )
                  : tr(
                      'Core 以真实首条科学问题声明科研项目，不创建空占位项目。',
                      'Core declares a project from your first real scientific question — no empty placeholder projects.',
                    )}
              </span>
            </div>
          )}
          {scopeProblem && (
            <span className="text-text-destructive block text-[11px]" role="alert">
              {scopeProblem}
            </span>
          )}
        </fieldset>
      )}
    </div>
  );
});

export default BioHarnessChatBanners;
