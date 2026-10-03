import { describe, expect, it } from "vitest";
import { summonContextLines } from "./summon-context";
import type { SessionMessage } from "./session";

function message(over: Partial<SessionMessage> = {}): SessionMessage {
  return {
    id: "m-1",
    sessionId: "s-1",
    from: "u2",
    fromName: "Bob",
    body: "we ship on Friday",
    kind: "human",
    time: "10:00",
    readable: true,
    ...over,
  };
}

describe("summon context", () => {
  it("carries recent readable lines to the provider", () => {
    expect(summonContextLines([message()], 15)).toEqual([
      { name: "Bob", body: "we ship on Friday" },
    ]);
  });

  it("never sends a message that failed to decrypt", () => {
    const lines = summonContextLines(
      [
        message({ id: "a", body: "fine", readable: true }),
        message({ id: "b", body: "This message could not be decrypted.", readable: false }),
      ],
      15,
    );
    expect(lines).toEqual([{ name: "Bob", body: "fine" }]);
  });

  it("never sends Summon AI's own answers back", () => {
    const lines = summonContextLines(
      [
        message({ id: "a", body: "human line", readable: true }),
        message({ id: "b", body: "an earlier answer", kind: "ai", readable: true }),
      ],
      15,
    );
    expect(lines.map((l) => l.body)).toEqual(["human line"]);
  });

  it("labels your own lines as You", () => {
    expect(
      summonContextLines([message({ you: true, fromName: "Ada" })], 15),
    ).toEqual([{ name: "You", body: "we ship on Friday" }]);
  });

  it("keeps only the most recent lines", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      message({ id: `m-${i}`, body: `line ${i}` }),
    );
    const lines = summonContextLines(many, 15);
    expect(lines).toHaveLength(15);
    expect(lines[0].body).toBe("line 15");
    expect(lines[14].body).toBe("line 29");
  });

  it("drops blank lines", () => {
    expect(
      summonContextLines([message({ body: "   " }), message({ id: "b" })], 15),
    ).toHaveLength(1);
  });
});