/**
 * Explicit BioHarness service/workspace/request/scope/conversation identity and unsent draft preservation
 * (not upstream LibreChat code).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { atom, useSetAtom } from 'jotai';
import { Constants } from 'librechat-data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import type { BioHarnessMeta, EvidenceAnchor } from './bioharness';
import { bhKeys, fetchMeta } from './bioharness';

export const settingsRequestedTabAtom = atom<string | null>(null);

export interface BranchSourceRef {
  requestId: string;
  scopeId: string | null;
}

export interface PendingScopeDraft {
  mode: 'none' | 'existing' | 'new';
  scopeId?: string;
  parentId?: string;
}

export interface BioHarnessWorkspaceContextValue {
  meta: BioHarnessMeta | undefined;
  metaLoading: boolean;
  metaError: unknown;
  service: string | null;
  workspaces: string[];
  workspace: string | null;
  selectedRequestId: string | null;
  selectedScopeId: string | null;
  linkedConversationId: string | null;
  branchSource: BranchSourceRef | null;
  setBranchSource: (next: BranchSourceRef | null) => void;
  pendingScopeDraft: PendingScopeDraft | null;
  setPendingScopeDraft: (next: PendingScopeDraft | null) => void;
  selectWorkspace: (ws: string) => void;
  selectScope: (scopeId: string | null) => void;
  openConversation: (conversationId: string, opts?: { requestId?: string | null; scopeId?: string | null }) => void;
  openNewResearch: (opts?: {
    requestId?: string | null;
    scopeId?: string | null;
    branchSource?: BranchSourceRef | null;
    scopeDraft?: PendingScopeDraft | null;
  }) => void;
  openWorkflowView: (opts?: { requestId?: string | null; conversationId?: string | null; stepId?: string | null; scopeId?: string | null }) => void;
  openEvidenceView: (opts?: { requestId?: string | null; conversationId?: string | null; anchor?: EvidenceAnchor | null; scopeId?: string | null }) => void;
  openExecutionsView: (opts?: { requestId?: string | null; conversationId?: string | null; scopeId?: string | null }) => void;
  openCapabilitiesView: (opts?: {
    requestId?: string | null;
    conversationId?: string | null;
    scopeId?: string | null;
    tab?: 'memory' | 'capabilities' | 'documents' | 'modules';
  }) => void;
  stageTextInConversation: (opts: { conversationId: string | null; requestId: string | null; snippet: string }) => void;
  getDraft: (conversationKey: string) => string;
  setDraft: (conversationKey: string, text: string) => void;
  clearDraft: (conversationKey: string) => void;
  openModelSettings: () => void;
  openCapabilitiesSettings: (tab?: 'skills' | 'bhMemory' | 'modules' | 'diagnostics') => void;
}

const BioHarnessWorkspaceContext = createContext<BioHarnessWorkspaceContextValue | null>(null);

const DRAFT_PREFIX = 'bh:draft:v1:';

function readStoredDraft(storageKey: string): string {
  try {
    return window.sessionStorage.getItem(DRAFT_PREFIX + storageKey) ?? '';
  } catch {
    return '';
  }
}

function writeStoredDraft(storageKey: string, text: string): void {
  try {
    if (text) {
      window.sessionStorage.setItem(DRAFT_PREFIX + storageKey, text);
    } else {
      window.sessionStorage.removeItem(DRAFT_PREFIX + storageKey);
    }
  } catch {
    /* ignore storage quota/privacy restrictions */
  }
}

function extractRouteConversationId(pathname: string): string | null {
  const match = pathname.match(/^\/c\/([^/]+)/);
  if (!match) {
    return null;
  }
  const id = decodeURIComponent(match[1]);
  return id && id !== Constants.NEW_CONVO ? id : null;
}

export function BioHarnessWorkspaceProvider({
  children,
  onOpenSettings,
}: {
  children: React.ReactNode;
  onOpenSettings: () => void;
}) {
  const { isAuthenticated, user } = useAuthContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const setRequestedTab = useSetAtom(settingsRequestedTabAtom);

  const metaQuery = useQuery<BioHarnessMeta>({
    queryKey: bhKeys.meta(),
    queryFn: fetchMeta,
    enabled: isAuthenticated,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const meta = metaQuery.data;
  const service = meta?.service ?? user?.username ?? null;
  const workspaces = useMemo(() => meta?.workspaces ?? [], [meta?.workspaces]);

  const urlWs = searchParams.get('ws');
  const workspace = useMemo(() => {
    if (workspaces.length === 0) {
      return urlWs || null;
    }
    if (urlWs && workspaces.includes(urlWs)) {
      return urlWs;
    }
    return workspaces[0];
  }, [workspaces, urlWs]);

  const selectedRequestId = searchParams.get('req') || null;
  const selectedScopeId = searchParams.get('scope') || null;
  const linkedConversationId =
    extractRouteConversationId(location.pathname) ?? (searchParams.get('convo') || null);

  const [branchSource, setBranchSource] = useState<BranchSourceRef | null>(null);
  const [pendingScopeDraft, setPendingScopeDraft] = useState<PendingScopeDraft | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    if (
      !workspace ||
      urlWs === workspace ||
      !(location.pathname.startsWith('/c/') || location.pathname.startsWith('/w/'))
    ) {
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set('ws', workspace);
    setSearchParams(next, { replace: true });
  }, [workspace, urlWs, location.pathname, searchParams, setSearchParams]);

  const draftScopeKey = useCallback(
    (conversationKey: string) =>
      `${service ?? 'svc'}::${workspace ?? 'ws'}::${conversationKey || 'new'}`,
    [service, workspace],
  );

  const getDraft = useCallback(
    (conversationKey: string) => {
      const key = draftScopeKey(conversationKey);
      if (Object.prototype.hasOwnProperty.call(drafts, key)) {
        return drafts[key];
      }
      return readStoredDraft(key);
    },
    [draftScopeKey, drafts],
  );

  const setDraft = useCallback(
    (conversationKey: string, text: string) => {
      const key = draftScopeKey(conversationKey);
      writeStoredDraft(key, text);
      setDrafts((prev) => (prev[key] === text ? prev : { ...prev, [key]: text }));
    },
    [draftScopeKey],
  );

  const clearDraft = useCallback(
    (conversationKey: string) => {
      const key = draftScopeKey(conversationKey);
      writeStoredDraft(key, '');
      setDrafts((prev) => {
        if (!prev[key]) {
          return prev;
        }
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    [draftScopeKey],
  );

  const selectWorkspace = useCallback(
    (ws: string) => {
      if (!workspaces.includes(ws)) {
        return;
      }
      setBranchSource(null);
      const next = new URLSearchParams();
      next.set('ws', ws);
      navigate(`/c/new?${next.toString()}`);
    },
    [workspaces, navigate],
  );

  const selectScope = useCallback(
    (scopeId: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (workspace) {
        next.set('ws', workspace);
      }
      if (scopeId) {
        next.set('scope', scopeId);
      } else {
        next.delete('scope');
      }
      setSearchParams(next);
    },
    [searchParams, setSearchParams, workspace],
  );

  const openConversation = useCallback(
    (conversationId: string, opts?: { requestId?: string | null; scopeId?: string | null }) => {
      const next = new URLSearchParams();
      if (workspace) {
        next.set('ws', workspace);
      }
      if (opts?.requestId) {
        next.set('req', opts.requestId);
      }
      const sc = opts?.scopeId ?? selectedScopeId;
      if (sc) {
        next.set('scope', sc);
      }
      const qs = next.toString();
      navigate(`/c/${encodeURIComponent(conversationId)}${qs ? `?${qs}` : ''}`);
    },
    [workspace, selectedScopeId, navigate],
  );

  const openNewResearch = useCallback(
    (opts?: {
      requestId?: string | null;
      scopeId?: string | null;
      branchSource?: BranchSourceRef | null;
      scopeDraft?: PendingScopeDraft | null;
    }) => {
      setBranchSource(opts?.branchSource ?? null);
      setPendingScopeDraft(opts?.scopeDraft ?? null);
      const next = new URLSearchParams();
      if (workspace) {
        next.set('ws', workspace);
      }
      if (opts?.requestId) {
        next.set('req', opts.requestId);
      }
      const sc = opts?.scopeId ?? opts?.branchSource?.scopeId ?? null;
      if (sc) {
        next.set('scope', sc);
      }
      const qs = next.toString();
      navigate(`/c/new${qs ? `?${qs}` : ''}`);
    },
    [workspace, navigate],
  );

  const openWorkflowView = useCallback(
    (opts?: { requestId?: string | null; conversationId?: string | null; stepId?: string | null; scopeId?: string | null }) => {
      const next = new URLSearchParams();
      if (workspace) {
        next.set('ws', workspace);
      }
      const req = opts?.requestId !== undefined ? opts.requestId : selectedRequestId;
      if (req) {
        next.set('req', req);
      }
      const convo = opts?.conversationId !== undefined ? opts.conversationId : linkedConversationId;
      if (convo) {
        next.set('convo', convo);
      }
      const sc = opts?.scopeId !== undefined ? opts.scopeId : selectedScopeId;
      if (sc) {
        next.set('scope', sc);
      }
      if (opts?.stepId) {
        next.set('step', opts.stepId);
      }
      navigate(`/w/workflow?${next.toString()}`);
    },
    [workspace, selectedRequestId, linkedConversationId, selectedScopeId, navigate],
  );

  const openEvidenceView = useCallback(
    (opts?: { requestId?: string | null; conversationId?: string | null; anchor?: EvidenceAnchor | null; scopeId?: string | null }) => {
      const next = new URLSearchParams();
      if (workspace) {
        next.set('ws', workspace);
      }
      const req = opts?.anchor?.request_id ?? (opts?.requestId !== undefined ? opts.requestId : selectedRequestId);
      if (req) {
        next.set('req', req);
      }
      const convo = opts?.conversationId !== undefined ? opts.conversationId : linkedConversationId;
      if (convo) {
        next.set('convo', convo);
      }
      const sc = opts?.scopeId !== undefined ? opts.scopeId : selectedScopeId;
      if (sc) {
        next.set('scope', sc);
      }
      if (opts?.anchor) {
        next.set('sub', String(opts.anchor.submission_index));
        next.set('ev', opts.anchor.evidence_id);
        next.set('sha', opts.anchor.sha256);
      }
      navigate(`/w/evidence?${next.toString()}`);
    },
    [workspace, selectedRequestId, linkedConversationId, selectedScopeId, navigate],
  );

  const openExecutionsView = useCallback(
    (opts?: { requestId?: string | null; conversationId?: string | null; scopeId?: string | null }) => {
      const next = new URLSearchParams();
      if (workspace) {
        next.set('ws', workspace);
      }
      const req = opts?.requestId !== undefined ? opts.requestId : selectedRequestId;
      if (req) {
        next.set('req', req);
      }
      const convo = opts?.conversationId !== undefined ? opts.conversationId : linkedConversationId;
      if (convo) {
        next.set('convo', convo);
      }
      const sc = opts?.scopeId !== undefined ? opts.scopeId : selectedScopeId;
      if (sc) {
        next.set('scope', sc);
      }
      navigate(`/w/executions?${next.toString()}`);
    },
    [workspace, selectedRequestId, linkedConversationId, selectedScopeId, navigate],
  );

  const stageTextInConversation = useCallback(
    ({
      conversationId,
      requestId,
      snippet,
    }: {
      conversationId: string | null;
      requestId: string | null;
      snippet: string;
    }) => {
      const targetKey = conversationId ?? (requestId ? `req:${requestId}` : 'new');
      const current = getDraft(targetKey);
      const nextText = current.trim() ? `${current.trimEnd()}
${snippet}` : snippet;
      setDraft(targetKey, nextText);
      if (conversationId) {
        openConversation(conversationId, { requestId });
      } else {
        openNewResearch({ requestId });
      }
    },
    [getDraft, setDraft, openConversation, openNewResearch],
  );

  const openCapabilitiesView = useCallback(
    (opts?: {
      requestId?: string | null;
      conversationId?: string | null;
      scopeId?: string | null;
      tab?: 'memory' | 'capabilities' | 'documents' | 'modules';
    }) => {
      const next = new URLSearchParams();
      if (workspace) {
        next.set('ws', workspace);
      }
      const req = opts?.requestId !== undefined ? opts.requestId : selectedRequestId;
      if (req) {
        next.set('req', req);
      }
      const convo = opts?.conversationId !== undefined ? opts.conversationId : linkedConversationId;
      if (convo) {
        next.set('convo', convo);
      }
      const sc = opts?.scopeId !== undefined ? opts.scopeId : selectedScopeId;
      if (sc) {
        next.set('scope', sc);
      }
      if (opts?.tab) {
        next.set('tab', opts.tab);
      }
      navigate(`/w/capabilities?${next.toString()}`);
    },
    [workspace, selectedRequestId, linkedConversationId, selectedScopeId, navigate],
  );

  const openModelSettings = useCallback(() => {
    setRequestedTab('models');
    onOpenSettings();
  }, [setRequestedTab, onOpenSettings]);

  const openCapabilitiesSettings = useCallback(
    (tab: 'skills' | 'bhMemory' | 'modules' | 'diagnostics' = 'bhMemory') => {
      setRequestedTab(tab);
      onOpenSettings();
    },
    [setRequestedTab, onOpenSettings],
  );

  const value = useMemo<BioHarnessWorkspaceContextValue>(
    () => ({
      meta,
      metaLoading: metaQuery.isLoading,
      metaError: metaQuery.error,
      service,
      workspaces,
      workspace,
      selectedRequestId,
      selectedScopeId,
      linkedConversationId,
      branchSource,
      setBranchSource,
      pendingScopeDraft,
      setPendingScopeDraft,
      selectWorkspace,
      selectScope,
      openConversation,
      openNewResearch,
      openWorkflowView,
      openEvidenceView,
      openExecutionsView,
      openCapabilitiesView,
      stageTextInConversation,
      getDraft,
      setDraft,
      clearDraft,
      openModelSettings,
      openCapabilitiesSettings,
    }),
    [
      meta,
      metaQuery.isLoading,
      metaQuery.error,
      service,
      workspaces,
      workspace,
      selectedRequestId,
      selectedScopeId,
      linkedConversationId,
      branchSource,
      pendingScopeDraft,
      selectWorkspace,
      selectScope,
      openConversation,
      openNewResearch,
      openWorkflowView,
      openEvidenceView,
      openExecutionsView,
      openCapabilitiesView,
      stageTextInConversation,
      getDraft,
      setDraft,
      clearDraft,
      openModelSettings,
      openCapabilitiesSettings,
    ],
  );

  return (
    <BioHarnessWorkspaceContext.Provider value={value}>
      {children}
    </BioHarnessWorkspaceContext.Provider>
  );
}

export function useBioHarnessWorkspace(): BioHarnessWorkspaceContextValue {
  const ctx = useContext(BioHarnessWorkspaceContext);
  if (!ctx) {
    throw new Error('useBioHarnessWorkspace must be used inside BioHarnessWorkspaceProvider');
  }
  return ctx;
}
