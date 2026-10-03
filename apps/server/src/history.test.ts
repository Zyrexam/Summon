import { signToken, type HistoryMessage, type SignalServerMessage } from "@summon/core";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { startRelay } from "./index";
import type { SessionPersistence } from "./session-persist";

const secret = "history-test-secret-1234567890";

function memoryPersistence(canned: HistoryMessage[] = []) {
  const calls: string[] = [];
  const sessions = new Map<string, { hostId: string; members: Map<string, string> }>();
  const persistence = {
    async saveSession(id: string, hostId: string, hostName: string) {
      calls.push(`save-session:${id}`);
      sessions.set(id, { hostId, members: new Map([[hostId, hostName]]) });
    },
    async saveMember(sessionId: string, userId: string, name: string) {
      calls.push(`save-member:${sessionId}:${userId}`);
      sessions.get(sessionId)?.members.set(userId, name);
    },
    async saveMessage() {
      calls.push("save-message");
    },
    async endSession(id: string) {
      calls.push(`end-session:${id}`);
    },
    async historyFor() {
      return canned;
    },
    async reportFor(sessionId: string, userId: string) {
      const session = sessions.get(sessionId);
      if (!session || !session.members.has(userId)) return null;
      return {
        lines: canned.map((m) => ({
          senderId: m.from,
          senderName: m.fromName,
          msgId: m.msgId,
          at: m.at,
          kind: m.kind,
        })),
        endedAt: "2026-10-03T10:00:00.000Z",
      };
    },
    async loadLive() {
      return {
        sessions: [...sessions.entries()].map(([id, s]) => ({
          id,
          hostId: s.hostId,
          members: [...s.members.entries()].map(([mid, name]) => ({ id: mid, name, host: mid === s.hostId })),
        })),
        messages: new Map(),
      };
    },
  } as unknown as SessionPersistence;
  return { persistence, calls };
}

type Predicate = (m: SignalServerMessage) => boolean;

class Client {
  private readonly seen: SignalServerMessage[] = [];
  private constructor(private readonly socket: WebSocket) {
    socket.on("message", (raw) => {
      this.seen.push(JSON.parse(String(raw)) as SignalServerMessage);
    });
  }
  static async connect(url: string): Promise<Client> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return new Client(socket);
  }
  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }
  async waitFor(predicate: Predicate, timeoutMs = 2000): Promise<SignalServerMessage> {
    const existing = this.seen.find(predicate);
    if (existing) return existing;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout; saw ${JSON.stringify(this.seen)}`)), timeoutMs);
      const check = () => {
        const found = this.seen.find(predicate);
        if (found) {
          clearTimeout(timer);
          resolve(found);
        } else {
          setTimeout(check, 10);
        }
      };
      check();
    });
  }
  close(): void {
    this.socket.close();
  }
}

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

async function startTestRelay(persistence: SessionPersistence | null) {
  const relay = startRelay({ port: 0, tokenSecret: secret, aiProvider: null, persistence });
  const port = relay.port();
  cleanups.push(() => {
    for (const client of relay.wss.clients) client.terminate();
    relay.close();
  });
  return `ws://127.0.0.1:${port}`;
}

async function hello(url: string, userId: string, name: string): Promise<Client> {
  const client = await Client.connect(url);
  cleanups.push(() => client.close());
  client.send({ type: "hello", token: await signToken(userId, secret), name });
  await client.waitFor((m) => m.type === "ready");
  return client;
}

describe("session persistence", () => {
  it("write-through records create, admit, and messages", async () => {
    const { persistence, calls } = memoryPersistence();
    const url = await startTestRelay(persistence);
    const host = await hello(url, "host-1", "Host");
    host.send({ type: "create" });
    const created = await host.waitFor((m) => m.type === "session-created");
    if (created.type !== "session-created") throw new Error("no session");
    const visitor = await hello(url, "visitor-1", "Bee");
    visitor.send({ type: "knock", sessionId: created.sessionId });
    await host.waitFor((m) => m.type === "knock");
    host.send({ type: "admit", sessionId: created.sessionId, visitorId: "visitor-1" });
    await visitor.waitFor((m) => m.type === "admitted");
    host.send({
      type: "room-msg",
      sessionId: created.sessionId,
      msgId: "m1",
      iv: "aXY=",
      enc: "ZGVm",
      kind: "human",
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toContain(`save-session:${created.sessionId}`);
    expect(calls).toContain(`save-member:${created.sessionId}:visitor-1`);
    expect(calls).toContain("save-message");
  });

  it("a rejoining member receives missed ciphertext as history", async () => {
    const canned: HistoryMessage[] = [
      {
        msgId: "m1",
        iv: "aXY=",
        enc: "ZGVm",
        from: "host-1",
        fromName: "Host",
        kind: "human",
        at: new Date().toISOString(),
      },
    ];
    const { persistence } = memoryPersistence(canned);
    const url = await startTestRelay(persistence);
    const host = await hello(url, "host-1", "Host");
    host.send({ type: "create" });
    const created = await host.waitFor((m) => m.type === "session-created");
    if (created.type !== "session-created") throw new Error("no session");
    const visitor = await hello(url, "visitor-1", "Bee");
    visitor.send({ type: "knock", sessionId: created.sessionId });
    await host.waitFor((m) => m.type === "knock");
    host.send({ type: "admit", sessionId: created.sessionId, visitorId: "visitor-1" });
    await visitor.waitFor((m) => m.type === "admitted");
    const history = await visitor.waitFor((m) => m.type === "history");
    if (history.type !== "history") throw new Error("no history");
    expect(history.sessionId).toBe(created.sessionId);
    expect(history.messages).toHaveLength(1);
    expect(history.messages[0]?.msgId).toBe("m1");
  });

  it("boot restores live sessions so a reload rejoins", async () => {
    const first = memoryPersistence();
    const url = await startTestRelay(first.persistence);
    const host = await hello(url, "host-1", "Host");
    host.send({ type: "create" });
    const created = await host.waitFor((m) => m.type === "session-created");
    if (created.type !== "session-created") throw new Error("no session");

    // Simulate a restart: same persistence, fresh relay, then reload-knock.
    const relay2 = startRelay({
      port: 0,
      tokenSecret: secret,
      aiProvider: null,
      persistence: first.persistence,
    });
    const port2 = relay2.port();
    cleanups.push(() => {
      for (const client of relay2.wss.clients) client.terminate();
      relay2.close();
    });
    await new Promise((r) => setTimeout(r, 50));
    const reloaded = await hello(`ws://127.0.0.1:${port2}`, "host-1", "Host");
    reloaded.send({ type: "host-open", sessionId: created.sessionId });
    const roster = await reloaded.waitFor((m) => m.type === "roster");
    if (roster.type !== "roster") throw new Error("no roster");
    expect(roster.sessionId).toBe(created.sessionId);
    expect(roster.members.map((m) => m.id)).toContain("host-1");
  });

  it("relay works with persistence disabled", async () => {
    const url = await startTestRelay(null);
    const host = await hello(url, "host-1", "Host");
    host.send({ type: "create" });
    const created = await host.waitFor((m) => m.type === "session-created");
    expect(created.type).toBe("session-created");
  });

  it("a purged session still serves its report to members from the database", async () => {
    const canned: HistoryMessage[] = [
      {
        msgId: "m1",
        iv: "aXY=",
        enc: "ZGVm",
        from: "host-1",
        fromName: "Host",
        kind: "human",
        at: "2026-10-03T10:00:00.000Z",
      },
    ];
    const { persistence } = memoryPersistence(canned);
    const relay = startRelay({ port: 0, tokenSecret: secret, aiProvider: null, persistence });
    const url = `ws://127.0.0.1:${relay.port()}`;
    cleanups.push(() => {
      for (const client of relay.wss.clients) client.terminate();
      relay.close();
    });
    const host = await hello(url, "host-1", "Host");
    host.send({ type: "create" });
    const created = await host.waitFor((m) => m.type === "session-created");
    if (created.type !== "session-created") throw new Error("no session");
    host.send({ type: "end", sessionId: created.sessionId });
    await host.waitFor((m) => m.type === "session-ended");
    relay.store.purge(created.sessionId);

    host.send({ type: "report", sessionId: created.sessionId });
    const report = await host.waitFor((m) => m.type === "report");
    if (report.type !== "report") throw new Error("no report");
    expect(report.lines).toHaveLength(1);
    expect(report.endedAt).toBe("2026-10-03T10:00:00.000Z");

    const stranger = await hello(url, "stranger-1", "Zed");
    stranger.send({ type: "report", sessionId: created.sessionId });
    const denied = await stranger.waitFor((m) => m.type === "error");
    if (denied.type !== "error") throw new Error("no denial");
    expect(denied.code).toBe("forbidden");
  });
});
