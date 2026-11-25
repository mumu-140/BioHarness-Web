import type { EvidencePreviewResponse, EvidenceRef, Selector, SourceError, ViewName } from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function query(selector: Selector): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(selector).sort()) {
    const value = selector[key];
    if (value !== undefined && value !== false) params.set(key, String(value));
  }
  const text = params.toString();
  return text ? "?" + text : "";
}

// The URL is also the cache key of a view, so the same selector always maps to the same key.
export function viewUrl(workspace: string, view: ViewName, selector: Selector = {}): string {
  return `/api/workspaces/${encodeURIComponent(workspace)}/views/${view}${query(selector)}`;
}

export function streamUrl(workspace: string, selector: Selector): string {
  return `/api/workspaces/${encodeURIComponent(workspace)}/stream${query(selector)}`;
}

export async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  if (!response.ok) {
    let detail: Partial<SourceError> = {};
    try {
      detail = ((await response.json()) as { detail?: Partial<SourceError> }).detail ?? {};
    } catch {
      // not JSON: keep the HTTP status as the only fact
    }
    throw new ApiError(
      response.status,
      detail.code ?? "HTTP_" + response.status,
      typeof detail.message === "string" ? detail.message : "请求失败(HTTP " + response.status + ")",
    );
  }
  return response.json() as Promise<T>;
}

export async function signIn(token: string): Promise<boolean> {
  const response = await fetch("/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ token }),
  });
  return response.ok;
}

export function getEvidencePreview(
  workspace: string,
  ref: EvidenceRef,
): Promise<EvidencePreviewResponse> {
  const anchor = {
    request_id: ref.request_id,
    submission_index: ref.submission_index,
    evidence_id: ref.evidence_id,
    sha256: ref.sha256,
  };
  return getJson(`/api/workspaces/${encodeURIComponent(workspace)}/evidence-preview${query(anchor)}`);
}
