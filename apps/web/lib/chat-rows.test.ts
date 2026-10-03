import { describe, expect, test } from "vitest";
import type { RosterMember } from "@summon/core";
import type { SessionMessage } from "@/lib/session";
import { senderRows } from "./chat-rows";

function member(id: string): RosterMember {
  return { id, name: id, online: true, host: false };
}

function msg(over: Partial<SessionMessage> & { id: string }): SessionMessage {
  return {
    sessionId: "s1",
    from: "u1",
    fromName: "Ada",
    body: "hi",
    kind: "human",
    time: "9:05 AM",
    readable: true,
    ...over,
  };
}

function texts(rows: { id: string; text: string }[]): string[] {
  return rows.filter((r) => r.text !== "").map((r) => r.text);
}

describe("senderRows", () => {
  test("two humans never see a name, not even You", () => {
    const rows = senderRows(
      [
        msg({ id: "a", from: "u1", fromName: "Ada" }),
        msg({ id: "b", from: "u2", fromName: "Bob" }),
        msg({ id: "c", from: "u1", fromName: "Ada", you: true }),
      ],
      [member("u1"), member("u2")],
    );
    expect(texts(rows)).toEqual([]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  test("three humans show names, grouped per run", () => {
    const rows = senderRows(
      [
        msg({ id: "a", from: "u1", fromName: "Ada" }),
        msg({ id: "b", from: "u1", fromName: "Ada" }),
        msg({ id: "c", from: "u2", fromName: "Bob" }),
        msg({ id: "d", from: "u1", fromName: "Ada", you: true }),
      ],
      [member("u1"), member("u2"), member("u3")],
    );
    expect(rows.map((r) => [r.id, r.show, r.text])).toEqual([
      ["a", true, "Ada"],
      ["b", false, ""],
      ["c", true, "Bob"],
      ["d", true, "You"],
    ]);
  });

  test("Summon AI is labelled ember-side and never counted as human", () => {
    const rows = senderRows(
      [
        msg({ id: "a", from: "u1", fromName: "Ada" }),
        msg({ id: "b", from: "summon-ai", fromName: "Summon AI", kind: "ai" }),
        msg({ id: "c", from: "summon-ai", fromName: "Summon AI", kind: "ai" }),
        msg({ id: "d", from: "u1", fromName: "Ada" }),
      ],
      [member("u1")],
    );
    expect(rows.map((r) => [r.id, r.text])).toEqual([
      ["a", ""],
      ["b", "Summon AI"],
      ["c", ""],
      ["d", ""],
    ]);
  });

  test("an AI message breaks a human run", () => {
    const rows = senderRows(
      [
        msg({ id: "a", from: "u1", fromName: "Ada" }),
        msg({ id: "b", from: "u1", fromName: "Ada" }),
        msg({ id: "c", from: "summon-ai", fromName: "Summon AI", kind: "ai" }),
        msg({ id: "d", from: "u1", fromName: "Ada" }),
      ],
      [member("u1"), member("u2"), member("u3")],
    );
    expect(rows.map((r) => r.text)).toEqual(["Ada", "", "Summon AI", "Ada"]);
  });
});