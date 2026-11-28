/**
 * Evidence list & full-content detail route seated inside LibreChat's adopted shell
 * (not upstream LibreChat code).
 *
 * - List view: LibreChat's `@librechat/client` Table components over actual request-level
 *   recorded Governance references.
 * - Detail view (replaces list, one primary content area): dispatches by verified type to
 *   PDF.js v6.5.438, AG Grid Community 36.2.0, LibreChat ImagePreview, DOMPurify 3.4.17
 *   sandboxed HTML iframe, self-hosted read-only Monaco code/text viewer, or honest
 *   unsupported-format / drift disclosure.
 */
import React, { lazy, memo, Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import DOMPurify from 'dompurify';
import { AlertTriangle, ArrowLeft, Check, Copy, FileText, ShieldAlert } from 'lucide-react';
import {
  Button,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@librechat/client';
import { ImagePreview } from '@librechat/chat/components';
import type {
  ContextData,
  EvidenceAnchor,
  EvidencePreviewResponse,
  NowData,
  Snapshot,
  TreeData,
  WorkspaceConversation,
} from './bioharness';
import {
  bhKeys,
  classifyEvidenceFormat,
  collectRequestEvidenceRefs,
  evidenceAnchorKey,
  evidenceContentUrl,
  fetchConversations,
  fetchEvidencePreview,
  fetchView,
} from './bioharness';
import { hostFetch } from './gate';
import { useBioHarnessVersionStream } from './events';
import { useBioHarnessWorkspace } from './workspace';
import { matchesSnapshot, resolveBoundConversation, useScientificRoutePages } from './scientificViews';
import BioHarnessRequestHeader from './BioHarnessRequestHeader';
import BioHarnessPdfViewer from './BioHarnessPdfViewer';

const BioHarnessEvidenceTable = lazy(() => import('./BioHarnessEvidenceTable'));
const BioHarnessEvidenceCodeViewer = lazy(() => import('./BioHarnessEvidenceCodeViewer'));

function basenameOf(pathOrSource: string | undefined): string {
  if (!pathOrSource) return 'evidence';
  const parts = pathOrSource.split('/');
  return parts[parts.length - 1] || pathOrSource;
}

const VerifiedImageViewer = memo(function VerifiedImageViewer({
  workspace,
  anchor,
  alt,
}: {
  workspace: string;
  anchor: EvidenceAnchor;
  alt: string;
}) {
  const url = evidenceContentUrl(workspace, anchor);
  const [status, setStatus] = useState<'checking' | 'ready' | 'blocked'>('checking');
  const [reason, setReason] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    setStatus('checking');
    void hostFetch(url, { method: 'HEAD' })
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setStatus('ready');
        } else {
          setStatus('blocked');
          setReason(`Image verification refused (HTTP ${res.status})`);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setStatus('blocked');
          setReason((err as Error)?.message || 'Image verification failed');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (status === 'checking') {
    return (
      <div className="text-text-secondary flex items-center gap-2 py-8 text-sm">
        <Spinner className="h-4 w-4" />
        <span>Verifying image SHA-256 identity…</span>
      </div>
    );
  }
  if (status === 'blocked') {
    return (
      <div
        role="alert"
        data-testid="bh-image-blocked"
        className="rounded-xl border border-amber-400/70 bg-amber-50/90 p-4 text-xs text-amber-950"
      >
        {reason}
      </div>
    );
  }
  return (
    <div
      data-testid="bh-image-viewer"
      className="border-border-light bg-surface-primary flex flex-col items-center gap-3 rounded-xl border p-4"
    >
      <ImagePreview url={url} alt={alt} className="max-h-[520px] max-w-full" />
      <p className="text-text-tertiary text-[11px]">
        SHA-256 verified image rendered via LibreChat ImagePreview.
      </p>
    </div>
  );
});

const SandboxedHtmlViewer = memo(function SandboxedHtmlViewer({
  content,
  title,
}: {
  content: string;
  title: string;
}) {
  const [showSource, setShowSource] = useState(false);
  const sanitizedDoc = useMemo(() => {
    const cleanBody = DOMPurify.sanitize(content, {
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'base', 'meta'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus'],
    });
    return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;padding:16px;line-height:1.5;color:#111;background:#fff;}</style></head><body>${cleanBody}</body></html>`;
  }, [content]);

  return (
    <div className="space-y-2" data-testid="bh-html-viewer">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-text-tertiary">
          DOMPurify 3.4.17 sanitized · isolated inside <code>&lt;iframe sandbox=&quot;&quot;&gt;</code> (scripts &amp; app origin blocked)
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowSource((v) => !v)}
          className="text-xs"
        >
          {showSource ? 'Show sandboxed preview' : 'Inspect source'}
        </Button>
      </div>
      {showSource ? (
        <pre className="border-border-light bg-surface-secondary max-h-[520px] overflow-auto rounded-xl border p-3 font-mono text-xs whitespace-pre-wrap">
          {content}
        </pre>
      ) : (
        <iframe
          sandbox=""
          srcDoc={sanitizedDoc}
          title={`Sandboxed HTML evidence: ${title}`}
          data-testid="bh-html-sandbox-iframe"
          className="border-border-light h-[540px] w-full rounded-xl border bg-white"
        />
      )}
    </div>
  );
});

const BioHarnessEvidenceRoute = memo(function BioHarnessEvidenceRoute() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { meta, service, workspace, selectedRequestId, linkedConversationId } =
    useBioHarnessWorkspace();

  const runtimeEnabled = meta?.runtime?.enabled === true;
  const [copiedSha, setCopiedSha] = useState<string | null>(null);

  const subParam = searchParams.get('sub');
  const evParam = searchParams.get('ev');
  const shaParam = searchParams.get('sha');
  const activeAnchor: EvidenceAnchor | null = useMemo(() => {
    if (!selectedRequestId || subParam === null || !evParam || !shaParam) {
      return null;
    }
    const submissionIndex = Number(subParam);
    if (!Number.isInteger(submissionIndex) || submissionIndex < 0) {
      return null;
    }
    return {
      request_id: selectedRequestId,
      submission_index: submissionIndex,
      evidence_id: evParam,
      sha256: shaParam,
    };
  }, [selectedRequestId, subParam, evParam, shaParam]);

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

  const treeQuery = useQuery<Snapshot<TreeData>>({
    queryKey: bhKeys.view(service ?? 'svc', workspace ?? '', 'tree', {
      request_id: selectedRequestId ?? undefined,
    }),
    queryFn: () =>
      fetchView<TreeData>(workspace!, 'tree', selectedRequestId ? { request_id: selectedRequestId } : {}),
    enabled: Boolean(service && workspace && selectedRequestId),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  const selectedNow = matchesSnapshot(nowQuery.data, service, workspace) &&
    nowQuery.data.ok && nowQuery.data.data?.request_id === selectedRequestId ? nowQuery.data.data : null;
  const selectedTree = matchesSnapshot(treeQuery.data, service, workspace) &&
    treeQuery.data.ok ? treeQuery.data.data : null;
  const treeBinding = selectedTree?.request_binding;
  const effectiveScopeId =
    (typeof selectedNow?.scope_context?.scope_id === 'string' ? selectedNow.scope_context.scope_id : null) ??
    (treeBinding?.request_id === selectedRequestId ? treeBinding.scope_id ?? null : null);
  const routesQuery = useScientificRoutePages(service, workspace, effectiveScopeId,
    Boolean(selectedRequestId));

  const contextQuery = useQuery<Snapshot<ContextData>>({
    queryKey: bhKeys.view(service ?? 'svc', workspace ?? '', 'context', {
      scope_id: effectiveScopeId ?? undefined,
      request_id: selectedRequestId ?? undefined,
    }),
    queryFn: () =>
      fetchView<ContextData>(workspace!, 'context', {
        scope_id: effectiveScopeId!,
        request_id: selectedRequestId ?? undefined,
      }),
    enabled: Boolean(service && workspace && effectiveScopeId),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  const selectedContext = matchesSnapshot(contextQuery.data, service, workspace) &&
    contextQuery.data.ok ? contextQuery.data.data : null;
  const evidenceRefs = collectRequestEvidenceRefs(selectedRequestId, routesQuery.routesData,
    selectedContext, selectedTree);
  const evidenceReadUnavailable = Boolean(routesQuery.isError || contextQuery.isError || treeQuery.isError ||
    (contextQuery.data && !selectedContext) || (treeQuery.data && !selectedTree));
  const completeEvidenceHistory = Boolean(effectiveScopeId && routesQuery.confirmed && !evidenceReadUnavailable);

  const activeRefMeta = useMemo(() => {
    if (!activeAnchor) return null;
    const key = evidenceAnchorKey(activeAnchor);
    return evidenceRefs.find((r) => evidenceAnchorKey(r) === key) ?? null;
  }, [activeAnchor, evidenceRefs]);

  const previewQuery = useQuery<EvidencePreviewResponse>({
    queryKey: activeAnchor
      ? bhKeys.evidencePreview(service ?? 'svc', workspace ?? '', activeAnchor)
      : ['bh', 'evidence-preview', 'idle'],
    queryFn: () => fetchEvidencePreview(workspace!, activeAnchor!),
    enabled: Boolean(service && workspace && activeAnchor),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const openEvidence = (anchor: EvidenceAnchor) => {
    const next = new URLSearchParams(searchParams);
    next.set('sub', String(anchor.submission_index));
    next.set('ev', anchor.evidence_id);
    next.set('sha', anchor.sha256);
    setSearchParams(next);
  };

  const backToList = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('sub');
    next.delete('ev');
    next.delete('sha');
    setSearchParams(next);
  };

  const copySha = async (sha: string) => {
    try {
      await navigator.clipboard.writeText(sha);
      setCopiedSha(sha);
      window.setTimeout(() => setCopiedSha(null), 1500);
    } catch {
      /* ignore clipboard error */
    }
  };

  const preview = previewQuery.data?.ok ? previewQuery.data.preview : undefined;
  const displayName = preview?.name ?? basenameOf(activeRefMeta?.source) ?? activeAnchor?.evidence_id ?? 'evidence';
  const displayKind = preview?.kind ?? activeRefMeta?.kind ?? 'file';
  const formatKind = classifyEvidenceFormat(displayName, displayKind);

  const changedWarnings =
    selectedNow && Array.isArray(selectedNow.evidence_changed_since_submission)
      ? selectedNow.evidence_changed_since_submission!
      : [];

  return (
    <main
      className="bg-surface-canvas flex h-full min-h-0 w-full flex-col overflow-hidden"
      role="main"
      data-testid="bh-evidence-route"
    >
      <BioHarnessRequestHeader
        activeTab="evidence"
        requestId={selectedRequestId}
        conversationId={resolvedConversationId}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {bindingProblem && <p role="alert" className="p-3 text-xs">
          The conversation link is not verified for this request. Choose the correct conversation
          from the sidebar; recorded evidence remains independently inspectable.
        </p>}
        <div className="mx-auto w-full max-w-5xl space-y-4">
          {!selectedRequestId ? (
            <div
              data-testid="bh-evidence-no-request"
              className="border-border-light bg-surface-primary/60 rounded-xl border p-6 text-center text-sm"
            >
              Select a research request from the sidebar to view its recorded evidence.
            </div>
          ) : activeAnchor && service && workspace ? (
            /* Full-content Single-Evidence Detail View (replaces list) */
            <section data-testid="bh-evidence-detail" className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid="bh-back-to-evidence-btn"
                  onClick={backToList}
                  className="gap-1.5 text-xs"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Back to evidence list</span>
                </Button>

                <button
                  type="button"
                  onClick={() => void copySha(activeAnchor.sha256)}
                  className="text-text-tertiary hover:text-text-primary inline-flex items-center gap-1 font-mono text-[11px]"
                  title="Copy recorded SHA-256"
                >
                  {copiedSha === activeAnchor.sha256 ? (
                    <Check className="h-3 w-3" aria-hidden="true" />
                  ) : (
                    <Copy className="h-3 w-3" aria-hidden="true" />
                  )}
                  <span>sha256:{activeAnchor.sha256.slice(0, 16)}…</span>
                </button>
              </div>

              {/* Provenance & Integrity Banner */}
              <div
                data-testid="bh-evidence-integrity-bar"
                className="border-border-light bg-surface-primary flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-xs"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-text-primary truncate font-mono text-sm font-semibold">
                      {displayName}
                    </h1>
                    <span className="bg-surface-hover text-text-secondary rounded px-1.5 py-0.5 text-[10px]">
                      {activeAnchor.evidence_id} · sub #{activeAnchor.submission_index}
                    </span>
                    <span className="bg-surface-hover text-text-secondary rounded px-1.5 py-0.5 text-[10px]">
                      {displayKind}
                    </span>
                  </div>
                  {previewQuery.data?.source_note && (
                    <p className="text-text-tertiary mt-0.5 text-[11px]">
                      {previewQuery.data.source_note}
                    </p>
                  )}
                </div>

                {preview && (
                  <span
                    data-testid="bh-evidence-identity-badge"
                    className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium ${
                      preview.current_file_identity === 'MATCHES_RECORD'
                        ? 'bg-teal-500/15 text-teal-700 dark:text-teal-300'
                        : preview.current_file_identity === 'DIFFERS_FROM_RECORD'
                          ? 'bg-amber-500/20 text-amber-800 dark:text-amber-200'
                          : 'bg-surface-hover text-text-secondary'
                    }`}
                  >
                    {preview.current_file_identity}
                  </span>
                )}
              </div>

              {preview?.current_file_identity === 'DIFFERS_FROM_RECORD' && (
                <div
                  role="alert"
                  data-testid="bh-evidence-drift-banner"
                  className="flex items-start gap-2 rounded-xl border border-amber-400/70 bg-amber-50/90 p-3 text-xs text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
                >
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="font-semibold">
                      Current file differs from the recorded SHA-256 snapshot (DIFFERS_FROM_RECORD).
                    </p>
                    <p className="mt-0.5 opacity-90">
                      BioHarness does not present drifted bytes as the recorded version in structured
                      or document viewers. This affects only the preview, not the research run.
                      If the version difference changes scientific choices, discuss it with the user.
                    </p>
                  </div>
                </div>
              )}

              {/* Viewer dispatch */}
              {previewQuery.isLoading ? (
                <div className="text-text-secondary flex items-center gap-2 py-8 text-sm">
                  <Spinner className="h-4 w-4" />
                  <span>Resolving recorded evidence anchor via Governance…</span>
                </div>
              ) : previewQuery.isError || (previewQuery.data && !previewQuery.data.ok) ? (
                <div
                  role="alert"
                  data-testid="bh-evidence-resolve-error"
                  className="border-status-error-border bg-status-error-subtle rounded-xl border p-4 text-xs"
                >
                  {(previewQuery.error as Error)?.message ||
                    previewQuery.data?.error?.message ||
                    'Governance could not resolve this recorded evidence anchor.'}
                </div>
              ) : formatKind === 'pdf' ? (
                <BioHarnessPdfViewer key={JSON.stringify([service, workspace, activeAnchor])} workspace={workspace} anchor={activeAnchor} title={displayName} />
              ) : formatKind === 'table' ? (
                <Suspense
                  fallback={
                    <div className="text-text-secondary flex items-center gap-2 py-8 text-sm">
                      <Spinner className="h-4 w-4" />
                      <span>Loading AG Grid table viewer…</span>
                    </div>
                  }
                >
                  <BioHarnessEvidenceTable
                    key={JSON.stringify([service, workspace, activeAnchor])}
                    service={service}
                    workspace={workspace}
                    anchor={activeAnchor}
                  />
                </Suspense>
              ) : formatKind === 'image' ? (
                <VerifiedImageViewer key={JSON.stringify([service, workspace, activeAnchor])} workspace={workspace} anchor={activeAnchor} alt={displayName} />
              ) : formatKind === 'html' && preview?.content_available && preview.content !== null ? (
                preview.current_file_identity === 'DIFFERS_FROM_RECORD' ? (
                  <div
                    role="alert"
                    data-testid="bh-html-drift-blocked"
                    className="rounded-xl border border-amber-400/70 bg-amber-50/90 p-4 text-xs text-amber-950"
                  >
                    Refusing to render drifted HTML content as the recorded snapshot.
                  </div>
                ) : (
                  <SandboxedHtmlViewer content={preview.content} title={displayName} />
                )
              ) : formatKind === 'code' && preview?.content_available && preview.content !== null ? (
                <div className="space-y-2">
                  {preview.truncated && (
                    <div
                      data-testid="bh-preview-truncated-notice"
                      className="border-border-light bg-surface-primary/60 text-text-secondary rounded-lg border px-3 py-1.5 text-xs"
                    >
                      Bounded text excerpt ({preview.size_bytes?.toLocaleString()} bytes total;
                      middle content omitted by server bound).
                    </div>
                  )}
                  <Suspense
                    fallback={
                      <pre className="border-border-light bg-surface-secondary max-h-[520px] overflow-auto rounded-xl border p-3 font-mono text-xs whitespace-pre-wrap">
                        {preview.content}
                      </pre>
                    }
                  >
                    <BioHarnessEvidenceCodeViewer
                      filename={displayName}
                      format={preview.format}
                      content={preview.content}
                    />
                  </Suspense>
                </div>
              ) : (
                /* Unsupported binary or text snapshot not exposed by public CLI */
                <div
                  role="status"
                  data-testid="bh-evidence-unsupported"
                  className="border-border-medium bg-surface-primary flex items-start gap-2.5 rounded-xl border p-4 text-xs"
                >
                  <AlertTriangle className="text-text-secondary mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <div>
                    <p className="text-text-primary font-semibold">
                      Preview unavailable for this evidence format
                    </p>
                    <p className="text-text-secondary mt-1">
                      Reason:{' '}
                      <code className="font-mono">
                        {preview?.unavailable_reason || 'UNSUPPORTED_MEDIA_FORMAT'}
                      </code>
                      . Recorded metadata and SHA-256 provenance remain visible above.
                    </p>
                  </div>
                </div>
              )}
            </section>
          ) : (
            /* Request-level Evidence List View (LibreChat Table) */
            <section className="space-y-3" aria-label="Recorded evidence list">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h1 className="text-text-primary flex items-center gap-1.5 text-base font-semibold">
                    <FileText className="h-4 w-4" aria-hidden="true" />
                    <span>Recorded evidence ({evidenceRefs.length})</span>
                  </h1>
                  <p className="text-text-tertiary text-xs">
                    Exact recorded references from Project Governance for request{' '}
                    <code className="font-mono">{selectedRequestId}</code>.
                  </p>
                </div>
              </div>

              {changedWarnings.length > 0 && (
                <div
                  role="alert"
                  data-testid="bh-evidence-changed-warning"
                  className="rounded-xl border border-amber-400/70 bg-amber-50/90 p-3 text-xs text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
                >
                  <div className="font-semibold">
                    Core reported files changed since submission:
                  </div>
                  <ul className="mt-1 list-disc pl-4 font-mono text-[11px]">
                    {changedWarnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {(!effectiveScopeId || evidenceReadUnavailable || routesQuery.partial) && (
                <p role="status" className="text-text-secondary text-xs">
                  {evidenceReadUnavailable ? 'Evidence sources are temporarily unavailable. ' :
                    !effectiveScopeId ? 'No verified scoped route history is available. ' :
                    'Route history is only partially loaded. '}
                  Loaded exact references remain available; incomplete reads do not establish absence.
                </p>
              )}
              {routesQuery.hasNextPage && (
                <Button type="button" variant="outline" size="sm" disabled={routesQuery.isFetching}
                  onClick={() => void routesQuery.fetchNextPage()}>
                  Load more recorded submissions
                </Button>
              )}
              {((routesQuery.isFetching && !routesQuery.routesData) || contextQuery.isFetching ||
                treeQuery.isFetching || nowQuery.isFetching) && evidenceRefs.length === 0 ? (
                <div className="text-text-secondary flex items-center gap-2 py-6 text-sm">
                  <Spinner className="h-4 w-4" />
                  <span>Loading recorded evidence references…</span>
                </div>
              ) : evidenceRefs.length === 0 ? (
                <div
                  data-testid="bh-evidence-empty-list"
                  className="border-border-light bg-surface-primary/60 text-text-secondary rounded-xl border p-6 text-center text-xs"
                >
                  {completeEvidenceHistory ? 'No recorded evidence references found for this request.' :
                    'No references in the available records; complete history has not been confirmed.'}
                </div>
              ) : (
                <div className="border-border-light bg-surface-primary overflow-hidden rounded-xl border">
                  <Table data-testid="bh-evidence-table-list">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Evidence ID</TableHead>
                        <TableHead>File / Source</TableHead>
                        <TableHead>Kind</TableHead>
                        <TableHead>Step / Sub</TableHead>
                        <TableHead>Recorded SHA-256</TableHead>
                        <TableHead className="text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {evidenceRefs.map((ref) => {
                        const key = evidenceAnchorKey(ref);
                        const name = basenameOf(ref.source);
                        return (
                          <TableRow key={key} data-testid={`bh-evidence-row-${ref.evidence_id}`}>
                            <TableCell className="font-mono text-xs font-medium">
                              {ref.evidence_id}
                            </TableCell>
                            <TableCell className="max-w-[260px] truncate text-xs" title={ref.source}>
                              {name}
                            </TableCell>
                            <TableCell className="text-text-secondary text-xs">
                              {ref.kind ?? 'file'}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {ref.step_id ? `${ref.step_id} / ` : ''}#{ref.submission_index}
                            </TableCell>
                            <TableCell className="text-text-tertiary font-mono text-[11px]">
                              {ref.sha256.slice(0, 12)}…
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                data-testid={`bh-open-evidence-${ref.evidence_id}`}
                                onClick={() =>
                                  openEvidence({
                                    request_id: ref.request_id,
                                    submission_index: ref.submission_index,
                                    evidence_id: ref.evidence_id,
                                    sha256: ref.sha256,
                                  })
                                }
                                className="text-xs"
                              >
                                Open
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </main>
  );
});

export default BioHarnessEvidenceRoute;
