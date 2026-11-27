/**
 * BioHarness native vertical slice seated inside LibreChat's adopted ChatScreen, MessagesView,
 * Markdown renderer, and upstream Composer primitives (not upstream LibreChat code).
 */
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRecoilValue } from 'recoil';
import { Constants } from 'librechat-data-provider';
import type { TConversation, TMessage } from 'librechat-data-provider';
import { ChatScreen } from '@librechat/chat/components';
import { ChatContext } from '@librechat/chat/react';
import type { ChatContract } from '@librechat/chat/react';
import { AddedChatContext, EditorProvider } from '~/Providers';
import { MessageSurfaceContext } from '~/components/Chat/Messages/ui/surface';
import ApprovalProvider from '~/components/Chat/Messages/Content/ApprovalContext';
import { OwnerTextProvider } from '~/components/Chat/Messages/PrivateText';
import { preloadMessages, renderMessages } from '~/components/Chat/Messages/load';
import AppChatSurface from '~/components/Chat/Surface';
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
import BioHarnessChatBanners from './BioHarnessChatBanners';
import BioHarnessComposer from './BioHarnessComposer';
import BioHarnessRequestHeader from './BioHarnessRequestHeader';

const EMPTY_FILES = new Map();
const noop = () => undefined;

const BioHarnessChatRoute = memo(function BioHarnessChatRoute() {
  const { conversationId: rawParam } = useParams();
  const isNew = !rawParam || rawParam === Constants.NEW_CONVO;
  const activeConversationId = isNew ? null : rawParam;

  const queryClient = useQueryClient();
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
  } = useBioHarnessWorkspace();

  const runtimeEnabled = meta?.runtime?.enabled === true;
  const activeModel = meta?.runtime?.model ?? null;

  useEffect(() => {
    void preloadMessages().catch(() => undefined);
  }, []);

  const stateQuery = useQuery<ConversationStateResponse>({
    queryKey: bhKeys.conversation(service ?? 'svc', workspace ?? '', activeConversationId ?? ''),
    queryFn: () => fetchConversationState(workspace!, activeConversationId!),
    enabled: Boolean(service && workspace && activeConversationId && runtimeEnabled),
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });

  const log = useBioHarnessConversationEvents(
    service,
    runtimeEnabled ? workspace : null,
    runtimeEnabled ? activeConversationId : null,
  );

  const boundRequestId = stateQuery.data?.conversation.request_id ?? null;
  const effectiveRequestId = activeConversationId ? boundRequestId : selectedRequestId;

  useBioHarnessVersionStream(service, workspace, effectiveRequestId);

  const nowQuery = useQuery<Snapshot<NowData>>({
    queryKey: bhKeys.view(service ?? 'svc', workspace ?? '', 'now', {
      request_id: effectiveRequestId ?? undefined,
    }),
    queryFn: () => fetchView<NowData>(workspace!, 'now', { request_id: effectiveRequestId! }),
    enabled: Boolean(service && workspace && effectiveRequestId),
    staleTime: 10_000,
    refetchOnWindowFocus: false,
  });

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

  const [problem, setProblem] = useState<string | null>(null);
  const [isActing, setIsActing] = useState(false);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setProblem(null);
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

  /* Omit conversation.model so LibreChat's HeaderLabel never back-fills historical rows with activeModel. */
  const syntheticConversation: TConversation = useMemo(
    () => ({
      conversationId: activeConversationId ?? Constants.NEW_CONVO,
      title: effectiveRequestId ? `Request ${effectiveRequestId}` : 'New research',
      endpoint: BIOHARNESS_ENDPOINT,
      model: undefined,
      createdAt: stateQuery.data?.conversation.created_at ?? '',
      updatedAt: '',
    }),
    [activeConversationId, effectiveRequestId, stateQuery.data?.conversation.created_at],
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
      if (composerBlocked || !workspace || !service || !draftText.trim()) {
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
    <BioHarnessRequestHeader
      activeTab="conversation"
      requestId={effectiveRequestId}
      conversationId={activeConversationId}
      activeRunId={activeRunId}
      cancelRequested={cancelRequested}
      sseConnected={log.connected}
      showContinueFromCore={Boolean(
        activeConversationId && boundRequestId && !isDelivered && !activeRunId && runtimeEnabled,
      )}
      continueDisabled={isActing}
      onContinueFromCore={() => void handleContinueFromCore()}
    />
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
                        <BioHarnessChatBanners
                          problem={problem}
                          onDismissProblem={() => setProblem(null)}
                          stateError={
                            stateQuery.isError && activeConversationId
                              ? (stateQuery.error as Error)?.message || 'Failed to load conversation state.'
                              : null
                          }
                          needsExplicitRequestStart={needsExplicitRequestStart}
                          selectedRequestId={selectedRequestId}
                          runtimeEnabled={runtimeEnabled}
                          isActing={isActing}
                          onStartRequestConversation={() => void handleStartRequestConversation()}
                          stateData={stateQuery.data}
                          beginReconcile={beginReconcile}
                          onAttachRequest={(id) => void handleAttachRequest(id)}
                          nowData={nowData}
                          activeRunId={activeRunId}
                          onInsertIntoDraft={insertIntoDraft}
                          onBranchFromDelivered={(src) => openNewResearch({ branchSource: src })}
                          isNew={isNew}
                          branchSource={branchSource}
                          onClearBranchSource={() => setBranchSource(null)}
                          scopes={scopes}
                          scopeMode={scopeMode}
                          onScopeModeChange={setScopeMode}
                          selectedScopeId={selectedScopeId}
                          onSelectedScopeIdChange={setSelectedScopeId}
                          newScopeId={newScopeId}
                          onNewScopeIdChange={setNewScopeId}
                          scopeProblem={scopeProblem}
                        />
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
                    renderComposer={() => (
                      <BioHarnessComposer
                        textAreaRef={textAreaRef}
                        maximizeChatSpace={maximizeChatSpace}
                        enterToSend={enterToSend}
                        draftText={draftText}
                        onDraftChange={(val) => setDraft(draftKey, val)}
                        onSubmit={(e) => void handleSubmitText(e)}
                        onCancel={() => void handleCancel()}
                        placeholder={placeholder}
                        composerBlocked={composerBlocked}
                        isActing={isActing}
                        isNewConversation={!activeConversationId}
                        activeRunId={activeRunId}
                        cancelRequested={cancelRequested}
                        activeModel={activeModel}
                      />
                    )}
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
