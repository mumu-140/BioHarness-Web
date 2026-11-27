/**
 * Self-hosted Mozilla PDF.js v6.5.438 generic viewer host (not upstream LibreChat code).
 *
 * Pre-verifies content integrity via authenticated HEAD `/evidence-content` before mounting
 * `/pdfjs/web/viewer.html` so drifted (`409`), over-budget (`409`), or unavailable (`404`)
 * files surface explicit provenance disclosures instead of broken or drifted bytes.
 */
import React, { memo, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Spinner } from '@librechat/client';
import type { EvidenceAnchor } from './bioharness';
import { evidenceContentUrl } from './bioharness';
import { hostFetch } from './gate';

export interface BioHarnessPdfViewerProps {
  workspace: string;
  anchor: EvidenceAnchor;
  title: string;
}

type PdfCheckState =
  | { status: 'checking' }
  | { status: 'ready'; contentUrl: string; identity: string }
  | { status: 'blocked'; code: string; message: string; identity?: string };

const BioHarnessPdfViewer = memo(function BioHarnessPdfViewer({
  workspace,
  anchor,
  title,
}: BioHarnessPdfViewerProps) {
  const contentUrl = evidenceContentUrl(workspace, anchor);
  const [state, setState] = useState<PdfCheckState>({ status: 'checking' });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'checking' });

    const verify = async () => {
      try {
        const res = await hostFetch(contentUrl, { method: 'HEAD' });
        if (cancelled) return;
        if (res.ok) {
          setState({
            status: 'ready',
            contentUrl,
            identity: res.headers.get('X-Evidence-Identity') || 'MATCHES_RECORD',
          });
          return;
        }
        /* Fetch structured error details when HEAD fails (409 drift / 409 budget / 404). */
        const errRes = await hostFetch(contentUrl, {
          method: 'GET',
          headers: { Range: 'bytes=0-0' },
        });
        if (cancelled) return;
        let code = `HTTP_${errRes.status}`;
        let message = 'PDF evidence could not be verified.';
        let identity: string | undefined;
        try {
          const body = (await errRes.json()) as {
            detail?: { code?: string; message?: string; current_file_identity?: string };
          };
          if (body?.detail?.code) code = body.detail.code;
          if (body?.detail?.message) message = body.detail.message;
          if (body?.detail?.current_file_identity) identity = body.detail.current_file_identity;
        } catch {
          /* ignore non-JSON body */
        }
        setState({ status: 'blocked', code, message, identity });
      } catch (err) {
        if (!cancelled) {
          setState({
            status: 'blocked',
            code: 'NETWORK_ERROR',
            message: (err as Error)?.message || 'Unable to verify PDF evidence.',
          });
        }
      }
    };

    void verify();
    return () => {
      cancelled = true;
    };
  }, [contentUrl]);

  if (state.status === 'checking') {
    return (
      <div className="text-text-secondary flex items-center gap-2 py-8 text-sm">
        <Spinner className="h-4 w-4" />
        <span>Verifying PDF SHA-256 integrity before loading viewer…</span>
      </div>
    );
  }

  if (state.status === 'blocked') {
    return (
      <div
        role="alert"
        data-testid="bh-pdf-blocked"
        className="flex items-start gap-2 rounded-xl border border-amber-400/70 bg-amber-50/90 p-4 text-xs text-amber-950 dark:bg-amber-950/40 dark:text-amber-100"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">PDF viewer unavailable ({state.code})</p>
          <p className="mt-1">{state.message}</p>
          {state.identity && (
            <p className="mt-1 opacity-85">
              Current file identity: <code>{state.identity}</code>
            </p>
          )}
        </div>
      </div>
    );
  }

  const viewerSrc = `/pdfjs/web/viewer.html?file=${encodeURIComponent(state.contentUrl)}`;

  return (
    <div className="space-y-2" data-testid="bh-pdf-viewer-wrap">
      <div className="text-text-tertiary flex items-center justify-between text-[11px]">
        <span>
          Self-hosted PDF.js v6.5.438 · scripting disabled · SHA-256 verified ({state.identity})
        </span>
      </div>
      <iframe
        src={viewerSrc}
        title={`PDF viewer: ${title}`}
        data-testid="bh-pdfjs-iframe"
        className="border-border-light h-[680px] w-full rounded-xl border bg-neutral-100 dark:bg-neutral-900"
      />
    </div>
  );
});

export default BioHarnessPdfViewer;
