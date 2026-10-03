import { describe, expect, it } from "vitest";
import type { HistoryMessage, Queryable } from "@summon/core";
import { HISTORY_LIMIT, SessionPersistence } from "./session-persist";

function recordingDb(rows: Record<string, Record<string, unknown>[]> = {}) {
  const calls: { text: string; values?: unknown[] }[] = [];
  const db: Queryable = {
    async query<T>(text: string, values?: unknown[]) {
      calls.push({ text, values });
      const key = text.trim().split("\n")[0];
      return { rows: ((rows[key] ?? []) as unknown as T[]) };
    },
  };
  return { db, calls };
}

describe("SessionPersistence", () => {
  it("round-trips live sessions with members and ordered ciphertext", async () => {
    const at = new Date("2026-10-03T10:00:00Z");
    const { db, calls } = recordingDb({
      "SELECT id, host_id FROM sessions WHERE status = 'live'": [
        { id: "s1", host_id: "host-1" },
      ],
      "SELECT session_id, user_id, name, host FROM session_members": [
        { session_id: "s1", user_id: "host-1", name: "Host", host: true },
        { session_id: "s1", user_id: "u2", name: "Bee", host: false },
      ],
      "SELECT session_id, msg_id, sender_id, sender_name, iv, enc, kind, created_at": [
        {
          session_id: "s1",
          msg_id: "m1",
          sender_id: "host-1",
          sender_name: "Host",
          iv: "iv1",
          enc: "enc1",
          kind: "human",
          created_at: at,
        },
      ],
    });
    const persistence = new SessionPersistence(db);
    const { sessions, messages } = await persistence.loadLive();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.members.map((m) => m.id)).toEqual(["host-1", "u2"]);
    const history = messages.get("s1") ?? [];
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      msgId: "m1",
      iv: "iv1",
      enc: "enc1",
      from: "host-1",
      kind: "human",
      at: at.toISOString(),
    });
    expect(calls.length).toBeGreaterThan(0);
  });

  it("stores ciphertext fields and caps history", async () => {
    const { db, calls } = recordingDb();
    const persistence = new SessionPersistence(db);
    await persistence.saveMessage("s1", {
      msgId: "m1",
      senderId: "u1",
      senderName: "A",
      iv: "iv",
      enc: "enc",
      kind: "human",
    });
    const insert = calls[0];
    expect(insert?.text).toContain("INSERT INTO messages");
    expect(insert?.values).toEqual(["s1", "m1", "u1", "A", "iv", "enc", "human"]);
    expect(calls[1]?.text).toContain(`LIMIT ${HISTORY_LIMIT}`);
  });

  it("never throws: a dead database degrades to memory-only", async () => {
    const db: Queryable = {
      async query() {
        throw new Error("connection refused");
      },
    };
    const persistence = new SessionPersistence(db);
    await persistence.saveSession("s", "h", "Host");
    await persistence.saveMember("s", "u", "U", false);
    await persistence.saveMessage("s", {
      msgId: "m",
      senderId: "u",
      senderName: "U",
      iv: "i",
      enc: "e",
      kind: "human",
    });
    await persistence.endSession("s");
    expect(await persistence.historyFor("s")).toEqual([]);
    const loaded = await persistence.loadLive();
    expect(loaded.sessions).toEqual([]);
  });

  it("history maps ai kind through", async () => {
    const { db } = recordingDb({
      "SELECT msg_id, sender_id, sender_name, iv, enc, kind, created_at": [
        {
          session_id: "s1",
          msg_id: "m9",
          sender_id: "u1",
          sender_name: "A",
          iv: "i",
          enc: "e",
          kind: "ai",
          created_at: new Date("2026-10-03T10:01:00Z"),
        },
      ],
    });
    const history: HistoryMessage[] = await new SessionPersistence(db).historyFor("s1");
    expect(history[0]?.kind).toBe("ai");
  });
});
