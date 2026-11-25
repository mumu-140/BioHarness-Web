import { useEffect, useState } from "react";

import { conversationsUrl } from "../api/client";
import type { ConversationEvent } from "../api/types";
import type { EventSourceFactory } from "./useVersionStream";

const defaultFactory: EventSourceFactory = (url) => new EventSource(url);

const TYPES = [
  "user.message",
  "assistant.text",
  "assistant.delta",
  "operation.started",
  "operation.finished",
  "notice",
  "run.started",
  "run.finished",
  "run.cancel_requested",
];

export interface ConversationLog {
  events: ConversationEvent[];
  /** Text the model is writing right now; replaced by the recorded text when it is complete. */
  draft: string;
  connected: boolean;
}

const EMPTY: ConversationLog = { events: [], draft: "", connected: false };

/**
 * The recorded event log of one conversation, followed live. The log lives on
 * the server: closing this stream changes nothing there, and a reconnect
 * continues after the last recorded event the browser saw.
 */
export default function useConversationEvents(
  workspace: string,
  conversationId: string | null,
  factory: EventSourceFactory = defaultFactory,
): ConversationLog {
  const [log, setLog] = useState<ConversationLog>(EMPTY);

  useEffect(() => {
    setLog(EMPTY);
    if (!conversationId) return;
    const source = factory(conversationsUrl(workspace, "/" + encodeURIComponent(conversationId) + "/events"));
    source.onopen = () => setLog((state) => ({ ...state, connected: true }));
    source.onerror = () => setLog((state) => ({ ...state, connected: false }));

    for (const type of TYPES) {
      source.addEventListener(type, (message) => {
        let event: ConversationEvent;
        try {
          event = JSON.parse(String(message.data)) as ConversationEvent;
        } catch {
          return;
        }
        setLog((state) => {
          if (event.seq === null) {
            return { ...state, connected: true, draft: state.draft + String(event.data.text ?? "") };
          }
          const last = state.events.length ? (state.events[state.events.length - 1].seq as number) : 0;
          if (event.seq <= last) return state; // already held: a reconnect replayed it
          const done =
            event.type === "assistant.text" ||
            event.type === "run.finished" ||
            (event.type === "operation.finished" && event.data.kind === "model");
          return { events: [...state.events, event], connected: true, draft: done ? "" : state.draft };
        });
      });
    }
    return () => source.close();
  }, [workspace, conversationId, factory]);

  return log;
}
