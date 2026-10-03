import {
  createRateLimiter,
  MAX_SUMMON_CONTEXT_LINES,
  parseClientSignal,
  REPORT_TTL_MS,
  verifyToken,
  type ReportLine,
  type RosterMember,
  type SessionId,
  type SignalClientMessage,
  type RateLimiter,
  type SignalServerMessage,
  type UserId,
} from "@summon/core";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import {
  canReadReport,
  canSend,
  hasMemberRoom,
  hasPeerRoom,
  type RelayMember,
  type SessionRec,
} from "./authz";
import { createReportBuffer, reportLineFor } from "./report";
import { logger as defaultLogger, type Logger } from "./logger";
import {
  createGroqProvider,
  DEFAULT_SUMMON_MODEL,
  type AiProvider,
} from "./ai";

export type RelayOptions = {
  port: number;
  tokenSecret: string;
  aiProvider: AiProvider | null;
  now?: () => number;
  logger?: Logger;
};

/** How long an `ai-answer` requestId may still authorise its room message. */
export const AI_GRANT_TTL_MS = 2 * 60_000;

/** Provider calls one member may make per minute, across all their sessions. */
export const SUMMON_LIMIT_PER_MINUTE = 5;
const SUMMON_WINDOW_MS = 60_000;

type RtcMessage = Extract<
  SignalClientMessage,
  { type: "rtc-offer" | "rtc-answer" | "rtc-ice" }
>;

/** The only session state the relay keeps; everything else is per-socket. */
class SessionStore {
  private readonly sessions = new Map<SessionId, SessionRec>();

  constructor(private readonly logger: Logger = defaultLogger) {}

  create(host: RelayMember): SessionRec {
    const session: SessionRec = {
      id: randomUUID(),
      hostId: host.id,
      status: "live",
      members: new Map([[host.id, { ...host, host: true, online: true }]]),
      knocks: new Map(),
      peers: new Map(),
      report: createReportBuffer(),
      endedAt: null,
      reportTtl: null,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(sessionId: SessionId): SessionRec | undefined {
    return this.sessions.get(sessionId);
  }

  live(sessionId: SessionId): SessionRec | undefined {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== "live") return undefined;
    return session;
  }

  all(): SessionRec[] {
    return [...this.sessions.values()];
  }

  /** Ended sessions stay readable for the report TTL, then drop out. */
  end(session: SessionRec) {
    if (session.status === "ended") return;
    session.status = "ended";
    session.endedAt = Date.now();
    this.logger.info("session_ended", {
      sessionId: session.id,
      hostId: session.hostId,
      members: session.members.size,
      lines: session.report.size(),
    });
    broadcast(session, { type: "session-ended", sessionId: session.id });
    for (const peer of session.peers.values()) {
      if (peer.readyState === peer.OPEN) peer.close();
    }
    session.peers.clear();
    for (const member of session.members.values()) {
      member.online = false;
      member.socket = null;
    }
    for (const knock of session.knocks.values()) knock.socket = null;
    session.reportTtl = setTimeout(() => this.purge(session.id), REPORT_TTL_MS);
  }

  purge(sessionId: SessionId) {
    const session = this.sessions.get(sessionId);
    if (session?.reportTtl) clearTimeout(session.reportTtl);
    this.sessions.delete(sessionId);
    this.logger.info("session_purged", { sessionId });
  }

  reportLines(session: SessionRec): ReportLine[] {
    return session.report.lines();
  }
}

function send(socket: WebSocket, message: SignalServerMessage) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function rosterFor(session: SessionRec): RosterMember[] {
  return [...session.members.values()].map((member) => ({
    id: member.id,
    name: member.name,
    online: Boolean(member.online && member.socket),
    host: member.host,
  }));
}

function broadcast(session: SessionRec, message: SignalServerMessage) {
  for (const member of session.members.values()) {
    if (member.socket) send(member.socket, message);
  }
}

function broadcastRoster(session: SessionRec) {
  broadcast(session, {
    type: "roster",
    sessionId: session.id,
    members: rosterFor(session),
  });
}

function leaveRtc(session: SessionRec, peerId: UserId) {
  session.peers.delete(peerId);
  for (const [id, other] of session.peers) {
    if (id !== peerId) send(other, { type: "peer-left", peerId });
  }
}

class Connection {
  userId: UserId | null = null;
  clientName = "";
  readonly joined = new Set<SessionId>();
  readonly rtc: { sessionId: SessionId | null; peerId: UserId | null } = {
    sessionId: null,
    peerId: null,
  };
  private readonly queue: SignalClientMessage[] = [];
  private helloPending: Promise<void> | null = null;
  /**
   * requestIds this socket summoned, with the deadline each one expires at.
   * `ai` stays reserved for relay-originated answers, with one exception: the
   * summoner posts the answer back as a room message, so its own requestId is
   * the only ticket to an ember sender.
   */
  private readonly aiGrants = new Map<string, number>();
  /**
   * Provider spend is metered per member: one socket asking `@ai` in a loop
   * would otherwise drain the account for everyone in the room.
   */
  private readonly summonQuota: RateLimiter = createRateLimiter({
    limit: SUMMON_LIMIT_PER_MINUTE,
    windowMs: SUMMON_WINDOW_MS,
    now: () => this.now(),
  });

  constructor(
    private readonly socket: WebSocket,
    private readonly store: SessionStore,
    private readonly tokenSecret: string,
    private readonly aiProvider: AiProvider | null,
    private readonly now: () => number = Date.now,
    private readonly logger: Logger = defaultLogger,
  ) {}

  private get handlers(): Handlers {
    return {
      create: () => this.onCreate(),
      "list-sessions": () => this.onListSessions(),
      "host-open": (msg) => this.onHostOpen(msg.sessionId),
      knock: (msg) => this.onKnock(msg.sessionId),
      admit: (msg) => this.onAdmission(msg.sessionId, msg.visitorId, true),
      deny: (msg) => this.onAdmission(msg.sessionId, msg.visitorId, false),
      "room-key": (msg) => this.onRoomKey(msg.sessionId, msg.to, msg.key),
      "room-msg": (msg) => this.onRoomMsg(msg),
      summon: (msg) => this.onSummon(msg),
      join: (msg) => this.onJoin(msg.sessionId),
      leave: (msg) => this.onLeave(msg.sessionId),
      end: (msg) => this.onEnd(msg.sessionId),
      report: (msg) => this.onReport(msg.sessionId),
      "rtc-offer": (msg) => this.onRtc(msg),
      "rtc-answer": (msg) => this.onRtc(msg),
      "rtc-ice": (msg) => this.onRtc(msg),
    };
  }

  onMessage(raw: WebSocket.RawData) {
    const msg = parseClientSignal(String(raw));
    if (!msg) return;

    if (msg.type === "hello") {
      this.hello(msg);
      return;
    }
    if (!this.userId) {
      // A hello is verified asynchronously: hold the rest of the frame instead
      // of dropping it as unauthenticated.
      if (this.helloPending) this.queue.push(msg);
      return;
    }
    this.dispatch(msg);
  }

  close() {
    this.aiGrants.clear();
    this.leaveAll();
  }

  private hello(msg: Extract<SignalClientMessage, { type: "hello" }>) {
    if (this.userId !== null || this.helloPending) {
      this.logger.warn("hello_rejected", { reason: "already-authenticated" });
      send(this.socket, {
        type: "error",
        code: "already-authenticated",
        message: "This socket is already authenticated",
      });
      return;
    }
    this.helloPending = verifyToken(msg.token, this.tokenSecret).then(
      (verified) => {
        this.helloPending = null;
        if (!verified) {
          this.logger.warn("auth_failed", { code: "bad-token", name: msg.name });
          send(this.socket, {
            type: "error",
            code: "bad-token",
            message: "Invalid or expired session",
          });
          return;
        }
        this.userId = verified;
        this.clientName = msg.name;
        send(this.socket, { type: "ready", userId: verified, name: msg.name });
        for (const pending of this.queue.splice(0, this.queue.length)) {
          this.dispatch(pending);
        }
      },
    );
  }

  private dispatch(msg: SignalClientMessage) {
    if (!this.userId) return;
    if (msg.type === "hello") return;
    // The table is built from these same message types, so the widening here
    // only erases the per-key parameter type, not a real check.
    const handler = this.handlers[msg.type] as (m: SignalClientMessage) => void;
    handler(msg);
  }

  private onCreate() {
    const senderId = this.requireUserId();
    const session = this.store.create({
      id: senderId,
      name: this.clientName || "Host",
      socket: this.socket,
      online: true,
      host: true,
    });
    this.joined.add(session.id);
    this.logger.info("session_created", { sessionId: session.id, hostId: senderId });
    send(this.socket, { type: "session-created", sessionId: session.id });
    send(this.socket, {
      type: "roster",
      sessionId: session.id,
      members: rosterFor(session),
    });
  }

  private onListSessions() {
    const senderId = this.requireUserId();
    const list = this.store
      .all()
      .filter(
        (s) =>
          s.status === "live" && s.hostId === senderId && s.members.get(senderId)?.socket,
      )
      .map((s) => ({
        id: s.id,
        memberCount: [...s.members.values()].filter((m) => m.online).length,
      }));
    send(this.socket, { type: "sessions", sessions: list });
  }

  private onHostOpen(sessionId: SessionId) {
    const senderId = this.requireUserId();
    const existing = this.store.get(sessionId);
    if (!existing || existing.status !== "live" || existing.hostId !== senderId) {
      this.logger.warn("host_open_rejected", {
        sessionId,
        userId: senderId,
        reason: existing ? "not-host" : "no-session",
      });
      send(this.socket, {
        type: "error",
        code: existing ? "not-host" : "no-session",
        message: existing ? "Only the host can reopen" : "Session not found",
      });
      return;
    }
    let member = existing.members.get(senderId);
    if (!member) {
      member = {
        id: senderId,
        name: this.clientName || "Host",
        socket: null,
        online: false,
        host: false,
      };
      existing.members.set(senderId, member);
    }
    member.socket = this.socket;
    member.online = true;
    member.host = true;
    existing.hostId = senderId;
    this.joined.add(existing.id);
    send(this.socket, {
      type: "roster",
      sessionId: existing.id,
      members: rosterFor(existing),
    });
    for (const knock of existing.knocks.values()) {
      send(this.socket, {
        type: "knock",
        sessionId: existing.id,
        visitorId: knock.id,
        visitorName: knock.name,
      });
    }
    broadcastRoster(existing);
  }

  private onKnock(sessionId: SessionId) {
    const senderId = this.requireUserId();
    const session = this.store.live(sessionId);
    if (!session) {
      send(this.socket, {
        type: "error",
        code: "no-session",
        message: "Session not found or ended",
      });
      return;
    }
    const member = session.members.get(senderId);
    if (member) {
      member.socket = this.socket;
      member.online = true;
      this.joined.add(session.id);
      send(this.socket, { type: "admitted", sessionId: session.id });
      broadcastRoster(session);
      return;
    }
    const name = this.clientName || "Visitor";
    session.knocks.set(senderId, {
      id: senderId,
      name,
      socket: this.socket,
      online: true,
      host: false,
    });
    this.joined.add(session.id);
    const host = session.members.get(session.hostId);
    if (host?.socket) {
      send(host.socket, {
        type: "knock",
        sessionId: session.id,
        visitorId: senderId,
        visitorName: name,
      });
    }
  }

  private onAdmission(sessionId: SessionId, visitorId: UserId, admit: boolean) {
    const senderId = this.requireUserId();
    const session = this.store.live(sessionId);
    if (!session || !canSend(session, senderId, "host").ok) return;
    const knock = session.knocks.get(visitorId);
    if (!knock) return;
    if (admit && !hasMemberRoom(session, visitorId)) {
      this.logger.warn("admission_refused", { sessionId, visitorId, reason: "full" });
      send(this.socket, { type: "error", code: "full", message: "Session is full" });
      // The visitor is the one left staring at a loading screen otherwise.
      if (knock.socket) {
        send(knock.socket, {
          type: "error",
          code: "full",
          message: "Session is full",
        });
      }
      return;
    }
    session.knocks.delete(visitorId);
    if (!admit) {
      this.logger.info("knock_denied", { sessionId: session.id, visitorId, by: senderId });
      if (knock.socket) {
        send(knock.socket, { type: "denied", sessionId: session.id });
      }
      return;
    }
    session.members.set(visitorId, {
      id: visitorId,
      name: knock.name,
      socket: knock.socket,
      online: Boolean(knock.socket),
      host: false,
    });
    if (knock.socket) {
      send(knock.socket, { type: "admitted", sessionId: session.id });
    }
    broadcastRoster(session);
  }

  private onRoomKey(sessionId: SessionId, to: UserId, key: string) {
    const senderId = this.requireUserId();
    const session = this.store.live(sessionId);
    if (!session || !canSend(session, senderId, "host").ok) return;
    const target = session.members.get(to) ?? session.knocks.get(to);
    if (target?.socket) {
      send(target.socket, { type: "room-key", sessionId: session.id, key });
    }
  }

  private onRoomMsg(msg: Extract<SignalClientMessage, { type: "room-msg" }>) {
    const senderId = this.requireUserId();
    const session = this.store.live(msg.sessionId);
    if (!session) return;
    const sender = session.members.get(senderId);
    if (!sender) return;
    // Member frames are human by default: `ai` is reserved for relay-originated
    // messages so no member can forge the Summon AI sender. The one exception
    // is this socket's own unspent summon grant.
    const kind = this.consumeAiGrant(msg.msgId) ? ("ai" as const) : ("human" as const);
    session.report.add(
      reportLineFor({
        senderId,
        senderName: sender.name,
        msgId: msg.msgId,
        kind,
      }),
    );
    const out: SignalServerMessage = {
      type: "room-msg",
      sessionId: session.id,
      msgId: msg.msgId,
      iv: msg.iv,
      enc: msg.enc,
      from: senderId,
      fromName: sender.name,
      kind,
    };
    for (const member of session.members.values()) {
      if (member.id !== senderId && member.socket) send(member.socket, out);
    }
  }

  private onSummon(msg: Extract<SignalClientMessage, { type: "summon" }>) {
    const senderId = this.requireUserId();
    const session = this.store.live(msg.sessionId);
    if (!session) {
      send(this.socket, {
        type: "ai-error",
        sessionId: msg.sessionId,
        requestId: msg.requestId,
        code: "no-session",
        message: "Session not found or ended",
      });
      return;
    }
    if (!canSend(session, senderId, "member").ok) return;
    if (!this.summonQuota.take(`user:${senderId}`)) {
      this.logger.warn("summon_rate_limited", { sessionId: session.id, userId: senderId });
      send(this.socket, {
        type: "ai-error",
        sessionId: session.id,
        requestId: msg.requestId,
        code: "ai-rate-limited",
        message: "Summon AI is answering too often, try again shortly",
      });
      return;
    }
    const provider = this.aiProvider;
    if (!provider) {
      send(this.socket, {
        type: "ai-error",
        sessionId: session.id,
        requestId: msg.requestId,
        code: "ai-unavailable",
        message: "Summon AI is not configured on this relay",
      });
      return;
    }
    // The relay proxies the provider call and keeps nothing: no roster entry,
    // no report line, no retained context. The answer goes back to the
    // summoner alone, who encrypts it and posts it to the room.
    const requestId = msg.requestId;
    const request = {
      question: msg.question,
      context: msg.context.slice(-MAX_SUMMON_CONTEXT_LINES),
    };
    void provider
      .complete(request)
      .then((answer) => {
        if (!answer.trim()) {
          send(this.socket, {
            type: "ai-error",
            sessionId: session.id,
            requestId,
            code: "ai-empty",
            message: "Summon AI returned an empty answer",
          });
          return;
        }
        // The grant is minted only now: a requestId that never produced an
        // answer must not be able to buy an ember sender.
        this.grantAi(requestId);
        send(this.socket, {
          type: "ai-answer",
          sessionId: session.id,
          requestId,
          answer: answer.trim(),
        });
      })
      .catch((cause: unknown) => {
        send(this.socket, {
          type: "ai-error",
          sessionId: session.id,
          requestId,
          code: "ai-failed",
          message: "Summon AI could not answer",
        });
        console.warn(
          JSON.stringify({
            event: "summon_failed",
            provider: provider.name,
            sessionId: session.id,
            requestId,
            reason: cause instanceof Error ? cause.message : String(cause),
          }),
        );
      });
  }

  private onJoin(sessionId: SessionId) {
    const senderId = this.requireUserId();
    const session = this.store.live(sessionId);
    if (!session) return;
    const member = session.members.get(senderId);
    if (!member?.socket || member.socket !== this.socket) return;
    const previous = this.rtc.sessionId;
    if (previous && this.rtc.peerId) {
      const prev = this.store.live(previous);
      if (prev) leaveRtc(prev, this.rtc.peerId);
    }
    if (!hasPeerRoom(session, senderId)) {
      send(this.socket, { type: "error", code: "full", message: "Session is full" });
      return;
    }
    this.rtc.sessionId = session.id;
    this.rtc.peerId = senderId;
    const existing = [...session.peers.keys()].filter((id) => id !== senderId);
    session.peers.set(senderId, this.socket);
    send(this.socket, { type: "peers", peers: existing });
    for (const [id, other] of session.peers) {
      if (id !== senderId) send(other, { type: "peer-joined", peerId: senderId });
    }
  }

  private onLeave(sessionId: SessionId) {
    const senderId = this.requireUserId();
    const session = this.store.get(sessionId);
    if (session && this.rtc.sessionId === sessionId && this.rtc.peerId) {
      leaveRtc(session, this.rtc.peerId);
    }
    if (this.rtc.sessionId === sessionId) {
      this.rtc.sessionId = null;
      this.rtc.peerId = null;
    }
    this.joined.delete(sessionId);
    if (!session || session.status !== "live") return;
    const member = session.members.get(senderId);
    if (member?.socket === this.socket) {
      member.online = false;
      member.socket = null;
      broadcastRoster(session);
    }
    const knock = session.knocks.get(senderId);
    if (knock?.socket === this.socket) session.knocks.delete(senderId);
  }

  private onEnd(sessionId: SessionId) {
    const senderId = this.requireUserId();
    const session = this.store.get(sessionId);
    if (!session || session.status !== "live") return;
    if (!canSend(session, senderId, "host").ok) return;
    this.store.end(session);
  }

  private onReport(sessionId: SessionId) {
    const senderId = this.requireUserId();
    const session = this.store.get(sessionId);
    const guard = canReadReport(session, senderId);
    if (!guard.ok) {
      this.logger.warn("report_denied", { sessionId, userId: senderId, code: guard.denial.code });
      send(this.socket, { type: "error", ...guard.denial });
      return;
    }
    if (!session) {
      send(this.socket, { type: "report", sessionId, lines: [], endedAt: null });
      return;
    }
    send(this.socket, {
      type: "report",
      sessionId: session.id,
      lines: this.store.reportLines(session),
      endedAt: session.endedAt ? new Date(session.endedAt).toISOString() : null,
    });
  }

  private onRtc(msg: RtcMessage) {
    const peerId = this.rtc.peerId;
    if (!this.rtc.sessionId || !peerId) return;
    const session = this.store.get(this.rtc.sessionId);
    const target = session?.peers.get(msg.to);
    if (!target) return;
    if (msg.type === "rtc-offer") {
      send(target, { type: "rtc-offer", from: peerId, sdp: msg.sdp });
    } else if (msg.type === "rtc-answer") {
      send(target, { type: "rtc-answer", from: peerId, sdp: msg.sdp });
    } else {
      send(target, { type: "rtc-ice", from: peerId, candidate: msg.candidate });
    }
  }

  private leaveAll() {
    const senderId = this.userId;
    if (senderId) {
      for (const sessionId of this.joined) {
        const session = this.store.get(sessionId);
        if (!session || session.status !== "live") continue;
        if (this.rtc.sessionId === sessionId && this.rtc.peerId) {
          leaveRtc(session, this.rtc.peerId);
        }
        const knock = session.knocks.get(senderId);
        if (knock?.socket === this.socket) session.knocks.delete(senderId);
        const member = session.members.get(senderId);
        if (member?.socket === this.socket) {
          member.online = false;
          member.socket = null;
          broadcastRoster(session);
        }
      }
    }
    this.joined.clear();
    this.rtc.sessionId = null;
    this.rtc.peerId = null;
  }

  /** Expired grants are dropped on every write, so the map stays bounded. */
  private grantAi(requestId: string) {
    const at = this.now();
    for (const [id, expiresAt] of this.aiGrants) {
      if (expiresAt <= at) this.aiGrants.delete(id);
    }
    this.aiGrants.set(requestId, at + AI_GRANT_TTL_MS);
  }

  /** Single use: a requestId authorises exactly one ai room message. */
  private consumeAiGrant(msgId: string): boolean {
    const expiresAt = this.aiGrants.get(msgId);
    if (expiresAt === undefined) return false;
    this.aiGrants.delete(msgId);
    return expiresAt > this.now();
  }

  private requireUserId(): UserId {
    if (this.userId === null) throw new Error("unauthenticated frame");
    return this.userId;
  }
}

type Handlers = {
  [T in Exclude<SignalClientMessage["type"], "hello">]: (
    msg: Extract<SignalClientMessage, { type: T }>,
  ) => void;
};

export function startRelay(options: RelayOptions) {
  const wss = new WebSocketServer({ port: options.port });
  const log = options.logger ?? defaultLogger;
  const store = new SessionStore(log);

  wss.on("connection", (socket) => {
    const connection = new Connection(
      socket,
      store,
      options.tokenSecret,
      options.aiProvider,
      options.now,
      log,
    );
    socket.on("message", (raw) => connection.onMessage(raw));
    socket.on("close", () => connection.close());
  });

  return {
    wss,
    store,
    port: () => {
      const address = wss.address();
      return typeof address === "object" && address ? address.port : options.port;
    },
  };
}

function defaultAiProvider(): AiProvider | null {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  return createGroqProvider({
    apiKey: key,
    model: process.env.SUMMON_MODEL ?? DEFAULT_SUMMON_MODEL,
  });
}

const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  const port = Number(process.env.PORT ?? 8787);
  const aiProvider = defaultAiProvider();
  if (!aiProvider) {
    // The relay still serves chat and video without a provider key; only @ai
    // fails, with an explicit error frame instead of a silent dead end.
    console.warn(
      "GROQ_API_KEY is not set. Summon AI will answer with ai-error/unavailable.",
    );
  }
  const relay = startRelay({
    port,
    tokenSecret: process.env.TOKEN_SECRET ?? "summon-dev-secret",
    aiProvider,
  });
  console.log(
    `summon signal relay listening on :${port} (summon-ai: ${aiProvider ? aiProvider.name : "unconfigured"})`,
  );
}
