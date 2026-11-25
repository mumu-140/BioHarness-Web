import { useEffect, useState } from "react";
import { useSWRConfig } from "swr";

import { streamUrl, viewUrl } from "../api/client";
import type { Selector, Snapshot, ViewName } from "../api/types";

export interface EventSourceLike {
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

const defaultFactory: EventSourceFactory = (url) => new EventSource(url);

interface StreamEvent {
  workspace: string;
  view: ViewName;
  selector: Selector;
  content_sha256?: string;
}

function parse(event: MessageEvent): StreamEvent | null {
  try {
    const value = JSON.parse(String(event.data)) as StreamEvent;
    return value && typeof value.view === "string" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Listens for change notifications and refetches the snapshots they concern.
 * A notification never carries scientific state: it only names a view whose
 * content identity differs from the snapshot held here.
 */
export default function useVersionStream(
  workspace: string | null,
  projectId: string | null,
  requestId: string | null,
  factory: EventSourceFactory = defaultFactory,
): { connected: boolean; staleViews: ViewName[] } {
  const { cache, mutate } = useSWRConfig();
  const [connected, setConnected] = useState(false);
  const [staleViews, setStaleViews] = useState<ViewName[]>([]);

  useEffect(() => {
    setConnected(false);
    setStaleViews([]);
    if (!workspace) return;
    const source = factory(
      streamUrl(workspace, { project_id: projectId ?? undefined, request_id: requestId ?? undefined }),
    );
    const governance = new RegExp(
      "^/api/workspaces/" + encodeURIComponent(workspace) + "/views/(tree|context|routes)",
    );

    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    source.addEventListener("version", (message) => {
      const event = parse(message);
      if (!event) return;
      setConnected(true);
      setStaleViews((views) => views.filter((view) => view !== event.view));
      const key = viewUrl(event.workspace, event.view, event.selector);
      const held = cache.get(key)?.data as Snapshot | undefined;
      if (held && held.content_sha256 === event.content_sha256) return;
      if (event.view === "tree") {
        // Every Project Governance view is computed from the same records.
        void mutate((candidate) => typeof candidate === "string" && governance.test(candidate));
      } else {
        void mutate(key);
      }
    });

    source.addEventListener("source.stale", (message) => {
      const event = parse(message);
      if (!event) return;
      setStaleViews((views) => (views.includes(event.view) ? views : [...views, event.view]));
    });

    return () => source.close();
  }, [workspace, projectId, requestId, factory, cache, mutate]);

  return { connected, staleViews };
}
