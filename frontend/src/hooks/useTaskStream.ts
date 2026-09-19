import { useEffect, useRef } from "react";

export interface EventSourceLike {
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(
    type: string,
    listener: (event: MessageEvent) => void,
  ): void;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

interface UseTaskStreamOptions {
  factory?: EventSourceFactory;
  onOpen(): void;
  onError(): void;
  onTaskUpdated(taskId: string, revision: string): void;
  onStale(): void;
  onRecovered(): void;
}

function defaultFactory(url: string): EventSourceLike {
  return new EventSource(url);
}

function parsePayload(event: MessageEvent): Record<string, unknown> {
  try {
    const value = JSON.parse(String(event.data));
    return value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export default function useTaskStream({
  factory = defaultFactory,
  onOpen,
  onError,
  onTaskUpdated,
  onStale,
  onRecovered,
}: UseTaskStreamOptions): void {
  const callbacks = useRef({
    onOpen,
    onError,
    onTaskUpdated,
    onStale,
    onRecovered,
  });

  callbacks.current = {
    onOpen,
    onError,
    onTaskUpdated,
    onStale,
    onRecovered,
  };

  useEffect(() => {
    const source = factory("/api/stream");

    source.onopen = () => {
      callbacks.current.onOpen();
    };
    source.onerror = () => {
      callbacks.current.onError();
    };

    source.addEventListener("task.updated", (event) => {
      const payload = parsePayload(event);
      const taskId = String(payload.task_id ?? "");
      const revision = String(payload.revision ?? "");
      if (taskId) {
        callbacks.current.onTaskUpdated(taskId, revision);
      }
    });

    source.addEventListener("observatory.stale", () => {
      callbacks.current.onStale();
    });

    source.addEventListener("observatory.connected", () => {
      callbacks.current.onRecovered();
    });

    return () => {
      source.close();
    };
  }, [factory]);
}
