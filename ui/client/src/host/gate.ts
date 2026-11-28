/**
 * BioHarness host boundary for the adopted LibreChat frontend (not upstream code).
 *
 * Every request the donor data layer makes passes through here. A donor call is either
 * answered by a BioHarness mapping in `routes.ts`, or refused locally as not provided by this
 * host. Nothing is forwarded to a donor business backend, and nothing is answered as an
 * empty success. The browser itself may only reach the BioHarness paths listed below and
 * the static files of this build.
 */
import axios, { AxiosError, AxiosHeaders } from 'axios';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

/** BioHarness API paths this build may call. Extended only with a documented backend route. */
const APPROVED_API: Array<{ method: string; path: RegExp }> = [
  { method: 'GET', path: /^\/api\/health$/ },
  { method: 'GET', path: /^\/api\/meta$/ },
  { method: 'POST', path: /^\/api\/session$/ },
  /* Step 3: R2 Model Configuration Center */
  { method: 'GET', path: /^\/api\/settings\/models$/ },
  { method: 'PUT', path: /^\/api\/settings\/models$/ },
  { method: 'POST', path: /^\/api\/settings\/models\/fetch-models$/ },
  { method: 'POST', path: /^\/api\/settings\/models\/reset$/ },
  /* Step 3: Workspace Core/Governance read snapshots & version invalidation SSE */
  { method: 'GET', path: /^\/api\/workspaces\/[^/]+\/views\/(open|now|tree|context|routes|evidence)$/ },
  { method: 'GET', path: /^\/api\/workspaces\/[^/]+\/stream$/ },
  /* Step 3: Native runtime conversations, runs, cancellation & authoritative event log SSE */
  { method: 'GET', path: /^\/api\/workspaces\/[^/]+\/conversations$/ },
  { method: 'POST', path: /^\/api\/workspaces\/[^/]+\/conversations$/ },
  { method: 'GET', path: /^\/api\/workspaces\/[^/]+\/conversations\/[^/]+$/ },
  { method: 'PUT', path: /^\/api\/workspaces\/[^/]+\/conversations\/[^/]+\/request$/ },
  { method: 'POST', path: /^\/api\/workspaces\/[^/]+\/conversations\/[^/]+\/runs$/ },
  { method: 'POST', path: /^\/api\/workspaces\/[^/]+\/conversations\/[^/]+\/runs\/[^/]+\/cancel$/ },
  { method: 'GET', path: /^\/api\/workspaces\/[^/]+\/conversations\/[^/]+\/events$/ },
  /* Step 4: Execution records & configured module discovery */
  { method: 'GET', path: /^\/api\/workspaces\/[^/]+\/conversations\/[^/]+\/invocations$/ },
  { method: 'GET', path: /^\/api\/workspaces\/[^/]+\/conversations\/[^/]+\/modules$/ },
  /* Step 4: Bounded evidence preview, verified content/range stream, and structured table */
  { method: 'GET', path: /^\/api\/workspaces\/[^/]+\/evidence-preview$/ },
  { method: 'GET', path: /^\/api\/workspaces\/[^/]+\/evidence-content$/ },
  { method: 'HEAD', path: /^\/api\/workspaces\/[^/]+\/evidence-content$/ },
  { method: 'GET', path: /^\/api\/workspaces\/[^/]+\/evidence-table$/ },
  /* R3.2: Restricted research-input upload & authorized workspace file listing */
  { method: 'GET', path: /^\/api\/workspaces\/[^/]+\/inputs$/ },
  { method: 'POST', path: /^\/api\/workspaces\/[^/]+\/inputs$/ },
  /* R3.3: Capabilities, redacted diagnostics, and BioHarness Memory MCP thin BFF */
  { method: 'GET', path: /^\/api\/workspaces\/[^/]+\/capabilities$/ },
  { method: 'GET', path: /^\/api\/workspaces\/[^/]+\/diagnostics$/ },
  { method: 'GET', path: /^\/api\/workspaces\/[^/]+\/memory\/status$/ },
  { method: 'POST', path: /^\/api\/workspaces\/[^/]+\/memory\/recall$/ },
  { method: 'POST', path: /^\/api\/workspaces\/[^/]+\/memory\/expand$/ },
  { method: 'POST', path: /^\/api\/workspaces\/[^/]+\/memory\/report-use$/ },
  { method: 'POST', path: /^\/api\/workspaces\/[^/]+\/memory\/propose$/ },
];

export const NOT_PROVIDED = 'NOT_PROVIDED_BY_HOST';

export type HostCall = {
  method: string;
  pathname: string;
  search: URLSearchParams;
  body: unknown;
};

export type HostRoute = {
  method: string;
  path: RegExp;
  handle: (call: HostCall) => Promise<unknown>;
};

/** Thrown by a mapping to answer the donor with an HTTP-shaped failure. */
export class HostHttpError extends Error {
  constructor(
    readonly status: number,
    readonly data: unknown,
  ) {
    super(`host answered ${status}`);
  }
}

const nativeFetch: typeof fetch | null =
  typeof window !== 'undefined' && typeof window.fetch === 'function'
    ? window.fetch.bind(window)
    : typeof globalThis.fetch === 'function'
      ? globalThis.fetch.bind(globalThis)
      : null;

const isApproved = (method: string, url: URL): boolean => {
  if (url.origin !== window.location.origin) {
    return false;
  }
  if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) {
    /** Static files of this build; the service has nothing else outside /api. */
    return method === 'GET' || method === 'HEAD';
  }
  return APPROVED_API.some((entry) => entry.method === method && entry.path.test(url.pathname));
};

const resolveUrl = (input: string | URL): URL | null => {
  try {
    return new URL(String(input), window.location.href);
  } catch {
    return null;
  }
};

const isLocalScheme = (url: URL) => url.protocol === 'data:' || url.protocol === 'blob:';

const refusalTarget = (url: URL | null, fallback = '?'): string =>
  url ? (url.origin === window.location.origin ? url.pathname : url.origin) : fallback;

/** The only way host mappings reach the network. */
export async function hostFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = new URL(path, window.location.origin);
  const method = (init?.method ?? 'GET').toUpperCase();
  if (!isApproved(method, url)) {
    throw new Error(`host path is not approved: ${method} ${url.pathname}`);
  }
  if (!nativeFetch) {
    throw new Error('fetch is not available in this environment');
  }
  return nativeFetch(url, { ...init, credentials: 'same-origin', cache: 'no-store' });
}

const refusals: string[] = [];
/** Donor calls this host declined, for inspection in the browser console and in tests. */
const recordRefusal = (method: string, target: string) => {
  const entry = `${method} ${target}`;
  if (!refusals.includes(entry)) {
    refusals.push(entry);
  }
};

const settle = (
  config: InternalAxiosRequestConfig,
  status: number,
  data: unknown,
): Promise<AxiosResponse> => {
  const response: AxiosResponse = {
    data,
    status,
    statusText: '',
    headers: new AxiosHeaders(),
    config,
  };
  if (status >= 200 && status < 300) {
    return Promise.resolve(response);
  }
  return Promise.reject(
    new AxiosError(
      `Request failed with status code ${status}`,
      status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
      config,
      null,
      response,
    ),
  );
};

const parseBody = (data: unknown): unknown => {
  if (typeof data !== 'string') {
    return data;
  }
  try {
    return JSON.parse(data);
  } catch {
    return data;
  }
};

export function installHostGate(routes: HostRoute[]): void {
  const adapter: AxiosAdapter = async (config) => {
    const method = (config.method ?? 'get').toUpperCase();
    const url = resolveUrl(axios.getUri(config));
    if (!url || url.origin !== window.location.origin) {
      recordRefusal(method, refusalTarget(url, String(config.url)));
      return settle(config, 501, { origin: 'web-host', code: NOT_PROVIDED });
    }
    const route = routes.find((entry) => entry.method === method && entry.path.test(url.pathname));
    if (!route) {
      recordRefusal(method, url.pathname);
      return settle(config, 501, {
        origin: 'web-host',
        code: NOT_PROVIDED,
        message: 'This function is not provided by the BioHarness service.',
      });
    }
    try {
      const data = await route.handle({
        method,
        pathname: url.pathname,
        search: url.searchParams,
        body: parseBody(config.data),
      });
      return settle(config, 200, data);
    } catch (error) {
      if (error instanceof HostHttpError) {
        return settle(config, error.status, error.data);
      }
      throw new AxiosError((error as Error).message, AxiosError.ERR_NETWORK, config);
    }
  };
  axios.defaults.adapter = adapter;

  /** Donor code outside the data layer (media, speech, stream abort) uses these directly. */
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : null;
    const url = resolveUrl(request ? request.url : (input as string | URL));
    const method = (init?.method ?? request?.method ?? 'GET').toUpperCase();
    if (url && (isLocalScheme(url) || isApproved(method, url))) {
      if (!nativeFetch) {
        return Promise.reject(new TypeError('fetch is not available in this environment'));
      }
      return nativeFetch(input, init);
    }
    recordRefusal(method, refusalTarget(url));
    return Promise.reject(new TypeError(`${NOT_PROVIDED}: request refused by the BioHarness host`));
  };

  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function open(
    this: XMLHttpRequest,
    method: string,
    target: string | URL,
    ...rest: unknown[]
  ) {
    const url = resolveUrl(target);
    if (!url || !(isLocalScheme(url) || isApproved(method.toUpperCase(), url))) {
      recordRefusal(method.toUpperCase(), refusalTarget(url));
      throw new DOMException(`${NOT_PROVIDED}: request refused by the BioHarness host`, 'SecurityError');
    }
    return (nativeOpen as (...args: unknown[]) => void).call(this, method, target, ...rest);
  } as typeof XMLHttpRequest.prototype.open;

  const NativeEventSource = window.EventSource;
  window.EventSource = class extends NativeEventSource {
    constructor(target: string | URL, init?: EventSourceInit) {
      const url = resolveUrl(target);
      if (!url || !isApproved('GET', url)) {
        recordRefusal('GET', refusalTarget(url));
        throw new DOMException(`${NOT_PROVIDED}: stream refused by the BioHarness host`, 'SecurityError');
      }
      super(target, init);
    }
  };

  if (typeof window.WebSocket === 'function') {
    const BlockedWebSocket = function WebSocket(target: string | URL) {
      recordRefusal('WS', refusalTarget(resolveUrl(target)));
      throw new DOMException(`${NOT_PROVIDED}: socket refused by the BioHarness host`, 'SecurityError');
    };
    Object.assign(BlockedWebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
    window.WebSocket = BlockedWebSocket as unknown as typeof WebSocket;
  }

  navigator.sendBeacon = (target: string | URL) => {
    recordRefusal('POST', refusalTarget(resolveUrl(target)));
    return false;
  };

  (window as Window & { __bioharnessHostRefusals?: string[] }).__bioharnessHostRefusals = refusals;
}
