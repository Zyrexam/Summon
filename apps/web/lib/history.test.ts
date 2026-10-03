import { describe, expect, test } from "vitest";
import { mergeHistory, type SessionMessage } from "./session";

function msg(id: string, body = id): SessionMessage {
  return {
    id,
    sessionId: "s1",
    from: "u1",
    fromName: "A",
    body,
    kind: "human",
    time: "10:00",
    readable: true,
  };
}

describe("mergeHistory", () => {
  test("empty history keeps live messages untouched", () => {
    const live = [msg("m1")];
    expect(mergeHistory(live, [])).toBe(live);
  });

  test("history lands under live messages, duplicates collapse", () => {
    const prev = [msg("m3", "live")];
    const incoming = [msg("m1"), msg("m2"), msg("m3", "replay")];
    const merged = mergeHistory(prev, incoming);
    expect(merged.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    // History order wins for duplicates; the live-only tail stays last.
    expect(merged[2]?.body).toBe("replay");
  });

  test("identical content returns the same reference", () => {
    const prev = [msg("m1")];
    expect(mergeHistory(prev, prev)).toBe(prev);
  });
});
