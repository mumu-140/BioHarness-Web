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
} from 'lucide-react';
import { Button, Spinner, useMediaQuery } from '@librechat/client';
import type { NowData, RoutesData, Snapshot, WorkspaceConversation } from './bioharness';
import { bhKeys, fetchConversations, fetchView } from './bioharness';
import { useBioHarnessVersionStream } from './events';
import { useBioHarnessWorkspace } from './workspace';
import BioHarnessRequestHeader from './BioHarnessRequestHeader';
import BioHarnessPlanGraph from './BioHarnessPlanGraph';

const BioHarnessWorkflowRoute = memo(function BioHarnessWorkflowRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const isSmallScreen = useMediaQuery('(max-width: 767px)');
  const {
    meta,
    service,
    workspace,
    selectedRequestId,
    linkedConversationId,
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

  const resolvedConversationId = useMemo(() => {
    if (linkedConversationId) {
      return linkedConversationId;
    }
    if (!selectedRequestId) {
      return null;
    }
    return (conversationsQuery.data ?? []).find((c) => c.request_id === selectedRequestId)?.id ?? null;
  }, [linkedConversationId, selectedRequestId, conversationsQuery.data]);

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

  /* Retain last confirmed snapshot on transient 503/tool error and disclose staleness explicitly. */
  const lastConfirmedRef = useRef<{ requestId: string | null; snapshot: Snapshot<NowData> | null }>({
    requestId: null,
    snapshot: null,
  });
  if (selectedRequestId !== lastConfirmedRef.current.requestId) {
    lastConfirmedRef.current = { requestId: selectedRequestId, snapshot: null };
  }
  if (nowQuery.data?.ok && nowQuery.data.data) {
    lastConfirmedRef.current = { requestId: selectedRequestId, snapshot: nowQuery.data };
  }

  const effectiveSnapshot = nowQuery.data?.ok
    ? nowQuery.data
    : lastConfirmedRef.current.snapshot;
  const isStale = Boolean(
    effectiveSnapshot && (nowQuery.isError || (nowQuery.data && !nowQuery.data.ok)),
  );
  const nowData = effectiveSnapshot?.data ?? null;
  const scopeId =
    typeof nowData?.scope_context?.scope_id === 'string' ? nowData.scope_context.scope_id : null;

  const routesQuery = useQuery<Snapshot<RoutesData>>({
    queryKey: bhKeys.view(service ?? 'svc', workspace ?? '', 'routes', {
      scope_id: scopeId ?? undefined,
    }),
    queryFn: () => fetchView<RoutesData>(workspace!, 'routes', { scope_id: scopeId! }),
    enabled: Boolean(service && workspace && scopeId && activeStepId),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  const steps = nowData?.plan?.steps ?? [];
  const progressSteps = nowData?.progress?.steps ?? [];
  const progressById = useMemo(
    () => new Map(progressSteps.map((s) => [s.id, s])),
    [progressSteps],
  );
  const activeStep = activeStepId ? steps.find((s) => s.id === activeStepId) ?? null : null;

  const stepSubmissions = useMemo(() => {
    if (!activeStepId || !selectedRequestId || !routesQuery.data?.ok || !routesQuery.data.data) {
      return [];
    }
    return routesQuery.data.data.attempts.filter(
      (a) => a.request_id === selectedRequestId && a.step_id === activeStepId,
    );
  }, [activeStepId, selectedRequestId, routesQuery.data]);

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
          {isStale && effectiveSnapshot && (
            <div
              role="alert"
              data-testid="bh-workflow-stale-banner"
              className="flex items-start gap-2 rounded-xl border border-amber-400/70 bg-amber-50/90 px-3 py-2 text-xs text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
            >
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

                {progressById.get(activeStep.id)?.review && (
                  <div className="bg-surface-secondary/60 rounded-lg p-3 text-xs">
                    <div className="text-text-tertiary font-semibold uppercase tracking-wide">
                      Recorded review
                    </div>
                    <p className="text-text-primary mt-1 whitespace-pre-wrap">
                      {progressById.get(activeStep.id)!.review}
                    </p>
                  </div>
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
                    Recorded submissions & evidence ({stepSubmissions.length})
                  </div>
                  {stepSubmissions.length === 0 ? (
                    <p className="text-text-tertiary mt-1">
                      No Governance submissions recorded for this step yet.
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
                            {sub.at && <span className="text-text-tertiary">{sub.at}</span>}
                          </div>
                          {sub.summary && (
                            <p className="text-text-secondary mt-1">{sub.summary}</p>
                          )}
                          {sub.evidence.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {sub.evidence.map((ev) => (
                                <button
                                  key={`${ev.evidence_id}-${ev.sha256}`}
                                  type="button"
                                  data-testid={`bh-step-evidence-${ev.evidence_id}`}
                                  onClick={() =>
                                    openEvidenceView({
                                      requestId: selectedRequestId,
                                      conversationId: resolvedConversationId,
                                      anchor: {
                                        request_id: ev.request_id,
                                        submission_index: ev.submission_index,
                                        evidence_id: ev.evidence_id,
                                        sha256: ev.sha256,
                                      },
                                    })
                                  }
                                  className="border-border-medium bg-surface-primary hover:bg-surface-hover inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px]"
                                >
                                  <FileText className="h-3 w-3" aria-hidden="true" />
                                  <span>{ev.evidence_id}</span>
                                </button>
                              ))}
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
              className="border-border-light bg-surface-primary/60 rounded-xl border p-6 text-center text-sm"
            >
              <p className="text-text-primary font-medium">No research plan recorded by Core yet.</p>
              <p className="text-text-secondary mt-1 text-xs">
                Current phase: <code className="font-mono">{nowData.phase ?? 'unknown'}</code> ·
                Action: <code className="font-mono">{nowData.action ?? 'unknown'}</code>
              </p>
            </div>
          ) : (
            /* Full-width Plan Overview (Graph or dependency-labelled List) */
            <section className="space-y-3" aria-label="Research plan">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <h1 className="text-text-primary text-base font-semibold">
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
