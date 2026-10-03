import { describe, expect, test } from "vitest";
import { reportFileName, reportStateFrom } from "./report";

const line = {
  senderId: "u1",
  senderName: "Ada",
  msgId: "m-1",
  at: "2026-01-01T09:05:00.000Z",
  kind: "human" as const,
};

test("report file name carries the session and whether it ended", () => {
  expect(reportFileName("s1", "2026-01-01T10:00:00.000Z")).toMatch(
    /^summon-report-s1-.*\.md$/,
  );
  expect(reportFileName("s1", null)).toBe("summon-report-s1-live.md");
});

test("report file name is safe for a session id with path characters", () => {
  expect(reportFileName("../etc/passwd", null)).toBe(
    "summon-report-etc-passwd-live.md",
  );
});

test("ended report renders metadata rows and the end time", () => {
  const state = reportStateFrom("s1", [line], "2026-01-01T10:00:00.000Z");
  expect(state.ended).toBe(true);
  expect(state.markdown).toContain("| 09:05:00 | Ada | m-1 |");
  expect(state.markdown).toContain("Ended: 10:00:00 UTC");
  expect(state.markdown).not.toContain("Ada Lovelace is");
});

test("still-live report says so and keeps the same columns", () => {
  const state = reportStateFrom("s1", [line], null);
  expect(state.ended).toBe(false);
  expect(state.markdown).toContain("Status: still live");
  expect(state.markdown).toContain("| Time | Who | Message |");
});

test("malformed lines are dropped rather than rendered", () => {
  const state = reportStateFrom("s1", [line, { msgId: "m-2" } as never], null);
  expect(state.lines.map((l) => l.msgId)).toEqual(["m-1"]);
});

test("an empty session still produces a downloadable file", () => {
  const state = reportStateFrom("s1", [], null);
  expect(state.markdown).toContain("_No lines recorded._");
  expect(state.fileName).toBe("summon-report-s1-live.md");
});