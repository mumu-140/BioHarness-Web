/**
 * Explicit BioHarness service/workspace/request identity and unsent draft preservation
 * (not upstream LibreChat code).
 *
 * URL query parameters (`?ws=...&req=...`) carry explicit workspace/request selection so reload
 * and back/forward always restore the exact target. Unsent composer drafts are preserved in
 * sessionStorage scoped by service + workspace + conversation; transcripts and API keys are
 * never stored here.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { atom, useSetAtom } from 'jotai';
import { useAuthContext } from '~/hooks/AuthContext';
import type { BioHarnessMeta } from './bioharness';
import { bhKeys, fetchMeta } from './bioharness';

/** Controls opening LibreChat's adopted Settings dialog directly to a specific tab (e.g. models). */
export const settingsRequestedTabAtom = atom<string | null>(null);

export interface BranchSourceRef {
  requestId: string;
  scopeId: string | null;
}

export interface BioHarnessWorkspaceContextValue {
  meta: BioHarnessMeta | undefined;
  metaLoading: boolean;
  metaError: unknown;
  service: string | null;
  workspaces: string[];
  workspace: string | null;
  selectedRequestId: string | null;
  branchSource: BranchSourceRef | null;
  setBranchSource: (next: BranchSourceRef | null) => void;
  selectWorkspace: (ws: string) => void;
  openConversation: (conversationId: string, opts?: { requestId?: string | null }) => void;
  openNewResearch: (opts?: { requestId?: string | null; branchSource?: BranchSourceRef | null }) => void;
  getDraft: (conversationKey: string) => string;
  setDraft: (conversationKey: string, text: string) => void;
  clearDraft: (conversationKey: string) => void;
  openModelSettings: () => void;
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
  /* `user.username` already holds `meta.service` from session resume, preventing a frame-0 key mismatch on reload. */
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
  const [branchSource, setBranchSource] = useState<BranchSourceRef | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  /* Normalize `?ws=` into the URL when authenticated so reload & back/forward preserve workspace. */
  useEffect(() => {
    if (!workspace || urlWs === workspace || !location.pathname.startsWith('/c/')) {
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

  const openConversation = useCallback(
    (conversationId: string, opts?: { requestId?: string | null }) => {
      const next = new URLSearchParams();
      if (workspace) {
        next.set('ws', workspace);
      }
      if (opts?.requestId) {
        next.set('req', opts.requestId);
      }
      navigate(`/c/${encodeURIComponent(conversationId)}${next.toString() ? `?${next.toString()}` : ''}`);
    },
    [workspace, navigate],
  );

  const openNewResearch = useCallback(
    (opts?: { requestId?: string | null; branchSource?: BranchSourceRef | null }) => {
      setBranchSource(opts?.branchSource ?? null);
      const next = new URLSearchParams();
      if (workspace) {
        next.set('ws', workspace);
      }
      if (opts?.requestId) {
        next.set('req', opts.requestId);
      }
      navigate(`/c/new${next.toString() ? `?${next.toString()}` : ''}`);
    },
    [workspace, navigate],
  );

  const openModelSettings = useCallback(() => {
    setRequestedTab('models');
    onOpenSettings();
  }, [setRequestedTab, onOpenSettings]);

  const value = useMemo<BioHarnessWorkspaceContextValue>(
    () => ({
      meta,
      metaLoading: metaQuery.isLoading,
      metaError: metaQuery.error,
      service,
      workspaces,
      workspace,
      selectedRequestId,
      branchSource,
      setBranchSource,
      selectWorkspace,
      openConversation,
      openNewResearch,
      getDraft,
      setDraft,
      clearDraft,
      openModelSettings,
    }),
    [
      meta,
      metaQuery.isLoading,
      metaQuery.error,
      service,
      workspaces,
      workspace,
      selectedRequestId,
      branchSource,
      selectWorkspace,
      openConversation,
      openNewResearch,
      getDraft,
      setDraft,
      clearDraft,
      openModelSettings,
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
