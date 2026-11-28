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
  ModelOverride,
  NewScopeSelection,
  NowData,
  RunStrategyOption,
  Snapshot,
  TreeData,
  WorkspaceInputFile,
  WorkspaceInputsResponse,
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
  extractTreeProjects,
  extractTreeScopes,
  fetchConversationState,
  fetchView,
  fetchWorkspaceInputs,
  startRun,
  uploadWorkspaceInput,
} from './bioharness';
import { formatBytes, useBhText } from './i18n';
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

  const { tr } = useBhText();
  const {
    meta,
    service,
    workspace,
    selectedRequestId,
    selectedScopeId: workspaceScopeId,
    branchSource,
    setBranchSource,
    pendingScopeDraft,
    setPendingScopeDraft,
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

  const scopes = useMemo(() => {
    const direct = extractTreeScopes(treeQuery.data);
    const base = direct.length > 0 ? direct : extractTreeProjects(treeQuery.data);
    if (workspaceScopeId && !base.some((s) => s.scope_id === workspaceScopeId)) {
      return [{ scope_id: workspaceScopeId, title: workspaceScopeId }, ...base];
    }
    return base;
  }, [treeQuery.data, workspaceScopeId]);
  const [scopeMode, setScopeMode] = useState<'none' | 'existing' | 'new'>('none');
  const [selectedScopeId, setSelectedScopeId] = useState('');
  const [newScopeId, setNewScopeId] = useState('');
  const [parentScopeId, setParentScopeId] = useState('');
  const [selectedModelOverride, setSelectedModelOverride] = useState<ModelOverride | null>(null);
  const [selectedStrategy, setSelectedStrategy] = useState<RunStrategyOption['id']>('standard');
  const [attachedInputs, setAttachedInputs] = useState<WorkspaceInputFile[]>([]);
  const [uploadingInput, setUploadingInput] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [inputsDrawerOpen, setInputsDrawerOpen] = useState(false);

  const inputsQuery = useQuery<WorkspaceInputsResponse>({
    queryKey: bhKeys.inputs(service ?? 'svc', workspace ?? ''),
    queryFn: () => fetchWorkspaceInputs(workspace!),
    enabled: Boolean(service && workspace && inputsDrawerOpen),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    setScopeMode('none');
    setSelectedScopeId('');
    setNewScopeId('');
    setParentScopeId('');
    setAttachedInputs([]);
    setUploadError(null);
  }, [workspace]);

  useEffect(() => {
    if (!isNew || selectedRequestId || !pendingScopeDraft) {
      return;
    }
    setScopeMode(pendingScopeDraft.mode);
    if (pendingScopeDraft.mode === 'existing' && pendingScopeDraft.scopeId) {
      setSelectedScopeId(pendingScopeDraft.scopeId);
    } else if (pendingScopeDraft.mode === 'new') {
      setNewScopeId(pendingScopeDraft.scopeId ?? '');
      setParentScopeId(pendingScopeDraft.parentId ?? '');
    }
    setPendingScopeDraft?.(null);
  }, [isNew, selectedRequestId, pendingScopeDraft, setPendingScopeDraft]);

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
      return tr('请选择一个已有科研项目，或切换为独立问题。', 'Choose an existing scope or switch to No scope.');
    }
    if (scopeMode === 'new' && !newScopeId.trim()) {
      return tr('请输入新项目/子项目标识（如 PPGR），或切换为独立问题。', 'Enter a new scope ID or switch to No scope.');
    }
    return null;
  }, [isNew, selectedRequestId, scopeMode, selectedScopeId, newScopeId, tr]);

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

  const handleUploadFile = useCallback(
    async (file: File) => {
      if (!workspace || !service) {
        return;
      }
      setUploadingInput(true);
      setUploadError(null);
      try {
        const activeScope =
          scopeMode === 'existing'
            ? selectedScopeId || undefined
            : scopeMode === 'new'
              ? newScopeId.trim() || parentScopeId || undefined
              : workspaceScopeId || undefined;
        const uploaded = await uploadWorkspaceInput(workspace, file, activeScope);
        setAttachedInputs((prev) =>
          prev.some((item) => item.server_path === uploaded.server_path) ? prev : [...prev, uploaded],
        );
        void queryClient.invalidateQueries({ queryKey: bhKeys.inputs(service, workspace) });
      } catch (err) {
        if (err instanceof BioHarnessApiError) {
          setUploadError(`${err.code}: ${err.message}`);
        } else {
          setUploadError((err as Error)?.message || tr('上传失败，请重试。', 'Upload failed.'));
        }
      } finally {
        setUploadingInput(false);
      }
    },
    [workspace, service, scopeMode, selectedScopeId, newScopeId, parentScopeId, workspaceScopeId, queryClient, tr],
  );

  const handleSubmitText = useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault();
      if (composerBlocked || !workspace || !service || !draftText.trim()) {
        return;
      }
      const inputLines =
        attachedInputs.length > 0
          ? '\n\n[附带研究资料引用（未核验原始输入）]\n' +
            attachedInputs
              .map(
                (item) =>
                  `- ${item.server_path} (${formatBytes(item.bytes)}${item.sha256 ? `, sha256=${item.sha256}` : ''})`,
              )
              .join('\n')
          : '';
      const verbatimText = draftText + inputLines;
      const runOpts = {
        ...(selectedModelOverride ? { model_override: selectedModelOverride } : {}),
        ...(selectedStrategy !== 'standard' ? { strategy: selectedStrategy } : {}),
      };
      if (!activeConversationId) {
        let scope: NewScopeSelection | undefined;
        if (scopeMode === 'existing') {
          scope = { id: selectedScopeId };
        } else if (scopeMode === 'new') {
          scope = {
            id: newScopeId.trim(),
            create: true,
            ...(parentScopeId ? { parent_id: parentScopeId } : {}),
          };
        }
        const created = await runAction(() =>
          createConversation(workspace, {
            text: verbatimText,
            ...(scope ? { scope } : {}),
            ...runOpts,
          }),
        );
        if (created) {
          clearDraft(draftKey);
          setAttachedInputs([]);
          setBranchSource(null);
          void queryClient.invalidateQueries({ queryKey: bhKeys.conversations(service, workspace) });
          void queryClient.invalidateQueries({ queryKey: bhKeys.viewRoot(service, workspace) });
          openConversation(created.conversation.id, { requestId: created.conversation.request_id });
        }
      } else {
        const res = await runAction(() =>
          startRun(workspace, activeConversationId, verbatimText, runOpts),
        );
        if (res) {
          clearDraft(draftKey);
          setAttachedInputs([]);
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
      attachedInputs,
      selectedModelOverride,
      selectedStrategy,
      activeConversationId,
      scopeMode,
      selectedScopeId,
      newScopeId,
      parentScopeId,
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
    ? tr('原生模型运行时未启用 — 请前往“设置 → 模型配置”完成服务端模型配置', 'Native model runtime is not enabled — configure a model in Settings → Models')
    : isDelivered
      ? tr('该科研请求已交付 — 请新建科研问题开展后续探索', 'This request is delivered — start a new research question for follow-up work')
      : isUnknownBegin
        ? tr('请先完成上方的请求核对与绑定，再发送新消息', 'Reconcile the request binding above before sending another message')
        : needsExplicitRequestStart
          ? tr('请先点击上方按钮为所选科研请求开启对话', 'Start a conversation for the selected request above first')
          : activeConversationId
            ? tr('继续回复，或按 Core 提示输入精确确认指令…', 'Reply, or send the exact Core confirmation phrase…')
            : tr('输入您的真实科学问题（将原样提交给 BioHarness Core）…', 'Enter your scientific question (sent verbatim to Core)…');

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
        {tr('BioHarness 科研工作台', 'BioHarness Research Workspace')}
      </h2>
      <p className="text-text-secondary mt-2 max-w-lg text-sm leading-relaxed">
        {runtimeEnabled
          ? tr(
              '在下方输入真实科学问题以开启研究或建立科研项目；也可点击“资料”附带小型 CSV/TSV/FASTA/PDF 或引用服务器授权数据。',
              'Submit a scientific question verbatim to BioHarness Core, or select an existing workspace conversation or open request from the sidebar.',
            )
          : tr(
              '当前原生模型运行时未启用。请前往“设置 → 模型配置”查看服务配置，或从左侧边栏浏览已有科研项目与请求。',
              'Native model runtime is not currently enabled. Open Settings → Models to configure a provider, or inspect workspace state from the sidebar.',
            )}
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
                          parentScopeId={parentScopeId}
                          onParentScopeIdChange={setParentScopeId}
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
                      availableModels={meta?.runtime?.available_models ?? []}
                      selectedModelOverride={selectedModelOverride}
                      onSelectModelOverride={setSelectedModelOverride}
                      strategies={meta?.runtime?.strategies ?? []}
                      selectedStrategy={selectedStrategy}
                      onSelectStrategy={setSelectedStrategy}
                      inputsState={inputsQuery.data ?? null}
                      inputsLoading={inputsQuery.isLoading}
                      attachedInputs={attachedInputs}
                      onAttachInput={(item) =>
                        setAttachedInputs((prev) =>
                          prev.some((x) => x.server_path === item.server_path) ? prev : [...prev, item],
                        )
                      }
                      onRemoveAttachedInput={(serverPath) =>
                        setAttachedInputs((prev) => prev.filter((x) => x.server_path !== serverPath))
                      }
                      onUploadFile={handleUploadFile}
                      uploadingInput={uploadingInput}
                      uploadError={uploadError}
                      onClearUploadError={() => setUploadError(null)}
                      onInputsDrawerOpenChange={setInputsDrawerOpen}
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
