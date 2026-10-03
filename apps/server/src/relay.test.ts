import {
  MAX_SESSION_PEERS,
  signToken,
  type SignalClientMessage,
  type SignalServerMessage,
} from "@summon/core";
import { afterEach, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { AiProvider } from "./ai";
import { hasPeerRoom, type SessionRec } from "./authz";
import { startRelay, SUMMON_LIMIT_PER_MINUTE } from "./index";
import { createReportBuffer, MAX_REPORT_LINES, reportLineFor } from "./report";
import { createLogger, type Logger } from "./logger";

const secret = "test-secret";

type Predicate = (message: SignalServerMessage) => boolean;

class TestClient {
  private readonly socket: WebSocket;
  private readonly seen: SignalServerMessage[] = [];
  private readonly waiters: { predicate: Predicate; resolve: (m: SignalServerMessage) => void }[] = [];
  readonly url: string;
  userId = "";

  private constructor(socket: WebSocket, url: string) {
    this.socket = socket;
    this.url = url;
    socket.on("message", (raw) => {
      const message = JSON.parse(String(raw)) as SignalServerMessage;
      this.seen.push(message);
      for (const waiter of [...this.waiters]) {
        if (waiter.predicate(message)) {
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          waiter.resolve(message);
        }
      }
    });
  }

  static async connect(url: string): Promise<TestClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return new TestClient(socket, url);
  }

  send(message: SignalClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  seenFrames(): SignalServerMessage[] {
    return [...this.seen];
  }

  /** Resolves with the first frame matching `predicate`, past or future. */
  waitFor<T extends SignalServerMessage>(
    predicate: (m: SignalServerMessage) => m is T,
    timeoutMs?: number,
  ): Promise<T>;
  waitFor(predicate: Predicate, timeoutMs?: number): Promise<SignalServerMessage>;
  waitFor(predicate: Predicate, timeoutMs = 2000): Promise<SignalServerMessage> {
    const existing = this.seen.find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((w) => w.resolve === wrapped);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(
          new Error(
            `timed out(${this.userId}) waiting for frame; got ${JSON.stringify(this.seen)}`,
          ),
        );
      }, timeoutMs);
      const wrapped = (message: SignalServerMessage) => {
        clearTimeout(timer);
        resolve(message);
      };
      this.waiters.push({ predicate, resolve: wrapped });
    });
  }

  waitForType<T extends SignalServerMessage["type"]>(
    type: T,
    timeoutMs?: number,
  ): Promise<Extract<SignalServerMessage, { type: T }>> {
    return this.waitFor(
      (m): m is Extract<SignalServerMessage, { type: T }> => m.type === type,
      timeoutMs,
    );
  }

  frames(): SignalServerMessage[] {
    return [...this.seen];
  }

  async hello(userId: string, name: string): Promise<void> {
    this.userId = userId;
    this.send({ type: "hello", token: await signToken(userId, secret), name });
    await this.waitFor((m) => m.type === "ready" || m.type === "error");
    byUserId.set(userId, this);
  }

  async createSession(): Promise<string> {
    this.send({ type: "create" });
    const created = await this.waitForType("session-created");
    return created.sessionId;
  }

  close(): void {
    this.socket.close();
  }
}

const cleanups: (() => void)[] = [];
const byUserId = new Map<string, TestClient>();

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function fakeAi(answer = "Ada mentioned three deadlines."): AiProvider {
  return { name: "fake", complete: () => Promise.resolve(answer) };
}

async function startTestRelay(options?: {
  aiProvider?: AiProvider;
  now?: () => number;
  logger?: Logger;
}) {
  const relay = startRelay({
    port: 0,
    tokenSecret: secret,
    aiProvider: options?.aiProvider ?? null,
    now: options?.now,
    logger: options?.logger,
  });
  const port = relay.port();
  const url = `ws://127.0.0.1:${port}`;
  cleanups.push(() => {
    for (const client of relay.wss.clients) client.terminate();
    relay.close();
  });
  return { relay, url };
}

async function connect(url: string) {
  const client = await TestClient.connect(url);
  cleanups.push(() => client.close());
  return client;
}
/** Knocks as `visitorId` and lets the host admit it; returns the visitor. */
async function admit(
  sessionId: string,
  hostId: string,
  visitorId: string,
  visitorName: string,
): Promise<TestClient> {
  const host = byUserId.get(hostId);
  if (!host) throw new Error(`no host client for ${hostId}`);
  const visitor = await connect(host.url);
  await visitor.hello(visitorId, visitorName);
  visitor.send({ type: "knock", sessionId });
  await host.waitFor((m) => m.type === "knock" && m.visitorId === visitorId);
  host.send({ type: "admit", sessionId, visitorId });
  await visitor.waitForType("admitted");
  return visitor;
}

/** Sends a `summon` and resolves with the requestId the relay echoes back. */
async function summon(client: TestClient, sessionId: string, requestId: string) {
  client.send({
    type: "summon",
    sessionId,
    requestId,
    question: "what did we agree?",
    context: [],
  });
  const answer = await client.waitFor((m) => m.type === "ai-answer");
  if (answer.type !== "ai-answer") throw new Error("expected ai-answer");
  expect(answer.requestId).toBe(requestId);
  return answer;
}

function roomMsgOf(msgId: string) {
  return (m: SignalServerMessage): m is Extract<SignalServerMessage, { type: "room-msg" }> =>
    m.type === "room-msg" && m.msgId === msgId;
}

function fakeSession(peerCount: number): SessionRec {
  const peers = new Map<string, WebSocket>();
  for (let i = 0; i < peerCount; i += 1) {
    peers.set(`peer-${i}`, null as unknown as WebSocket);
  }
  return {
    id: "session-1",
    hostId: "host-1",
    status: "live",
    members: new Map(),
    knocks: new Map(),
    peers,
    report: createReportBuffer(),
    endedAt: null,
    reportTtl: null,
  };
}

it("P0-2: a member may read its own session report", async () => {
  const { url } = await startTestRelay();
  const host = await connect(url);
  await host.hello("host-1", "Ada");
  const sessionId = await host.createSession();

  host.send({ type: "report", sessionId });
  const report = await host.waitForType("report");
  expect(report.sessionId).toBe(sessionId);
  expect(report.lines).toEqual([]);
});

it("P0-2: a non-member requesting another session's report is forbidden", async () => {
  const { url } = await startTestRelay();
  const host = await connect(url);
  await host.hello("host-1", "Ada");
  const sessionId = await host.createSession();

  const stranger = await connect(url);
  await stranger.hello("host-2", "Eve");
  stranger.send({ type: "report", sessionId });

  const error = await stranger.waitForType("error");
  expect(error).toEqual({
    type: "error",
    code: "forbidden",
    message: "You are not a member of this session",
  });
  expect(stranger.frames().filter((m) => m.type === "report")).toHaveLength(0);
});

it("P0-2: a member of session A cannot read session B's report", async () => {
  const { url } = await startTestRelay();
  const hostA = await connect(url);
  await hostA.hello("host-1", "Ada");
  const sessionA = await hostA.createSession();

  const hostB = await connect(url);
  await hostB.hello("host-2", "Eve");
  const sessionB = await hostB.createSession();

  const memberA = await admit(sessionA, "host-1", "member-1", "Bob");

  memberA.send({ type: "report", sessionId: sessionB });
  const error = await memberA.waitForType("error");
  expect(error.type === "error" && error.code).toBe("forbidden");
  expect(memberA.frames().filter((m) => m.type === "report")).toHaveLength(0);
});

it("P0-6: a report line is metadata only", () => {
  const line = reportLineFor({
    senderId: "host-1",
    senderName: "Ada",
    msgId: "m1",
    kind: "human",
  });
  expect(Object.keys(line).sort()).toEqual([
    "at",
    "kind",
    "msgId",
    "senderId",
    "senderName",
  ]);
});

it("P0-6: no report field holds message content", () => {
  const line = reportLineFor({
    senderId: "host-1",
    senderName: "Ada",
    msgId: "m1",
    kind: "human",
  });
  expect(line).not.toHaveProperty("excerpt");
  expect(line).not.toHaveProperty("body");
  for (const value of Object.values(line)) {
    expect(typeof value).toBe("string");
  }
});

it("P0-6: a posted room message leaves no plaintext on the relay report", async () => {
  const { url } = await startTestRelay();
  const host = await connect(url);
  await host.hello("host-1", "Ada");
  const sessionId = await host.createSession();

  host.send({
    type: "room-msg",
    sessionId,
    msgId: "m1",
    iv: "iv",
    enc: "ciphertext",
  });
  host.send({ type: "report", sessionId });
  const report = await host.waitForType("report");
  expect(report.lines).toHaveLength(1);
  expect(JSON.stringify(report.lines[0])).not.toMatch(/body|excerpt|plaintext/i);
});

it("P2-5: the report buffer keeps the newest 500 lines", () => {
  const buffer = createReportBuffer(MAX_REPORT_LINES);
  for (let i = 0; i < MAX_REPORT_LINES + 25; i += 1) {
    buffer.add(
      reportLineFor({
        senderId: "host-1",
        senderName: "Ada",
        msgId: `m${i}`,
        kind: "human",
      }),
    );
  }
  const lines = buffer.lines();
  expect(lines).toHaveLength(MAX_REPORT_LINES);
  expect(lines[0].msgId).toBe("m25");
  expect(lines[lines.length - 1].msgId).toBe(`m${MAX_REPORT_LINES + 24}`);
});

it("P1-4: a member frame claiming kind 'ai' is relayed as 'human'", async () => {
  const { url } = await startTestRelay();
  const host = await connect(url);
  await host.hello("host-1", "Ada");
  const sessionId = await host.createSession();
  const member = await admit(sessionId, "host-1", "member-1", "Bob");

  member.send({
    type: "room-msg",
    sessionId,
    msgId: "m1",
    iv: "iv",
    enc: "ciphertext",
    kind: "ai",
  });

  const relayed = await host.waitForType("room-msg");
  expect(relayed.kind).toBe("human");
  expect(relayed.from).toBe("member-1");

  host.send({ type: "report", sessionId });
  const report = await host.waitForType("report");
  expect(report.lines.map((line) => line.kind)).toEqual(["human"]);
});

it("P1-4: the summoner relays its own answer as kind 'ai'", async () => {
  const { url } = await startTestRelay({ aiProvider: fakeAi() });
  const host = await connect(url);
  await host.hello("host-1", "Ada");
  const sessionId = await host.createSession();
  const member = await admit(sessionId, "host-1", "member-1", "Bob");

  await summon(host, sessionId, "req-1");
  host.send({
    type: "room-msg",
    sessionId,
    msgId: "req-1",
    iv: "iv",
    enc: "ciphertext",
    kind: "ai",
  });

  const relayed = await member.waitFor(roomMsgOf("req-1"));
  expect(relayed.kind).toBe("ai");

  host.send({ type: "report", sessionId });
  const report = await host.waitForType("report");
  expect(report.lines.map((line) => line.kind)).toEqual(["ai"]);
});

it("P1-4: a requestId authorises only one ai message", async () => {
  const { url } = await startTestRelay({ aiProvider: fakeAi() });
  const host = await connect(url);
  await host.hello("host-1", "Ada");
  const sessionId = await host.createSession();
  const member = await admit(sessionId, "host-1", "member-1", "Bob");

  await summon(host, sessionId, "req-1");
  host.send({
    type: "room-msg",
    sessionId,
    msgId: "req-1",
    iv: "iv",
    enc: "first",
    kind: "ai",
  });
  await member.waitFor(roomMsgOf("req-1"));
  host.send({
    type: "room-msg",
    sessionId,
    msgId: "req-1",
    iv: "iv",
    enc: "second",
    kind: "ai",
  });

  host.send({ type: "report", sessionId });
  const report = await host.waitForType("report");
  expect(report.lines.map((line) => line.kind)).toEqual(["ai", "human"]);
});

it("P1-4: another socket cannot reuse someone else's requestId", async () => {
  const { url } = await startTestRelay({ aiProvider: fakeAi() });
  const host = await connect(url);
  await host.hello("host-1", "Ada");
  const sessionId = await host.createSession();
  const member = await admit(sessionId, "host-1", "member-1", "Bob");

  await summon(host, sessionId, "req-1");
  member.send({
    type: "room-msg",
    sessionId,
    msgId: "req-1",
    iv: "iv",
    enc: "ciphertext",
    kind: "ai",
  });

  const relayed = await host.waitFor(roomMsgOf("req-1"));
  expect(relayed.kind).toBe("human");
  expect(relayed.from).toBe("member-1");
});

it("P1-4: a requestId older than the window no longer authorises ai", async () => {
  let clock = 1_000_000;
  const { url } = await startTestRelay({
    aiProvider: fakeAi(),
    now: () => clock,
  });
  const host = await connect(url);
  await host.hello("host-1", "Ada");
  const sessionId = await host.createSession();
  const member = await admit(sessionId, "host-1", "member-1", "Bob");

  await summon(host, sessionId, "req-1");
  clock += 5 * 60_000;
  member.send({
    type: "room-msg",
    sessionId,
    msgId: "req-1",
    iv: "iv",
    enc: "ciphertext",
    kind: "ai",
  });

  expect((await host.waitFor(roomMsgOf("req-1"))).kind).toBe("human");
});

it("P2-1: hello and create in the same batch create a session", async () => {
  const { url } = await startTestRelay();
  const host = await connect(url);
  host.send({ type: "hello", token: await signToken("host-1", secret), name: "Ada" });
  host.send({ type: "create" });

  const created = await host.waitForType("session-created");
  const roster = await host.waitForType("roster");
  expect(roster.members).toEqual([
    { id: "host-1", name: "Ada", online: true, host: true },
  ]);
  expect(created.sessionId).toBe(roster.sessionId);
});

it("P2-2: a second hello is rejected and the identity is unchanged", async () => {
  const { url } = await startTestRelay();
  const host = await connect(url);
  host.send({ type: "hello", token: await signToken("host-1", secret), name: "Ada" });
  host.send({ type: "hello", token: await signToken("intruder", secret), name: "Eve" });

  const errors = await host.waitFor((m) => m.type === "error");
  expect(errors.type === "error" && errors.code).toBe("already-authenticated");

  host.send({ type: "create" });
  const roster = await host.waitForType("roster");
  expect(roster.members.map((m) => m.id)).toEqual(["host-1"]);
});

it("P2-3: admitting past the peer cap replies error/full", async () => {
  const { url } = await startTestRelay();
  const host = await connect(url);
  await host.hello("host-1", "Ada");
  const sessionId = await host.createSession();

  for (let i = 0; i < 5; i += 1) {
    const peer = await admit(sessionId, "host-1", `peer-${i}`, `Peer ${i}`);
    peer.send({ type: "join", sessionId });
    await peer.waitForType("peers");
  }
  host.send({ type: "join", sessionId });
  await host.waitForType("peers");

  const extra = await connect(url);
  await extra.hello("extra-1", "Xena");
  extra.send({ type: "knock", sessionId });
  await host.waitFor((m) => m.type === "knock" && m.visitorId === "extra-1");
  host.send({ type: "admit", sessionId, visitorId: "extra-1" });

  const error = await host.waitForType("error");
  expect(error).toEqual({
    type: "error",
    code: "full",
    message: "Session is full",
  });
  expect(extra.frames().filter((m) => m.type === "admitted")).toHaveLength(0);
});

it("P2-4: the peer cap is the shared MAX_SESSION_PEERS constant", () => {
  const full = fakeSession(MAX_SESSION_PEERS);
  expect(hasPeerRoom(full, "extra")).toBe(false);
  expect(hasPeerRoom(full, "peer-0")).toBe(true);
  expect(hasPeerRoom(fakeSession(MAX_SESSION_PEERS - 1), "extra")).toBe(true);
});

it("relay: end notifies members and the report keeps lines afterwards", async () => {
  const { url } = await startTestRelay();
  const host = await connect(url);
  await host.hello("host-1", "Ada");
  const sessionId = await host.createSession();
  const member = await admit(sessionId, "host-1", "member-1", "Bob");

  member.send({
    type: "room-msg",
    sessionId,
    msgId: "m1",
    iv: "iv",
    enc: "ciphertext",
  });
  await host.waitForType("room-msg");
  host.send({ type: "end", sessionId });
  await member.waitForType("session-ended");

  member.send({ type: "report", sessionId });
  const report = await member.waitForType("report");
  expect(report.endedAt).not.toBeNull();
  expect(report.lines.map((line) => line.msgId)).toEqual(["m1"]);
});

it("relay: leave marks the member offline in the roster", async () => {
  const { url } = await startTestRelay();
  const host = await connect(url);
  await host.hello("host-1", "Ada");
  const sessionId = await host.createSession();
  const member = await admit(sessionId, "host-1", "member-1", "Bob");

  member.send({ type: "leave", sessionId });
  const roster = await host.waitFor(
    (m) => m.type === "roster" && m.members.some((x) => x.id === "member-1" && !x.online),
  );
  expect(roster.type === "roster" && roster.members).toHaveLength(2);
});

it("relay: rtc frames reach only the addressed peer", async () => {
  const { url } = await startTestRelay();
  const host = await connect(url);
  await host.hello("host-1", "Ada");
  const sessionId = await host.createSession();
  const member = await admit(sessionId, "host-1", "member-1", "Bob");
  host.send({ type: "join", sessionId });
  await host.waitForType("peers");
  member.send({ type: "join", sessionId });
  await member.waitForType("peers");

  member.send({ type: "rtc-offer", to: "host-1", sdp: "offer-sdp" });
  const offer = await host.waitForType("rtc-offer");
  expect(offer).toEqual({ type: "rtc-offer", from: "member-1", sdp: "offer-sdp" });

  const stranger = await connect(url);
  await stranger.hello("stranger-1", "Mallory");
  stranger.send({ type: "knock", sessionId });
  await host.waitForType("knock");
  host.send({ type: "deny", sessionId, visitorId: "stranger-1" });
  await stranger.waitForType("denied");
});

it("relay: list-sessions shows only the caller's own live sessions", async () => {
  const { url } = await startTestRelay();
  const host = await connect(url);
  await host.hello("host-1", "Ada");
  const sessionId = await host.createSession();
  const other = await connect(url);
  await other.hello("host-2", "Eve");
  await other.createSession();

  other.send({ type: "list-sessions" });
  const list = await other.waitForType("sessions");
  expect(list.sessions).toHaveLength(1);
  expect(list.sessions[0].id).not.toBe(sessionId);
  expect(list.sessions[0].memberCount).toBe(1);
});

it("relay: a knock on an unknown session is refused", async () => {
  const { url } = await startTestRelay();
  const guest = await connect(url);
  await guest.hello("guest-1", "Gus");
  guest.send({ type: "knock", sessionId: "does-not-exist" });
  const error = await guest.waitForType("error");
  expect(error.type === "error" && error.code).toBe("no-session");
});

it("P2-3: admission has its own ceiling, not just the mesh", async () => {
  const { relay, url } = await startTestRelay();
  const host = await connect(url);
  await host.hello("host-1", "Ada");
  const sessionId = await host.createSession();

  // The host already occupies one slot.
  const store = relay.store;
  for (let i = 0; i < MAX_SESSION_PEERS - 1; i += 1) {
    const member = await connect(url);
    await member.hello(`guest-${i}`, `Guest ${i}`);
    member.send({ type: "knock", sessionId });
    await host.waitFor((m) => m.type === "knock" && m.visitorId === `guest-${i}`);
    host.send({ type: "admit", sessionId, visitorId: `guest-${i}` });
    await member.waitForType("admitted");
  }

  const visitor = await connect(url);
  await visitor.hello("visitor-1", "Eve");
  visitor.send({ type: "knock", sessionId });
  await host.waitFor((m) => m.type === "knock" && m.visitorId === "visitor-1");
  host.send({ type: "admit", sessionId, visitorId: "visitor-1" });

  // The host is told the session is full; the visitor simply waits.
  const reply = await host.waitFor((m) => m.type === "error");
  expect(reply.type === "error" && reply.code).toBe("full");
  expect(store.get(sessionId)?.members.has("visitor-1")).toBe(false);
});

it("P1-4: a member cannot drain the provider with repeated summons", async () => {
  let calls = 0;
  const relay = await startTestRelay({
    aiProvider: {
      name: "counting",
      complete: () => {
        calls += 1;
        return Promise.resolve("short answer");
      },
    },
  });
  const host = await connect(relay.url);
  await host.hello("host-1", "Ada");
  const sessionId = await host.createSession();

  for (let i = 0; i < 12; i += 1) {
    host.send({
      type: "summon",
      sessionId,
      requestId: `req-${i}`,
      question: "what did we agree?",
      context: [],
    });
  }

  const limited = await host.waitFor(
    (m) => m.type === "ai-error" && m.code === "ai-rate-limited",
  );
  expect(limited.type).toBe("ai-error");
  expect(calls).toBeLessThanOrEqual(SUMMON_LIMIT_PER_MINUTE);
});

it("P1-4: one member's spending does not block another's", async () => {
  let calls = 0;
  const relay = await startTestRelay({
    aiProvider: {
      name: "counting",
      complete: () => {
        calls += 1;
        return Promise.resolve("answer");
      },
    },
  });
  const host = await connect(relay.url);
  await host.hello("host-1", "Ada");
  const sessionId = await host.createSession();
  const guest = await connect(relay.url);
  await guest.hello("guest-1", "Bob");
  guest.send({ type: "knock", sessionId });
  await host.waitFor((m) => m.type === "knock" && m.visitorId === "guest-1");
  host.send({ type: "admit", sessionId, visitorId: "guest-1" });
  await guest.waitForType("admitted");

  for (let i = 0; i < 12; i += 1) {
    host.send({
      type: "summon",
      sessionId,
      requestId: `h-${i}`,
      question: "q",
      context: [],
    });
  }
  await host.waitFor((m) => m.type === "ai-error" && m.code === "ai-rate-limited");

  const before = calls;
  guest.send({ type: "summon", sessionId, requestId: "g-1", question: "q", context: [] });
  await guest.waitFor((m) => m.type === "ai-answer" || m.type === "ai-error");
  expect(calls).toBe(before + 1);
});

it("P2-3: a refused visitor is told the session is full, not left waiting", async () => {
  const { relay, url } = await startTestRelay();
  const host = await connect(url);
  await host.hello("host-1", "Ada");
  const sessionId = await host.createSession();

  // Fill every membership slot without any of them taking a mesh slot.
  const session = relay.store.get(sessionId);
  if (!session) throw new Error("session missing");
  for (let i = 0; i < MAX_SESSION_PEERS; i += 1) {
    session.members.set(`guest-${i}`, {
      id: `guest-${i}`,
      name: `Guest ${i}`,
      socket: null,
      host: false,
      online: false,
    });
  }

  const visitor = await connect(url);
  await visitor.hello("visitor-1", "Eve");
  visitor.send({ type: "knock", sessionId });
  await host.waitFor((m) => m.type === "knock" && m.visitorId === "visitor-1");
  host.send({ type: "admit", sessionId, visitorId: "visitor-1" });

  const visitorFrame = await visitor.waitFor(
    (m) => m.type === "error" || m.type === "room-key",
  );
  expect(visitorFrame.type).toBe("error");
  expect(visitorFrame.type === "error" && visitorFrame.code).toBe("full");
});

it("P5-8: the relay reports its decisions as structured logs", async () => {
  const lines: string[] = [];
  const relay = await startTestRelay({
    logger: createLogger({ sink: (line) => lines.push(line) }),
  });

  const mallory = await connect(relay.url);
  mallory.send({ type: "hello", token: "forged.signature", name: "Mallory" });
  await mallory.waitFor((m) => m.type === "error" && m.code === "bad-token");

  const host = await connect(relay.url);
  await host.hello("host-1", "Ada");
  const sessionId = await host.createSession();
  await host.send({ type: "end", sessionId });
  await host.waitFor((m) => m.type === "session-ended");

  const events = lines.map((line) => JSON.parse(line) as { event: string });
  const names = events.map((e) => e.event);
  expect(names).toContain("auth_failed");
  expect(names).toContain("session_created");
  expect(names).toContain("session_ended");
  expect(lines.every((line) => !line.includes("\n"))).toBe(true);

  const failed = events.find((e) => e.event === "auth_failed");
  expect(failed).toMatchObject({ level: "warn", code: "bad-token" });
  const ended = events.find((e) => e.event === "session_ended");
  expect(ended).toMatchObject({ sessionId, hostId: "host-1" });
  expect(lines.join("\n")).not.toContain("forged");
});

it("P5-8: a denied knock is logged, and the report denial too", async () => {
  const lines: string[] = [];
  const relay = await startTestRelay({
    logger: createLogger({ sink: (line) => lines.push(line) }),
  });
  const host = await connect(relay.url);
  await host.hello("host-1", "Ada");
  const sessionId = await host.createSession();

  const visitor = await connect(relay.url);
  await visitor.hello("visitor-1", "Eve");
  visitor.send({ type: "knock", sessionId });
  await host.waitFor((m) => m.type === "knock" && m.visitorId === "visitor-1");
  host.send({ type: "deny", sessionId, visitorId: "visitor-1" });
  await visitor.waitForType("denied");

  const stranger = await connect(relay.url);
  await stranger.hello("stranger-1", "Mallory");
  stranger.send({ type: "report", sessionId });
  await stranger.waitFor((m) => m.type === "error" && m.code === "forbidden");

  const names = lines.map((line) => JSON.parse(line) as { event: string }).map((e) => e.event);
  expect(names).toContain("knock_denied");
  expect(names).toContain("report_denied");
});

it("DECISIONS #6: a new login evicts the member's old socket", async () => {
  const { url } = await startTestRelay();
  const first = await connect(url);
  await first.hello("host-1", "Ada");
  const sessionId = await first.createSession();

  const second = await connect(url);
  await second.hello("host-1", "Ada");

  // The old socket is told the account moved, rather than silently lingering.
  const evicted = await first.waitFor((m) => m.type === "error");
  expect(evicted.type === "error" && evicted.code).toBe("session-moved");

  const ready = await second.waitFor((m) => m.type === "ready");
  expect(ready.type === "ready" && ready.userId).toBe("host-1");

  // Authority moves with the login: the new socket still owns the session, so
  // a host-only action succeeds, while the old socket is powerless.
  second.send({ type: "end", sessionId });
  const ended = await second.waitFor((m) => m.type === "session-ended");
  expect(ended.type).toBe("session-ended");

  first.send({ type: "end", sessionId });
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(first.seenFrames().some((m) => m.type === "session-ended")).toBe(false);
});
