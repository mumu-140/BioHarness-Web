/**
 * BioHarness native vertical slice seated inside LibreChat's adopted ChatScreen, MessagesView,
 * Markdown renderer, and ComposerFrame (not upstream LibreChat code).
 *
 * Enforces:
 * - Verbatim original-question custody to Core (`science_begin`)
 * - Explicit five-layer identity (service / workspace / request / conversation / run)
 * - Background-run continuity across navigation and reload via server-owned SSE (`GET .../events`)
 * - Per-conversation unsent draft preservation
 * - Native-user HITL (never auto-confirms mainline amendments)
 * - UNKNOWN / EXISTING_REQUEST reconciliation without replaying `science_begin`
 * - Cancellation requested (`run.cancel_requested`) vs terminal confirmation (`run.finished`)
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRecoilValue } from 'recoil';
import {
  AlertTriangle,
  ArrowUp,
  Check,
  Copy,
  GitBranch,
  HelpCircle,
  Link2,
  Play,
  RefreshCw,
  SlidersHorizontal,
  Square,
} from 'lucide-react';
import { Constants } from 'librechat-data-provider';
import type { TConversation, TMessage } from 'librechat-data-provider';
import { ChatScreen, ComposerFrame } from '@librechat/chat/components';
import { ChatContext } from '@librechat/chat/react';
import type { ChatContract } from '@librechat/chat/react';
import { Button, Spinner, TextareaAutosize, useMediaQuery } from '@librechat/client';
import { AddedChatContext, EditorProvider } from '~/Providers';
import { MessageSurfaceContext } from '~/components/Chat/Messages/ui/surface';
import ApprovalProvider from '~/components/Chat/Messages/Content/ApprovalContext';
import { OwnerTextProvider } from '~/components/Chat/Messages/PrivateText';
import { preloadMessages, renderMessages } from '~/components/Chat/Messages/load';
import AppChatSurface from '~/components/Chat/Surface';
import OpenSidebar from '~/components/Chat/Menus/OpenSidebar';
import store from '~/store';
import type {
  ConversationStateResponse,
  NewScopeSelection,
  NowData,
  Snapshot,
  TreeData,
} from './bioharness';
import {
  BIOHARNESS_ENDPOINT,
  BioHarnessApiError,
  attachConversationRequest,
  bhKeys,
  cancelRun,
  createConversation,
  deriveRunStatus,
  eventsToMessages,
  extractTreeScopes,
  fetchConversationState,
  fetchView,
  startRun,
} from './bioharness';
import { useBioHarnessConversationEvents, useBioHarnessVersionStream } from './events';
import { useBioHarnessWorkspace } from './workspace';

const EMPTY_FILES = new Map();
const noop = () => undefined;

const BioHarnessChatRoute = memo(function BioHarnessChatRoute() {
  const { conversationId: rawParam } = useParams();
  const isNew = !rawParam || rawParam === Constants.NEW_CONVO;
  const activeConversationId = isNew ? null : rawParam;

  const queryClient = useQueryClient();
  const isSmallScreen = useMediaQuery('(max-width: 767px)');
  const enterToSend = useRecoilValue(store.enterToSend);
  const maximizeChatSpace = useRecoilValue(store.maximizeChatSpace);

  const {
    meta,
    service,
    workspace,
    selectedRequestId,
    branchSource,
    setBranchSource,
    openConversation,
    openNewResearch,
    getDraft,
    setDraft,
    clearDraft,
    openModelSettings,
  } = useBioHarnessWorkspace();

  const runtimeEnabled = meta?.runtime?.enabled === true;
  const activeModel = meta?.runtime?.model ?? null;

  /* Preload LibreChat's adopted MessagesView + Markdown hosts when entering a conversation. */
  useEffect(() => {
    void preloadMessages().catch(() => undefined);
  }, []);

  /* Authoritative conversation state (bound request, active run, begin_reconcile/candidates). */
  const stateQuery = useQuery<ConversationStateResponse>({
    queryKey: bhKeys.conversation(service ?? 'svc', workspace ?? '', activeConversationId ?? ''),
    queryFn: () => fetchConversationState(workspace!, activeConversationId!),
    enabled: Boolean(service && workspace && activeConversationId && runtimeEnabled),
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });

  /* Authoritative server event log SSE. */
  const log = useBioHarnessConversationEvents(
    service,
    runtimeEnabled ? workspace : null,
    runtimeEnabled ? activeConversationId : null,
  );

  const boundRequestId = stateQuery.data?.conversation.request_id ?? null;
  const effectiveRequestId = activeConversationId ? boundRequestId : selectedRequestId;

  /* Version invalidation SSE for Core open/now views. */
  useBioHarnessVersionStream(service, workspace, effectiveRequestId);

  /* Authoritative Core `now` snapshot for HITL / delivery status. */
  const nowQuery = useQuery<Snapshot<NowData>>({
    queryKey: bhKeys.view(service ?? 'svc', workspace ?? '', 'now', {
      request_id: effectiveRequestId ?? undefined,
    }),
    queryFn: () => fetchView<NowData>(workspace!, 'now', { request_id: effectiveRequestId! }),
    enabled: Boolean(service && workspace && effectiveRequestId),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

  /* Scope options for a brand-new research question. */
  const treeQuery = useQuery<Snapshot<TreeData>>({
    queryKey: bhKeys.view(service ?? 'svc', workspace ?? '', 'tree'),
    queryFn: () => fetchView<TreeData>(workspace!, 'tree'),
    enabled: Boolean(service && workspace && isNew && !selectedRequestId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const scopes = useMemo(() => extractTreeScopes(treeQuery.data), [treeQuery.data]);
  const [scopeMode, setScopeMode] = useState<'none' | 'existing' | 'new'>('none');
  const [selectedScopeId, setSelectedScopeId] = useState('');
  const [newScopeId, setNewScopeId] = useState('');

  /* Reset scope selector when workspace changes. */
  useEffect(() => {
    setScopeMode('none');
    setSelectedScopeId('');
    setNewScopeId('');
  }, [workspace]);

  const runStatus = useMemo(
    () => deriveRunStatus(log.events, stateQuery.data?.active_run?.id),
    [log.events, stateQuery.data?.active_run?.id],
  );
  const [optimisticCancelRunId, setOptimisticCancelRunId] = useState<string | null>(null);
  useEffect(() => {
    if (!runStatus.activeRunId || runStatus.activeRunId !== optimisticCancelRunId) {
      setOptimisticCancelRunId(null);
    }
  }, [runStatus.activeRunId, optimisticCancelRunId]);

  const activeRunId = runStatus.activeRunId;
  const cancelRequested =
    runStatus.cancelRequested ||
    (activeRunId !== null && optimisticCancelRunId === activeRunId);

  const nowData = nowQuery.data?.ok ? nowQuery.data.data : null;
  const isDelivered = nowData?.phase === 'DELIVERED';
  const beginReconcile = stateQuery.data?.begin_reconcile ?? null;
  const isUnknownBegin = beginReconcile !== null;
  const needsExplicitRequestStart = isNew && Boolean(selectedRequestId);

  const [manualAttachId, setManualAttachId] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [isActing, setIsActing] = useState(false);
  const [focused, setFocused] = useState(false);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  /* Clear transient error when switching conversation or workspace. */
  useEffect(() => {
    setProblem(null);
    setManualAttachId('');
  }, [workspace, activeConversationId, selectedRequestId]);

  const draftKey = activeConversationId ?? (selectedRequestId ? `req:${selectedRequestId}` : 'new');
  const draftText = getDraft(draftKey);

  const scopeProblem = useMemo(() => {
    if (!isNew || selectedRequestId) {
      return null;
    }
    if (scopeMode === 'existing' && !selectedScopeId) {
      return 'Choose an existing scope or switch to No scope.';
    }
    if (scopeMode === 'new' && !newScopeId.trim()) {
      return 'Enter a new scope ID or switch to No scope.';
    }
    return null;
  }, [isNew, selectedRequestId, scopeMode, selectedScopeId, newScopeId]);

  const messages: TMessage[] = useMemo(() => {
    if (!activeConversationId) {
      return [];
    }
    return eventsToMessages(log.events, log.draft, activeConversationId, activeModel);
  }, [activeConversationId, log.events, log.draft, activeModel]);

  const messagesRef = useRef<TMessage[]>(messages);
  messagesRef.current = messages;

  const syntheticConversation: TConversation = useMemo(
    () => ({
      conversationId: activeConversationId ?? Constants.NEW_CONVO,
      title: effectiveRequestId ? `Request ${effectiveRequestId}` : 'New research',
      endpoint: BIOHARNESS_ENDPOINT,
      model: activeModel ?? undefined,
      createdAt: stateQuery.data?.conversation.created_at ?? '',
      updatedAt: '',
    }),
    [activeConversationId, effectiveRequestId, activeModel, stateQuery.data?.conversation.created_at],
  );

  const runAction = useCallback(
    async <T,>(work: () => Promise<T>): Promise<T | null> => {
      if (isActing) {
        return null;
      }
      setIsActing(true);
      setProblem(null);
      try {
        return await work();
      } catch (err) {
        if (err instanceof BioHarnessApiError) {
          if (err.status === 401) {
            void queryClient.invalidateQueries({ queryKey: bhKeys.meta() });
          }
          setProblem(`${err.code}: ${err.message}`);
        } else {
          setProblem((err as Error)?.message || 'Request failed');
        }
        return null;
      } finally {
        setIsActing(false);
      }
    },
    [isActing, queryClient],
  );

  const handleStartRequestConversation = useCallback(async () => {
    if (!workspace || !service || !selectedRequestId || !runtimeEnabled) {
      return;
    }
    const created = await runAction(() =>
      createConversation(workspace, { request_id: selectedRequestId }),
    );
    if (created) {
      void queryClient.invalidateQueries({ queryKey: bhKeys.conversations(service, workspace) });
      openConversation(created.conversation.id, { requestId: selectedRequestId });
    }
  }, [workspace, service, selectedRequestId, runtimeEnabled, runAction, queryClient, openConversation]);

  const handleAttachRequest = useCallback(
    async (requestId: string) => {
      const trimmed = requestId.trim();
      if (!workspace || !service || !activeConversationId || !trimmed) {
        return;
      }
      const res = await runAction(() =>
        attachConversationRequest(workspace, activeConversationId, trimmed),
      );
      if (res) {
        setManualAttachId('');
        void queryClient.invalidateQueries({ queryKey: bhKeys.conversations(service, workspace) });
        void queryClient.invalidateQueries({
          queryKey: bhKeys.conversation(service, workspace, activeConversationId),
        });
        void queryClient.invalidateQueries({ queryKey: bhKeys.viewRoot(service, workspace) });
      }
    },
    [workspace, service, activeConversationId, runAction, queryClient],
  );

  const handleCancel = useCallback(async () => {
    if (!workspace || !activeConversationId || !activeRunId || cancelRequested) {
      return;
    }
    const res = await runAction(() => cancelRun(workspace, activeConversationId, activeRunId));
    if (res) {
      setOptimisticCancelRunId(activeRunId);
    }
  }, [workspace, activeConversationId, activeRunId, cancelRequested, runAction]);

  const handleContinueFromCore = useCallback(async () => {
    if (!workspace || !service || !activeConversationId || activeRunId) {
      return;
    }
    const res = await runAction(() => startRun(workspace, activeConversationId, null));
    if (res) {
      void queryClient.invalidateQueries({
        queryKey: bhKeys.conversation(service, workspace, activeConversationId),
      });
    }
  }, [workspace, service, activeConversationId, activeRunId, runAction, queryClient]);

  const composerBlocked =
    !runtimeEnabled ||
    !workspace ||
    isActing ||
    activeRunId !== null ||
    isUnknownBegin ||
    isDelivered ||
    needsExplicitRequestStart ||
    scopeProblem !== null;

  const handleSubmitText = useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault();
      if (composerBlocked || !workspace || !service) {
        return;
      }
      /* Preserve the user's exact verbatim text for Core custody; reject whitespace-only input. */
      if (!draftText.trim()) {
        return;
      }
      const verbatimText = draftText;

      if (!activeConversationId) {
        let scope: NewScopeSelection | undefined;
        if (scopeMode === 'existing') {
          scope = { id: selectedScopeId };
        } else if (scopeMode === 'new') {
          scope = { id: newScopeId.trim(), create: true };
        }
        const created = await runAction(() =>
          createConversation(workspace, { text: verbatimText, ...(scope ? { scope } : {}) }),
        );
        if (created) {
          clearDraft(draftKey);
          setBranchSource(null);
          void queryClient.invalidateQueries({ queryKey: bhKeys.conversations(service, workspace) });
          openConversation(created.conversation.id, { requestId: created.conversation.request_id });
        }
      } else {
        const res = await runAction(() => startRun(workspace, activeConversationId, verbatimText));
        if (res) {
          clearDraft(draftKey);
          void queryClient.invalidateQueries({
            queryKey: bhKeys.conversation(service, workspace, activeConversationId),
          });
        }
      }
    },
    [
      composerBlocked,
      workspace,
      service,
      draftText,
      activeConversationId,
      scopeMode,
      selectedScopeId,
      newScopeId,
      runAction,
      clearDraft,
      draftKey,
      setBranchSource,
      queryClient,
      openConversation,
    ],
  );

  const insertIntoDraft = useCallback(
    (snippet: string) => {
      const next = draftText.trim() ? `${draftText.trimEnd()} ${snippet}` : snippet;
      setDraft(draftKey, next);
      textAreaRef.current?.focus();
    },
    [draftText, draftKey, setDraft],
  );

  const copyConfirmationPhrase = useCallback(async (amendmentId: string) => {
    const phrase = `确认主线 ${amendmentId}`;
    try {
      await navigator.clipboard.writeText(phrase);
      setCopiedId(amendmentId);
      window.setTimeout(() => setCopiedId(null), 1500);
    } catch {
      /* fallback: user can still use insertIntoDraft */
    }
  }, []);

  /* Minimal ChatContext value so LibreChat's ChatScreen & MessagesView run natively. */
  const chatContextValue = useMemo<ChatContract>(
    () =>
      ({
        index: 0,
        conversation: syntheticConversation,
        setConversation: noop,
        isSubmitting: activeRunId !== null,
        setIsSubmitting: noop,
        getMessages: () => messagesRef.current,
        setMessages: noop,
        ask: noop,
        regenerate: noop,
        stopGenerating: () => {
          void handleCancel();
        },
        handleStopGenerating: (e: React.MouseEvent<HTMLButtonElement>) => {
          e.preventDefault();
          void handleCancel();
        },
        newConversation: () => openNewResearch(),
        files: EMPTY_FILES,
        setFiles: noop,
        filesLoading: false,
        setFilesLoading: noop,
        showPopover: false,
        setShowPopover: noop,
        abortScroll: false,
        setAbortScroll: noop,
        preset: null,
        setPreset: noop,
        optionSettings: {},
        setOptionSettings: noop,
        showAgentSettings: false,
        setShowAgentSettings: noop,
        latestMessage: messages[messages.length - 1] ?? null,
        setLatestMessage: noop,
        latestMessageId: messages[messages.length - 1]?.messageId ?? null,
        latestMessageDepth: messages.length,
        hasMessages: messages.length > 0,
        conversationId: activeConversationId ?? Constants.NEW_CONVO,
        endpoint: BIOHARNESS_ENDPOINT,
      }) as unknown as ChatContract,
    [syntheticConversation, activeRunId, handleCancel, openNewResearch, messages, activeConversationId],
  );

  const amendment = nowData?.mainline_amendment_pending ?? null;
  const waitingForUser =
    nowData?.action === 'WAIT_FOR_USER' || Boolean(nowData?.waiting_for_user);
  const revisingPlan = nowData?.action === 'REVISE_PLAN';
  const requestScope =
    typeof nowData?.scope_context?.scope_id === 'string' ? nowData.scope_context.scope_id : null;

  const placeholder = !runtimeEnabled
    ? 'Native model runtime is not enabled — configure a model in Settings → Models'
    : isDelivered
      ? 'This request is delivered — start a new research question for follow-up work'
      : isUnknownBegin
        ? 'Reconcile the request binding above before sending another message'
        : needsExplicitRequestStart
          ? 'Start a conversation for the selected request above first'
          : activeConversationId
            ? 'Reply, or send the exact Core confirmation phrase…'
            : 'Enter your scientific question (sent verbatim to Core)…';

  const headerSlot = (
    <header
      className="border-border-light bg-surface-canvas/95 sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 backdrop-blur-xs"
      data-testid="bh-chat-header"
    >
      <div className="flex min-w-0 items-center gap-2">
        {isSmallScreen && <OpenSidebar testId="header-open-sidebar-button" />}
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
          <span
            className="bg-surface-hover text-text-primary rounded-md px-2 py-0.5 font-medium"
            data-testid="bh-header-workspace"
          >
            {workspace ?? '—'}
          </span>
          <span className="text-text-tertiary">/</span>
          <span
            className="text-text-primary truncate font-mono"
            data-testid="bh-header-request"
          >
            {effectiveRequestId ? effectiveRequestId : 'Unbound'}
          </span>
          {activeConversationId && (
            <>
              <span className="text-text-tertiary">/</span>
              <span
                className="text-text-secondary truncate font-mono"
                data-testid="bh-header-convo"
              >
                {activeConversationId.slice(0, 12)}
              </span>
            </>
          )}
          {activeRunId && (
            <span
              className="rounded-md bg-teal-500/15 px-2 py-0.5 font-medium text-teal-700 dark:text-teal-300"
              data-testid="bh-header-active-run"
            >
              {cancelRequested ? 'Cancel requested…' : `Run ${activeRunId.slice(0, 8)}`}
            </span>
          )}
          {activeConversationId && (
            <span
              className="text-text-tertiary text-[11px]"
              data-testid="bh-sse-status"
            >
              {log.connected ? 'SSE live' : 'SSE connecting…'}
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {activeConversationId && boundRequestId && !isDelivered && !activeRunId && runtimeEnabled && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="bh-continue-core-btn"
            disabled={isActing}
            onClick={() => void handleContinueFromCore()}
            className="gap-1.5 text-xs"
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Continue from Core</span>
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="bh-header-models-btn"
          onClick={openModelSettings}
          className="gap-1.5 text-xs"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="max-w-[140px] truncate">{activeModel || 'Models'}</span>
        </Button>
      </div>
    </header>
  );

  const banners = (
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
            onClick={() => setProblem(null)}
            className="text-text-secondary hover:text-text-primary underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {stateQuery.isError && activeConversationId && (
        <div
          role="alert"
          data-testid="bh-convo-state-error"
          className="border-status-error-border bg-status-error-subtle text-text-primary rounded-lg border px-3 py-2"
        >
          {(stateQuery.error as Error)?.message || 'Failed to load conversation state.'}
        </div>
      )}

      {/* Explicit start conversation for an existing open Core request */}
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
            onClick={() => void handleStartRequestConversation()}
            className="gap-1.5"
          >
            <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Start conversation for request</span>
          </Button>
        </div>
      )}

      {/* UNKNOWN / EXISTING_REQUEST reconciliation card — never replays science_begin */}
      {isUnknownBegin && stateQuery.data && (
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

          {stateQuery.data.begin_candidates.length > 0 && (
            <ul className="mt-2 space-y-1.5" data-testid="bh-reconcile-candidates">
              {stateQuery.data.begin_candidates.map((cand) => (
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
                    onClick={() => void handleAttachRequest(cand.request_id)}
                  >
                    Attach request
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {stateQuery.data.open_listing?.may_be_incomplete && (
            <p className="mt-2 text-[11px] opacity-80">
              Note: Core listed {stateQuery.data.open_listing.listed} open requests; the target
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
              onClick={() => void handleAttachRequest(manualAttachId)}
            >
              Attach ID
            </Button>
          </div>
        </div>
      )}

      {/* Native-user HITL Banner (authoritative Core `now` snapshot) */}
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
                    onClick={() => insertIntoDraft(`确认主线 ${amendment.id}`)}
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
                  openNewResearch({
                    branchSource: { requestId: nowData.request_id, scopeId: requestScope },
                  })
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

      {/* Visible editable reference banner when branching from a delivered request */}
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
              onClick={() => insertIntoDraft(`参考历史请求 ${branchSource.requestId}：`)}
              className="text-text-primary underline"
            >
              Insert reference into draft
            </button>
            <button
              type="button"
              onClick={() => setBranchSource(null)}
              className="text-text-tertiary hover:text-text-primary"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Explicit scope selection for brand-new research questions */}
      {isNew && !selectedRequestId && runtimeEnabled && (
        <fieldset
          data-testid="bh-scope-selector"
          className="border-border-light bg-surface-primary/60 flex flex-wrap items-center gap-3 rounded-xl border px-3 py-2"
        >
          <legend className="text-text-tertiary px-1 text-[11px] font-medium">
            Scope for new request
          </legend>
          <label className="text-text-primary inline-flex items-center gap-1.5">
            <input
              type="radio"
              name="bh-scope-mode"
              checked={scopeMode === 'none'}
              onChange={() => setScopeMode('none')}
            />
            <span>No scope</span>
          </label>
          {scopes.length > 0 && (
            <label className="text-text-primary inline-flex items-center gap-1.5">
              <input
                type="radio"
                name="bh-scope-mode"
                checked={scopeMode === 'existing'}
                onChange={() => {
                  setScopeMode('existing');
                  if (!selectedScopeId && scopes[0]) {
                    setSelectedScopeId(scopes[0].scope_id);
                  }
                }}
              />
              <span>Existing:</span>
              <select
                aria-label="Existing scope"
                disabled={scopeMode !== 'existing'}
                value={selectedScopeId}
                onChange={(e) => setSelectedScopeId(e.target.value)}
                className="border-border-medium bg-surface-primary rounded border px-1.5 py-0.5 font-mono text-xs disabled:opacity-50"
              >
                {scopes.map((s) => (
                  <option key={s.scope_id} value={s.scope_id}>
                    {s.scope_id}
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
              onChange={() => setScopeMode('new')}
            />
            <span>New scope:</span>
            <input
              type="text"
              aria-label="New scope ID"
              data-testid="bh-new-scope-input"
              disabled={scopeMode !== 'new'}
              value={newScopeId}
              onChange={(e) => setNewScopeId(e.target.value)}
              placeholder="scope-id"
              className="border-border-medium bg-surface-primary w-32 rounded border px-1.5 py-0.5 font-mono text-xs disabled:opacity-50"
            />
          </label>
          {scopeProblem && (
            <span className="text-text-destructive text-[11px]" role="alert">
              {scopeProblem}
            </span>
          )}
        </fieldset>
      )}
    </div>
  );

  const landingView = (
    <div
      className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-4 text-center"
      data-testid="bh-landing"
    >
      <h2 className="text-text-primary text-2xl font-semibold tracking-tight">
        BioHarness Research Workspace
      </h2>
      <p className="text-text-secondary mt-2 max-w-lg text-sm">
        {runtimeEnabled
          ? 'Submit a scientific question verbatim to BioHarness Core, or select an existing workspace conversation or open request from the sidebar.'
          : 'Native model runtime is not currently enabled. Open Settings → Models to configure a provider, or inspect workspace state from the sidebar.'}
      </p>
    </div>
  );

  const composerSlot = (
    <ComposerFrame
      onSubmit={(e) => void handleSubmitText(e)}
      direction="auto"
      maximizeChatSpace={maximizeChatSpace}
      focused={focused}
      isTemporary={false}
      onFocusDraft={() => textAreaRef.current?.focus()}
      hints={
        <p className="text-text-tertiary mt-1.5 text-center text-[11px]">
          Closing this page does not cancel a running task; cancellation requires clicking Stop and
          is confirmed by the run&apos;s terminal event.
        </p>
      }
    >
      <div className="flex flex-col gap-2 px-3 py-2.5">
        <TextareaAutosize
          ref={textAreaRef}
          id="prompt-textarea"
          data-testid="bh-composer-input"
          aria-label="Message"
          minRows={2}
          maxRows={10}
          value={draftText}
          disabled={composerBlocked}
          placeholder={placeholder}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => setDraft(draftKey, e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === 'Enter' &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              enterToSend
            ) {
              e.preventDefault();
              void handleSubmitText();
            }
          }}
          className="text-text-primary placeholder:text-text-secondary w-full resize-none bg-transparent text-sm leading-relaxed focus:outline-hidden disabled:cursor-not-allowed disabled:opacity-60"
        />

        <div className="flex items-center justify-between gap-2">
          <span className="text-text-tertiary truncate text-[11px]">
            {activeRunId
              ? cancelRequested
                ? 'Cancellation requested — awaiting run confirmation…'
                : 'Backend run in progress…'
              : activeModel
                ? `Active model: ${activeModel}`
                : 'No model configured'}
          </span>

          <div className="flex items-center gap-2">
            {activeRunId ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                data-testid={cancelRequested ? 'bh-cancel-requested' : 'bh-cancel-run-btn'}
                disabled={cancelRequested || isActing}
                onClick={() => void handleCancel()}
                className="gap-1.5 rounded-full px-3 text-xs"
              >
                <Square className="h-3 w-3 fill-current" aria-hidden="true" />
                <span>{cancelRequested ? 'Cancellation requested' : 'Stop run'}</span>
              </Button>
            ) : (
              <Button
                type="submit"
                size="sm"
                data-testid="bh-send-btn"
                disabled={composerBlocked || !draftText.trim()}
                aria-label="Send"
                className="gap-1.5 rounded-full px-3 text-xs"
              >
                {isActing ? (
                  <Spinner className="h-3.5 w-3.5" />
                ) : (
                  <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                <span>Send</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </ComposerFrame>
  );

  const addedChatValue = useMemo(
    () => ({
      conversation: null,
      setConversation: noop,
      generateConversation: () => syntheticConversation,
    }),
    [syntheticConversation],
  );

  return (
    <ChatContext.Provider value={chatContextValue}>
      <AddedChatContext.Provider value={addedChatValue}>
        <ApprovalProvider pendingAction={null}>
          <AppChatSurface>
            <EditorProvider>
              <main
                className="@container bg-surface-canvas flex h-full min-h-0 w-full flex-col overflow-hidden"
                role="main"
                data-testid="bh-chat-route"
              >
                <MessageSurfaceContext.Provider value="bg-surface-canvas">
                  <ChatScreen
                    index={0}
                    conversationId={activeConversationId ?? Constants.NEW_CONVO}
                    messages={activeConversationId ? messages : null}
                    isLoading={Boolean(
                      activeConversationId && stateQuery.isLoading && messages.length === 0,
                    )}
                    landingFooter={false}
                    configuredFooter={false}
                    renderHeader={() => (
                      <>
                        {headerSlot}
                        {banners}
                      </>
                    )}
                    renderMessages={renderMessages}
                    landing={landingView}
                    renderColumn={(column) => (
                      <OwnerTextProvider
                        messages={activeConversationId ? messages : null}
                        conversationId={activeConversationId ?? Constants.NEW_CONVO}
                        isSubmitting={activeRunId !== null}
                      >
                        {column}
                      </OwnerTextProvider>
                    )}
                    renderComposer={() => composerSlot}
                  />
                </MessageSurfaceContext.Provider>
              </main>
            </EditorProvider>
          </AppChatSurface>
        </ApprovalProvider>
      </AddedChatContext.Provider>
    </ChatContext.Provider>
  );
});

export default BioHarnessChatRoute;
