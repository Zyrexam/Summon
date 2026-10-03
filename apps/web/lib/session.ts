"use client";

import * as React from "react";
import type {
  ReportLine,
  RosterMember,
  SignalClientMessage,
  SignalServerMessage,
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

export type SessionEvent =
  | { type: "ready"; userId: string; name: string }
  | { type: "error"; code: string; message: string }
  | { type: "session-created"; sessionId: string }
  | { type: "sessions"; sessions: { id: string; memberCount: number }[] }
  | { type: "knock"; knock: Knock }
  | { type: "admitted"; sessionId: string }
  | { type: "denied"; sessionId: string }
  | { type: "room-key"; sessionId: string; key: string }
  | { type: "room-msg"; message: SessionMessage }
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
        handlerRef.current({
          type: "ready",
          userId: message.userId,
          name: message.name,
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
