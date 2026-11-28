/**
 * Research workflow & step detail view seated inside LibreChat's adopted shell
 * (not upstream LibreChat code).
 *
 * One primary content area per view:
 * - Plan overview: React Flow + Dagre directed DAG canvas OR dependency-labelled list view
 *   (list defaults on narrow viewports; optional fullscreen graph on desktop).
 * - Step detail subpage: replaces plan canvas, with "Back to plan" (restores previous selection)
 *   and "Discuss this step" (stages visible editable reference in bound conversation without auto-sending).
 */
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  FileText,
  GitFork,
  List,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  RefreshCw,
} from 'lucide-react';
import { Button, Spinner, useMediaQuery } from '@librechat/client';
import type { ContextData, NowData, Snapshot, WorkspaceConversation } from './bioharness';
import { bhKeys, fetchConversations, fetchView } from './bioharness';
import { useBioHarnessVersionStream } from './events';
import { isCurrentPlanAttempt, matchesSnapshot, resolveBoundConversation, useScientificRoutePages } from './scientificViews';
import { useBioHarnessWorkspace } from './workspace';
import { formatPhaseLabel, useBhText } from './i18n';
import BioHarnessRequestHeader from './BioHarnessRequestHeader';
import { ScientificReviewCard } from './BioHarnessDomainRenderers';
import BioHarnessPlanGraph from './BioHarnessPlanGraph';

const BioHarnessWorkflowRoute = memo(function BioHarnessWorkflowRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const isSmallScreen = useMediaQuery('(max-width: 767px)');
  const { zh, tr } = useBhText();
  const {
    meta,
    service,
    workspace,
    selectedRequestId,
    linkedConversationId,
    openConversation,
    openNewResearch,
    openEvidenceView,
    stageTextInConversation,
  } = useBioHarnessWorkspace();

  const runtimeEnabled = meta?.runtime?.enabled === true;
  const activeStepId = searchParams.get('step') || null;
  const [lastSelectedStepId, setLastSelectedStepId] = useState<string | null>(activeStepId);
  const [viewMode, setViewMode] = useState<'graph' | 'list'>(isSmallScreen ? 'list' : 'graph');
  const [userToggledMode, setUserToggledMode] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!fullscreen) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [fullscreen]);

  useEffect(() => {
    if (!userToggledMode) {
      setViewMode(isSmallScreen ? 'list' : 'graph');
    }
  }, [isSmallScreen, userToggledMode]);

  useEffect(() => {
    if (activeStepId) {
      setLastSelectedStepId(activeStepId);
    }
  }, [activeStepId]);

  const conversationsQuery = useQuery<WorkspaceConversation[]>({
    queryKey: bhKeys.conversations(service ?? 'svc', workspace ?? ''),
    queryFn: () => fetchConversations(workspace!),
    enabled: Boolean(service && workspace && runtimeEnabled),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  const resolvedConversation = resolveBoundConversation(conversationsQuery.data, workspace,
    selectedRequestId, linkedConversationId);
  const resolvedConversationId = resolvedConversation?.id ?? null;
  const bindingProblem = Boolean(linkedConversationId && !resolvedConversation && runtimeEnabled &&
    !conversationsQuery.isLoading);

  useBioHarnessVersionStream(service, workspace, selectedRequestId);

  const nowQuery = useQuery<Snapshot<NowData>>({
    queryKey: bhKeys.view(service ?? 'svc', workspace ?? '', 'now', {
      request_id: selectedRequestId ?? undefined,
    }),
    queryFn: () => fetchView<NowData>(workspace!, 'now', { request_id: selectedRequestId! }),
    enabled: Boolean(service && workspace && selectedRequestId),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  // A last-confirmed plan is usable only under its complete scientific identity.
  const snapshotOwner = JSON.stringify([service, workspace, selectedRequestId]);
  const lastConfirmedRef = useRef<{ owner: string; snapshot: Snapshot<NowData> | null }>({
    owner: snapshotOwner, snapshot: null,
  });
  if (snapshotOwner !== lastConfirmedRef.current.owner) {
    lastConfirmedRef.current = { owner: snapshotOwner, snapshot: null };
  }
  const confirmedNow = matchesSnapshot(nowQuery.data, service, workspace) && nowQuery.data.ok &&
    nowQuery.data.data?.request_id === selectedRequestId ? nowQuery.data : null;
  if (confirmedNow && !nowQuery.isError) {
    lastConfirmedRef.current = { owner: snapshotOwner, snapshot: confirmedNow };
  }
  const effectiveSnapshot = confirmedNow ?? lastConfirmedRef.current.snapshot;
  const isStale = Boolean(effectiveSnapshot && (nowQuery.isError || !confirmedNow));
  const nowData = effectiveSnapshot?.data ?? null;
  const scopeId = typeof nowData?.scope_context?.scope_id === 'string'
    ? nowData.scope_context.scope_id : null;

  const contextQuery = useQuery<Snapshot<ContextData>>({
    queryKey: bhKeys.view(service ?? 'svc', workspace ?? '', 'context', {
      scope_id: scopeId ?? undefined,
      request_id: selectedRequestId ?? undefined,
    }),
    queryFn: () =>
      fetchView<ContextData>(workspace!, 'context', {
        scope_id: scopeId!,
        request_id: selectedRequestId ?? undefined,
      }),
    enabled: Boolean(service && workspace && scopeId),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
  const contextShared =
    matchesSnapshot(contextQuery.data, service, workspace) && contextQuery.data.ok
      ? contextQuery.data.data?.shared
      : undefined;
  const goalVersionChanges = contextShared?.goal_version_changes ?? [];
  const relatedRequests = contextShared?.related_requests ?? [];
  const routesQuery = useScientificRoutePages(service, workspace, scopeId, Boolean(activeStepId));

  const steps = nowData?.plan?.steps ?? [];
  const progressSteps = nowData?.progress?.steps ?? [];
  const progressById = useMemo(
    () => new Map(progressSteps.map((s) => [s.id, s])),
    [progressSteps],
  );
  const activeStep = activeStepId ? steps.find((s) => s.id === activeStepId) ?? null : null;

  // Keep historical and version-unknown attempts visible. Only an exact owner
  // version match is associated with the current plan; none of this gates a run.
  const stepSubmissions = (routesQuery.routesData?.attempts ?? []).filter(
    (a) => a.request_id === selectedRequestId && a.step_id === activeStepId);
  const currentVersion = nowData?.plan_version;

  const openStep = (stepId: string) => {
    setLastSelectedStepId(stepId);
    const next = new URLSearchParams(searchParams);
    next.set('step', stepId);
    setSearchParams(next);
  };

  const backToPlan = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('step');
    setSearchParams(next);
  };

  const handleDiscussStep = (stepId: string, objective?: string) => {
    const label = objective ? `${stepId}（${objective.slice(0, 80)}）` : stepId;
    stageTextInConversation({
      conversationId: resolvedConversationId,
      requestId: selectedRequestId,
      snippet: `讨论研究步骤 ${label}：`,
    });
  };

  return (
    <main
      className="bg-surface-canvas flex h-full min-h-0 w-full flex-col overflow-hidden"
      role="main"
      data-testid="bh-workflow-route"
    >
      <BioHarnessRequestHeader
        activeTab="workflow"
        requestId={selectedRequestId}
        conversationId={resolvedConversationId}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <div className={fullscreen ? 'w-full' : 'mx-auto w-full max-w-5xl space-y-4'}>
          {bindingProblem && <p role="alert" className="p-3 text-xs">
            The conversation link is not verified for this workspace/request. Select the correct
            conversation before discussing this step; the scientific plan remains available.
          </p>}
          {nowData && !scopeId && (
            <div
              data-testid="bh-workflow-unscoped-note"
              className="border-border-light bg-surface-primary/60 text-text-secondary rounded-xl border px-3 py-2 text-xs"
            >
              Unscoped request — no public Governance submission history.
            </div>
          )}

          {Boolean(nowQuery.data?.shortened) && (
            <div
              data-testid="bh-workflow-shortened-note"
              className="border-border-light bg-surface-primary/60 text-text-secondary rounded-xl border px-3 py-2 text-xs"
            >
              Core shortened its snapshot response; inspect full files via verified evidence anchors.
            </div>
          )}

          {(goalVersionChanges.length > 0 || relatedRequests.length > 0) && (
            <div
              data-testid="bh-workflow-governance-context"
              className="border-border-light bg-surface-primary/60 text-text-secondary rounded-xl border px-3 py-2 text-xs"
            >
              <span className="text-text-primary font-medium">Governance context (advisory, non-blocking): </span>
              {goalVersionChanges.length > 0 && (
                <span>
                  {goalVersionChanges.length} ancestor goal-version difference(s) ({goalVersionChanges.map((g) => g.request_id).join(', ')}).{' '}
                </span>
              )}
              {relatedRequests.length > 0 && (
                <span>
                  {relatedRequests.length} related request(s) ({relatedRequests.map((r) => r.request_id).join(', ')}).{' '}
                </span>
              )}
              <span>Shown for scientific awareness only — does not pause or gate authorized work.</span>
            </div>
          )}

          {((nowData?.open_concerns && nowData.open_concerns.length > 0) ||
            Boolean(nowData?.plan_review)) && (
            <div data-testid="bh-workflow-advisory-concerns" className="space-y-2">
              {Boolean(nowData?.plan_review) && (
                <ScientificReviewCard
                  title={zh ? '计划科学审查意见（非阻断）' : 'Plan Scientific Review (Advisory, non-blocking)'}
                  advice={nowData?.plan_review as Record<string, unknown>}
                  openConcerns={nowData?.open_concerns}
                />
              )}
              {!nowData?.plan_review && nowData?.open_concerns && nowData.open_concerns.length > 0 && (
                <div className="border-border-light bg-surface-primary/60 text-text-secondary rounded-xl border px-3 py-2 text-xs">
                  <span className="text-text-primary font-medium">Advisory review notes (non-blocking): </span>
                  {nowData.open_concerns.map((c, idx) => (
                    <span key={`${c.about}-${idx}`}>
                      {idx > 0 ? '; ' : ''}
                      <code className="font-mono">{c.about}</code>: {c.concern}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {isStale && effectiveSnapshot && (
            <div
              role="alert"
              data-testid="bh-workflow-stale-banner"
              className="flex flex-wrap items-start justify-between gap-2 rounded-xl border border-amber-400/70 bg-amber-50/90 px-3 py-2 text-xs text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
            >
              <div className="flex min-w-0 items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <div>
                  <p className="font-semibold">
                    Core refresh failed — showing last confirmed snapshot from{' '}
                    <code>{effectiveSnapshot.observed_at}</code>.
                  </p>
                  <p className="opacity-85">
                    {(nowQuery.error as Error)?.message ||
                      nowQuery.data?.error?.message ||
                      'Core snapshot temporarily unavailable (503).'}
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                data-testid="bh-workflow-stale-refresh-btn"
                disabled={nowQuery.isFetching}
                onClick={() => void nowQuery.refetch()}
                className="shrink-0 gap-1 text-xs"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Refresh</span>
              </Button>
            </div>
          )}

          {!selectedRequestId ? (
            <div
              data-testid="bh-workflow-no-request"
              className="border-border-light bg-surface-primary/60 rounded-xl border p-6 text-center text-sm"
            >
              <p className="text-text-primary font-medium">No research request selected.</p>
              <p className="text-text-secondary mt-1 text-xs">
                Select an open request or governance scope node from the sidebar to inspect its
                authoritative Core plan.
              </p>
            </div>
          ) : nowQuery.isLoading && !nowData ? (
            <div className="text-text-secondary flex items-center gap-2 py-8 text-sm">
              <Spinner className="h-4 w-4" />
              <span>Loading authoritative Core plan…</span>
            </div>
          ) : !nowData ? (
            <div
              role="alert"
              data-testid="bh-workflow-error"
              className="border-status-error-border bg-status-error-subtle text-text-primary rounded-xl border p-4 text-sm"
            >
              {nowQuery.data?.error?.code && (
                <div className="mb-1 font-mono text-xs font-semibold" data-testid="bh-workflow-refusal-code">
                  {nowQuery.data.error.code}
                </div>
              )}
              {(nowQuery.error as Error)?.message ||
                nowQuery.data?.error?.message ||
                'Unable to load Core plan snapshot.'}
            </div>
          ) : activeStep ? (
            /* Step detail subpage replacing the plan canvas */
            <section
              data-testid="bh-step-detail"
              aria-label={`Step ${activeStep.id} detail`}
              className="space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="bh-back-to-plan-btn"
                  onClick={backToPlan}
                  className="gap-1.5 text-xs"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Back to plan</span>
                </Button>

                <Button
                  type="button"
                  size="sm"
                  data-testid="bh-discuss-step-btn"
                  onClick={() => handleDiscussStep(activeStep.id, activeStep.objective)}
                  className="gap-1.5 text-xs"
                >
                  <MessageSquarePlus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Discuss this step</span>
                </Button>
              </div>

              <div className="border-border-light bg-surface-primary rounded-xl border p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-light pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h1 className="text-text-primary font-mono text-lg font-semibold">
                        {activeStep.id}
                      </h1>
                      <span className="bg-surface-hover text-text-secondary rounded px-2 py-0.5 text-xs font-medium">
                        {activeStep.kind}
                      </span>
                      {progressById.get(activeStep.id)?.status && (
                        <span
                          data-testid="bh-step-detail-status"
                          className="rounded bg-blue-500/15 px-2 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300"
                        >
                          {progressById.get(activeStep.id)!.status}
                        </span>
                      )}
                    </div>
                    {activeStep.objective && (
                      <p className="text-text-secondary mt-1 text-sm">{activeStep.objective}</p>
                    )}
                  </div>
                  <div className="text-text-tertiary text-xs">
                    Attempts: {progressById.get(activeStep.id)?.attempts ?? 0}
                  </div>
                </div>

                {(progressById.get(activeStep.id)?.review ||
                  (nowData?.step?.id === activeStep.id && nowData.step.last_review)) && (
                  <ScientificReviewCard
                    title={zh ? '步骤科学审查记录（非阻断）' : 'Recorded step review (advisory — non-blocking)'}
                    advice={
                      (nowData?.step?.id === activeStep.id
                        ? (nowData.step.last_review as Record<string, unknown> | undefined)
                        : undefined) ?? null
                    }
                    reviewLabel={progressById.get(activeStep.id)?.review}
                    attempts={progressById.get(activeStep.id)?.attempts}
                    previousAttempt={
                      nowData?.step?.id === activeStep.id
                        ? ((nowData.step as unknown as Record<string, unknown>).previous_attempt as
                            | { status?: string; summary?: string }
                            | undefined)
                        : undefined
                    }
                  />
                )}

                <dl className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
                  <div>
                    <dt className="text-text-tertiary font-semibold uppercase">Why</dt>
                    <dd className="text-text-primary mt-0.5 whitespace-pre-wrap">
                      {activeStep.why || 'Not recorded'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-tertiary font-semibold uppercase">Method</dt>
                    <dd className="text-text-primary mt-0.5 whitespace-pre-wrap">
                      {activeStep.method || 'Not recorded'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-tertiary font-semibold uppercase">Deliverable</dt>
                    <dd className="text-text-primary mt-0.5 whitespace-pre-wrap">
                      {activeStep.deliverable || 'Not recorded'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-text-tertiary font-semibold uppercase">Check</dt>
                    <dd className="text-text-primary mt-0.5 whitespace-pre-wrap">
                      {activeStep.check || 'Not recorded'}
                    </dd>
                  </div>
                </dl>

                {activeStep.depends_on && activeStep.depends_on.length > 0 && (
                  <div className="text-xs">
                    <div className="text-text-tertiary font-semibold uppercase">
                      Predecessors (depends_on)
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {activeStep.depends_on.map((depId) => (
                        <button
                          key={depId}
                          type="button"
                          onClick={() => openStep(depId)}
                          className="border-border-medium bg-surface-secondary hover:bg-surface-hover rounded-md border px-2 py-0.5 font-mono text-xs"
                        >
                          {depId}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {activeStep.parameters && Object.keys(activeStep.parameters).length > 0 && (
                  <div className="text-xs">
                    <div className="text-text-tertiary font-semibold uppercase">Parameters</div>
                    <pre className="bg-surface-secondary mt-1 overflow-x-auto rounded-lg p-2.5 font-mono text-[11px]">
                      {JSON.stringify(activeStep.parameters, null, 2)}
                    </pre>
                  </div>
                )}

                {/* Recorded submissions & evidence links for this step */}
                <div className="border-border-light border-t pt-3 text-xs">
                  <div className="text-text-tertiary font-semibold uppercase">
                    Recorded submissions & evidence ({stepSubmissions.length} loaded)
                  </div>
                  {routesQuery.isLoading && scopeId ? <p>Loading recorded route history…</p> : null}
                  {!scopeId || routesQuery.isError || routesQuery.partial ? (
                    <p role="status" className="text-text-secondary mt-1">
                      {!scopeId ? 'No public scoped route history is available for this request. ' :
                        routesQuery.isError ? 'Route history unavailable; loaded records may be incomplete. ' :
                        'Only part of the route history is loaded. '}
                      This does not establish absence of submissions or stop research.
                    </p>
                  ) : null}
                  <p className="text-text-secondary mt-1">
                    Only recorded matching plan versions are current-plan submissions.
                    Historical or version-unknown records remain inspectable; discuss consequential
                    differences with the user before changing the scientific decision.
                  </p>
                  {routesQuery.hasNextPage && (
                    <Button type="button" variant="outline" size="sm"
                      disabled={routesQuery.isFetching} onClick={() => void routesQuery.fetchNextPage()}>
                      Load more recorded submissions
                    </Button>
                  )}
                  {stepSubmissions.length === 0 ? (
                    <p className="text-text-tertiary mt-1">
                      {routesQuery.confirmed ? 'No submissions recorded for this step.' :
                        'No matching submission in the available records.'}
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {stepSubmissions.map((sub) => (
                        <li
                          key={`${sub.request_id}-${sub.submission_index}`}
                          className="border-border-light bg-surface-secondary/40 rounded-lg border p-2.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-mono font-medium">
                              Submission #{sub.submission_index} · {sub.submission_status}
                            </span>
                            <span className="text-text-secondary">
                              {isCurrentPlanAttempt(sub, currentVersion)
                                ? 'Current plan version'
                                : 'Historical / version-unverified'}
                              {typeof sub.plan_version === 'number' ? <> · v{sub.plan_version}</> : ' · version unknown'}
                            </span>
                            {sub.at && <span className="text-text-tertiary">{sub.at}</span>}
                          </div>
                          {sub.summary && (
                            <p className="text-text-secondary mt-1">{sub.summary}</p>
                          )}
                          {sub.evidence.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {sub.evidence.map((ev) => {
                                const evId = ev.evidence_id || (ev as { id?: string }).id || '';
                                return (
                                <button
                                  key={`${evId}-${ev.sha256}`}
                                  type="button"
                                  data-testid={`bh-step-evidence-${evId}`}
                                  onClick={() =>
                                    openEvidenceView({
                                      requestId: selectedRequestId,
                                      conversationId: resolvedConversationId,
                                      anchor: {
                                        request_id: ev.request_id || sub.request_id,
                                        submission_index: ev.submission_index ?? sub.submission_index,
                                        evidence_id: evId,
                                        sha256: ev.sha256,
                                      },
                                    })
                                  }
                                  className="border-border-medium bg-surface-primary hover:bg-surface-hover inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px]"
                                >
                                  <FileText className="h-3 w-3" aria-hidden="true" />
                                  <span>{evId}</span>
                                </button>
                                );
                              })}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </section>
          ) : steps.length === 0 ? (
            <div
              data-testid="bh-workflow-empty-plan"
              className="border-border-light bg-surface-primary/60 space-y-2 rounded-xl border p-6 text-center text-sm"
            >
              <p className="text-text-primary font-medium">
                {tr('Core 尚未记录正式研究计划', 'No research plan recorded by Core yet.')}
              </p>
              <p className="text-text-secondary text-xs">
                {tr('当前阶段：', 'Current phase: ')}{' '}
                <code className="font-mono">{formatPhaseLabel(nowData.phase, zh)}</code> ·{' '}
                {tr('下一步动作：', 'Action: ')}{' '}
                <code className="font-mono">{nowData.action ?? 'unknown'}</code>
              </p>
              <div className="pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="bh-workflow-go-chat-btn"
                  onClick={() => {
                    if (resolvedConversationId) {
                      openConversation(resolvedConversationId, {
                        requestId: selectedRequestId,
                        scopeId,
                      });
                    } else {
                      openNewResearch({ requestId: selectedRequestId, scopeId });
                    }
                  }}
                >
                  {tr('前往对话继续推进', 'Go to Conversation to continue')}
                </Button>
              </div>
            </div>
          ) : (
            /* Full-width Plan Overview (Graph or dependency-labelled List) */
            <section className="space-y-3" aria-label="Research plan">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <h1 className="text-text-primary break-words text-base font-semibold">
                    {nowData.plan?.objective || nowData.question || `Request ${nowData.request_id}`}
                  </h1>
                  <p className="text-text-tertiary text-xs">
                    Phase: <code className="font-mono">{nowData.phase}</code> ·{' '}
                    {typeof nowData.plan_version === 'number'
                      ? `Plan version v${nowData.plan_version}`
                      : 'Plan version not exposed by owner'}{' '}
                    · {steps.length} steps
                  </p>
                </div>

                <div className="flex items-center gap-1.5">
                  <div className="border-border-medium inline-flex rounded-lg border p-0.5 text-xs">
                    <button
                      type="button"
                      data-testid="bh-plan-mode-graph"
                      onClick={() => {
                        setUserToggledMode(true);
                        setViewMode('graph');
                      }}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${
                        viewMode === 'graph'
                          ? 'bg-surface-hover text-text-primary font-medium'
                          : 'text-text-secondary'
                      }`}
                    >
                      <GitFork className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Graph</span>
                    </button>
                    <button
                      type="button"
                      data-testid="bh-plan-mode-list"
                      onClick={() => {
                        setUserToggledMode(true);
                        setViewMode('list');
                        setFullscreen(false);
                      }}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${
                        viewMode === 'list'
                          ? 'bg-surface-hover text-text-primary font-medium'
                          : 'text-text-secondary'
                      }`}
                    >
                      <List className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>List</span>
                    </button>
                  </div>

                  {viewMode === 'graph' && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="bh-plan-fullscreen-btn"
                      onClick={() => setFullscreen((v) => !v)}
                      className="gap-1 text-xs"
                    >
                      {fullscreen ? (
                        <>
                          <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Exit full</span>
                        </>
                      ) : (
                        <>
                          <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Fullscreen</span>
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>

              {viewMode === 'graph' ? (
                <BioHarnessPlanGraph
                  steps={steps}
                  progressSteps={progressSteps}
                  currentStepId={nowData.step?.id ?? null}
                  selectedStepId={lastSelectedStepId}
                  onSelectStep={openStep}
                  fullscreen={fullscreen}
                />
              ) : (
                <ul className="space-y-2" data-testid="bh-plan-list-view">
                  {steps.map((step) => {
                    const prog = progressById.get(step.id);
                    const selected = lastSelectedStepId === step.id;
                    return (
                      <li key={step.id}>
                        <button
                          type="button"
                          data-testid={`bh-plan-list-item-${step.id}`}
                          onClick={() => openStep(step.id)}
                          className={`border-border-light bg-surface-primary hover:bg-surface-hover/50 flex w-full flex-col gap-1 rounded-xl border p-3 text-left transition-colors ${
                            selected ? 'ring-2 ring-blue-500' : ''
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-text-primary font-mono text-xs font-semibold">
                              {step.id} <span className="text-text-tertiary font-sans">({step.kind})</span>
                            </span>
                            <span className="bg-surface-hover text-text-secondary rounded px-2 py-0.5 text-[11px] font-medium">
                              {prog?.status ?? 'RECORDED'}
                            </span>
                          </div>
                          {step.objective && (
                            <p className="text-text-secondary text-xs">{step.objective}</p>
                          )}
                          <div className="text-text-tertiary text-[11px]">
                            Depends on:{' '}
                            {step.depends_on && step.depends_on.length > 0
                              ? step.depends_on.join(', ')
                              : 'None (root step)'}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>
    </main>
  );
});

export default BioHarnessWorkflowRoute;
