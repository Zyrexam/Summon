"use client";

import * as React from "react";
import {
  MAX_SESSION_PEERS,
  type ReportLine,
  type RosterMember,
  type SignalClientMessage,
  type SignalServerMessage,
} from "@summon/core";
import { getToken, getUser } from "@/lib/auth";
import { clockTime } from "@/lib/format";
import { readRoomMessage } from "@/lib/room-message";

const SIGNAL_URL = process.env.NEXT_PUBLIC_SIGNAL_URL ?? "ws://127.0.0.1:8787";

export type Knock = {
  sessionId: string;
  visitorId: string;
  visitorName: string;
};

export type SessionMessage = {
  id: string;
  sessionId: string;
  from: string;
  fromName: string;
  body: string;
  kind: "human" | "ai";
  time: string;
  /** False once a frame fails its AAD check and the body is a placeholder. */
  readable: boolean;
  you?: boolean;
};

/**
 * Merge replayed history under live messages: history arrives oldest-first
 * and may overlap messages already received live, so live order wins and
 * duplicates collapse by id.
 */
export function mergeHistory(
  prev: SessionMessage[],
  incoming: SessionMessage[],
): SessionMessage[] {
  if (incoming.length === 0) return prev;
  const incomingIds = new Set(incoming.map((m) => m.id));
  const liveOnly = prev.filter((m) => !incomingIds.has(m.id));
  const seen = new Set<string>();
  const ordered = [...incoming, ...liveOnly].filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
  if (ordered.length === prev.length && ordered.every((m, i) => m === prev[i])) {
    return prev;
  }
  return ordered;
}

export type SessionEvent =
  | { type: "ready"; userId: string; name: string; maxPeers: number }
  | { type: "error"; code: string; message: string }
  | { type: "session-created"; sessionId: string }
  | { type: "sessions"; sessions: { id: string; memberCount: number }[] }
  | { type: "knock"; knock: Knock }
  | { type: "admitted"; sessionId: string }
  | { type: "denied"; sessionId: string }
  | { type: "room-key"; sessionId: string; key: string }
  | { type: "room-msg"; message: SessionMessage }
  | { type: "history"; sessionId: string; messages: SessionMessage[] }
  | { type: "ai-answer"; sessionId: string; requestId: string; answer: string }
  | {
      type: "ai-error";
      sessionId: string;
      requestId: string;
      message: string;
    }
  | { type: "roster"; sessionId: string; members: RosterMember[] }
  | { type: "session-ended"; sessionId: string }
  | { type: "report"; sessionId: string; lines: ReportLine[]; endedAt: string | null }
  | { type: "signal"; message: SignalServerMessage };

/**
 * Frames that reach the mesh hook untouched instead of becoming first-class
 * events. Naming them here is what lets the assertion below fail loudly when
 * the wire protocol grows a frame nobody has routed yet.
 */
export const SIGNAL_PASSTHROUGH = [
  "peers",
  "peer-joined",
  "peer-left",
  "rtc-offer",
  "rtc-answer",
  "rtc-ice",
] as const satisfies readonly SignalServerMessage["type"][];

type Passthrough = (typeof SIGNAL_PASSTHROUGH)[number];
type Unrouted = Exclude<SignalServerMessage["type"], Passthrough>;

/**
 * Enforced by `tsc`, not by a test: adding a frame to the wire protocol
 * without giving it an event here is a compile error, instead of a message
 * that silently vanishes into the mesh hook.
 */
const _everyFrameIsRouted: Exclude<Unrouted, SessionEvent["type"]> extends never
  ? true
  : { missing: Exclude<Unrouted, SessionEvent["type"]> } = true;
void _everyFrameIsRouted;

function roomKeyStorage(sessionId: string): string {
  return `summon.roomKey.${sessionId}`;
}

export function loadRoomKey(sessionId: string): string | null {
  if (typeof window === "undefined") return null;
  // localStorage, not sessionStorage: the key must survive the host opening the
  // session in another tab, or that tab mints a new key and orphans the room.
  return window.localStorage.getItem(roomKeyStorage(sessionId));
}

export function saveRoomKey(sessionId: string, key: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(roomKeyStorage(sessionId), key);
}

export function useSession(onEvent: (event: SessionEvent) => void) {
  const [ready, setReady] = React.useState(false);
  /** Mesh ceiling advertised by the relay in `ready`; default until then. */
  const [maxPeers, setMaxPeers] = React.useState(MAX_SESSION_PEERS);
  const wsRef = React.useRef<WebSocket | null>(null);
  const handlerRef = React.useRef(onEvent);
  handlerRef.current = onEvent;

  React.useEffect(() => {
    const token = getToken();
    const user = getUser();
    if (!token || !user) {
      setReady(false);
      return;
    }
    const ws = new WebSocket(SIGNAL_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      const hello: SignalClientMessage = {
        type: "hello",
        token,
        name: user.name,
      };
      ws.send(JSON.stringify(hello));
    };

    ws.onmessage = (event) => {
      let message: SignalServerMessage;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.type === "ready") {
          setReady(true);
        setMaxPeers(
          Number.isSafeInteger(message.maxPeers) && message.maxPeers > 0
            ? message.maxPeers
            : MAX_SESSION_PEERS,
        );
        handlerRef.current({
          type: "ready",
          userId: message.userId,
          name: message.name,
          maxPeers: message.maxPeers,
        });
        return;
      }
      if (message.type === "error") {
        handlerRef.current({
          type: "error",
          code: message.code,
          message: message.message,
        });
        return;
      }
      if (message.type === "session-created") {
        handlerRef.current({
          type: "session-created",
          sessionId: message.sessionId,
        });
        return;
      }
      if (message.type === "sessions") {
        handlerRef.current({
          type: "sessions",
          sessions: message.sessions,
        });
        return;
      }
      if (message.type === "knock") {
        handlerRef.current({
          type: "knock",
          knock: {
            sessionId: message.sessionId,
            visitorId: message.visitorId,
            visitorName: message.visitorName,
          },
        });
        return;
      }
      if (message.type === "admitted") {
        handlerRef.current({ type: "admitted", sessionId: message.sessionId });
        return;
      }
      if (message.type === "denied") {
        handlerRef.current({ type: "denied", sessionId: message.sessionId });
        return;
      }
      if (message.type === "room-key") {
        saveRoomKey(message.sessionId, message.key);
        handlerRef.current({
          type: "room-key",
          sessionId: message.sessionId,
          key: message.key,
        });
        return;
      }
      if (message.type === "room-msg") {
        const user = getUser();
        void readRoomMessage({
          key: loadRoomKey(message.sessionId),
          iv: message.iv,
          enc: message.enc,
          sessionId: message.sessionId,
          msgId: message.msgId,
          senderId: message.from,
        }).then(({ body, readable }) => {
          handlerRef.current({
            type: "room-msg",
            message: {
              id: message.msgId,
              sessionId: message.sessionId,
              from: message.from,
              fromName: message.fromName,
              body,
              readable,
              kind: message.kind === "ai" ? "ai" : "human",
              time: clockTime(Date.now()),
              you: message.from === user?.id,
            },
          });
        });
        return;
      }
      if (message.type === "history") {
        const user = getUser();
        const key = loadRoomKey(message.sessionId);
        void Promise.all(
          message.messages.map((item) =>
            readRoomMessage({
              key,
              iv: item.iv,
              enc: item.enc,
              sessionId: message.sessionId,
              msgId: item.msgId,
              senderId: item.from,
            }).then(({ body, readable }) => ({
              id: item.msgId,
              sessionId: message.sessionId,
              from: item.from,
              fromName: item.fromName,
              body,
              readable,
              kind: item.kind === "ai" ? ("ai" as const) : ("human" as const),
              time: clockTime(item.at),
              you: item.from === user?.id,
            })),
          ),
        ).then((messages) => {
          handlerRef.current({ type: "history", sessionId: message.sessionId, messages });
        });
        return;
      }
      if (message.type === "ai-answer") {
        handlerRef.current({
          type: "ai-answer",
          sessionId: message.sessionId,
          requestId: message.requestId,
          answer: message.answer,
        });
        return;
      }
      if (message.type === "ai-error") {
        handlerRef.current({
          type: "ai-error",
          sessionId: message.sessionId,
          requestId: message.requestId,
          message: message.message,
        });
        return;
      }
      if (message.type === "roster") {
        handlerRef.current({
          type: "roster",
          sessionId: message.sessionId,
          members: message.members,
        });
        return;
      }
      if (message.type === "session-ended") {
        handlerRef.current({
          type: "session-ended",
          sessionId: message.sessionId,
        });
        return;
      }
      if (message.type === "report") {
        handlerRef.current({
          type: "report",
          sessionId: message.sessionId,
          lines: message.lines,
          endedAt: message.endedAt,
        });
        return;
      }
      handlerRef.current({ type: "signal", message });
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      setReady(false);
      wsRef.current = null;
    };

    return () => {
      ws.close();
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      setReady(false);
    };
  }, []);

  const send = React.useCallback((message: SignalClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }, []);

  const create = React.useCallback(() => send({ type: "create" }), [send]);
  const listSessions = React.useCallback(
    () => send({ type: "list-sessions" }),
    [send],
  );
  const hostOpen = React.useCallback(
    (sessionId: string) => send({ type: "host-open", sessionId }),
    [send],
  );
  const knock = React.useCallback(
    (sessionId: string) => send({ type: "knock", sessionId }),
    [send],
  );
  const admit = React.useCallback(
    (sessionId: string, visitorId: string) =>
      send({ type: "admit", sessionId, visitorId }),
    [send],
  );
  const deny = React.useCallback(
    (sessionId: string, visitorId: string) =>
      send({ type: "deny", sessionId, visitorId }),
    [send],
  );
  const sendRoomKey = React.useCallback(
    (sessionId: string, to: string, key: string) =>
      send({ type: "room-key", sessionId, to, key }),
    [send],
  );
  const sendRoomMsg = React.useCallback(
    (message: {
      sessionId: string;
      msgId: string;
      iv: string;
      enc: string;
      kind?: "human" | "ai";
    }) => send({ type: "room-msg", ...message }),
    [send],
  );
  const joinRtc = React.useCallback(
    (sessionId: string) => send({ type: "join", sessionId }),
    [send],
  );
  const summon = React.useCallback(
    (input: {
      sessionId: string;
      requestId: string;
      question: string;
      context: { name: string; body: string }[];
    }) => send({ type: "summon", ...input }),
    [send],
  );
  const leave = React.useCallback(
    (sessionId: string) => send({ type: "leave", sessionId }),
    [send],
  );
  const end = React.useCallback(
    (sessionId: string) => send({ type: "end", sessionId }),
    [send],
  );
  const requestReport = React.useCallback(
    (sessionId: string) => send({ type: "report", sessionId }),
    [send],
  );

  return {
    ready,
    maxPeers,
    send,
    create,
    listSessions,
    hostOpen,
    knock,
    admit,
    deny,
    sendRoomKey,
    sendRoomMsg,
    joinRtc,
    summon,
    leave,
    end,
    requestReport,
  };
}
