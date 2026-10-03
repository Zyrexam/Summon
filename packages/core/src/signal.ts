import type {
  ReportLine,
  SessionId,
  SummonContextLine,
  UserId,
} from "./session";

export type IceCandidateLike = {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};

export type RosterMember = {
  id: UserId;
  name: string;
  online: boolean;
  host: boolean;
};

/**
 * One persisted chat message. Ciphertext only (iv/enc): replayable after a
 * reload or relay restart, readable only by holders of the room key.
 */
export type HistoryMessage = {
  msgId: string;
  iv: string;
  enc: string;
  from: UserId;
  fromName: string;
  kind: "human" | "ai";
  /** Server timestamp, ISO string. */
  at: string;
};

export type SignalClientMessage =
  | { type: "hello"; token: string; name: string; clientId?: string }
  | { type: "create" }
  | { type: "host-open"; sessionId: SessionId }
  | { type: "knock"; sessionId: SessionId }
  | { type: "admit"; sessionId: SessionId; visitorId: UserId }
  | { type: "deny"; sessionId: SessionId; visitorId: UserId }
  | { type: "room-key"; sessionId: SessionId; to: UserId; key: string }
  | {
      type: "room-msg";
      sessionId: SessionId;
      msgId: string;
      iv: string;
      enc: string;
      kind?: "human" | "ai";
    }
  | { type: "join"; sessionId: SessionId }
  | {
      type: "summon";
      sessionId: SessionId;
      requestId: string;
      question: string;
      context: SummonContextLine[];
    }
  | { type: "rtc-offer"; to: UserId; sdp: string }
  | { type: "rtc-answer"; to: UserId; sdp: string }
  | { type: "rtc-ice"; to: string; candidate: IceCandidateLike }
  | { type: "leave"; sessionId: SessionId }
  | { type: "end"; sessionId: SessionId }
  | { type: "list-sessions" }
  | { type: "report"; sessionId: SessionId };

export type SignalServerMessage =
  | { type: "ready"; userId: UserId; name: string }
  | { type: "error"; code: string; message: string }
  | { type: "session-created"; sessionId: SessionId }
  | {
      type: "sessions";
      sessions: { id: SessionId; memberCount: number }[];
    }
  | { type: "peers"; peers: UserId[] }
  | { type: "peer-joined"; peerId: UserId }
  | { type: "peer-left"; peerId: UserId }
  | { type: "rtc-offer"; from: UserId; sdp: string }
  | { type: "rtc-answer"; from: UserId; sdp: string }
  | { type: "rtc-ice"; from: string; candidate: IceCandidateLike }
  | {
      type: "knock";
      sessionId: SessionId;
      visitorId: UserId;
      visitorName: string;
    }
  | { type: "admitted"; sessionId: SessionId }
  | { type: "denied"; sessionId: SessionId }
  | { type: "room-key"; sessionId: SessionId; key: string }
  | {
      type: "room-msg";
      sessionId: SessionId;
      msgId: string;
      iv: string;
      enc: string;
      body?: string;
      from: UserId;
      fromName: string;
      kind?: "human" | "ai";
    }
  | { type: "roster"; sessionId: SessionId; members: RosterMember[] }
  | {
      type: "history";
      sessionId: SessionId;
      messages: HistoryMessage[];
    }
  | {
      type: "ai-answer";
      sessionId: SessionId;
      requestId: string;
      answer: string;
    }
  | {
      type: "ai-error";
      sessionId: SessionId;
      requestId: string;
      code: string;
      message: string;
    }
  | { type: "session-ended"; sessionId: SessionId }
  | {
      type: "report";
      sessionId: SessionId;
      lines: ReportLine[];
      endedAt: string | null;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function nonBlank(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export function parseClientSignal(raw: string): SignalClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  const msg = data;
  switch (msg.type) {
    case "hello":
      if (str(msg.token) && str(msg.name)) {
        const clientId = typeof msg.clientId === "string" ? msg.clientId : undefined;
        return { type: "hello", token: msg.token, name: msg.name, clientId };
      }
      return null;
    case "create":
    case "list-sessions":
      return { type: msg.type };
    case "host-open":
    case "knock":
    case "join":
    case "leave":
    case "end":
    case "report":
      if (str(msg.sessionId)) {
        return { type: msg.type, sessionId: msg.sessionId };
      }
      return null;
    case "admit":
    case "deny":
      if (str(msg.sessionId) && str(msg.visitorId)) {
        return {
          type: msg.type,
          sessionId: msg.sessionId,
          visitorId: msg.visitorId,
        };
      }
      return null;
    case "room-key":
      if (str(msg.sessionId) && str(msg.to) && str(msg.key)) {
        return { type: "room-key", sessionId: msg.sessionId, to: msg.to, key: msg.key };
      }
      return null;
    case "summon":
      if (!str(msg.sessionId) || !str(msg.requestId) || !nonBlank(msg.question)) {
        return null;
      }
      if (!Array.isArray(msg.context)) return null;
      return {
        type: "summon",
        sessionId: msg.sessionId,
        requestId: msg.requestId,
        question: msg.question,
        context: msg.context.flatMap((line) =>
          isRecord(line) && str(line.name) && str(line.body)
            ? [{ name: line.name, body: line.body }]
            : [],
        ),
      };
    case "room-msg":
      if (str(msg.sessionId) && str(msg.msgId) && str(msg.iv) && str(msg.enc)) {
        const kind =
          msg.kind === "ai" || msg.kind === "human" ? msg.kind : undefined;
        return {
          type: "room-msg",
          sessionId: msg.sessionId,
          msgId: msg.msgId,
          iv: msg.iv,
          enc: msg.enc,
          kind,
        };
      }
      return null;
    case "rtc-offer":
    case "rtc-answer":
      if (str(msg.to) && str(msg.sdp)) {
        return { type: msg.type, to: msg.to, sdp: msg.sdp };
      }
      return null;
    case "rtc-ice":
      if (str(msg.to) && msg.candidate && typeof msg.candidate === "object") {
        return {
          type: "rtc-ice",
          to: msg.to,
          candidate: msg.candidate as IceCandidateLike,
        };
      }
      return null;
    default:
      return null;
  }
}
