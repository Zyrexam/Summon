import test from "node:test";
import assert from "node:assert/strict";
import { formatReport } from "./report.ts";

const lines = [
  {
    senderId: "u1",
    senderName: "Ada",
    msgId: "m-1",
    at: "2026-08-01T10:00:00.000Z",
    kind: "human" as const,
  },
  {
    senderId: "summon-ai",
    senderName: "Summon AI",
    msgId: "m-2",
    at: "2026-08-01T10:01:00.000Z",
    kind: "ai" as const,
  },
];

test("report lists sender, time and message reference", () => {
  const out = formatReport(lines, "2026-08-01T10:05:00.000Z");
  assert.match(out, /^# Summon session report/m);
  assert.match(out, /Ada/);
  assert.match(out, /Summon AI/);
  assert.match(out, /m-1/);
  assert.match(out, /10:01:00/);
});

test("report carries no message content", () => {
  const out = formatReport(lines, null);
  assert.equal(/excerpt|body|ciphertext/i.test(out), false);
});

test("empty report still renders a header", () => {
  const out = formatReport([], null);
  assert.match(out, /^# Summon session report/m);
  assert.match(out, /No lines/i);
});

test("report ends with the ended time when the session has ended", () => {
  assert.match(formatReport(lines, "2026-08-01T10:05:00.000Z"), /10:05:00/);
});

test("report escapes a pipe so a name cannot forge table columns", () => {
  const out = formatReport(
    [
      {
        senderId: "u1",
        senderName: "Ada | Bob",
        msgId: "m-1",
        at: "2026-08-01T10:00:00.000Z",
        kind: "human",
      },
    ],
    null,
  );
  const row = out.split("\n").find((line) => line.includes("Ada"));
  assert.equal(row, "| 10:00:00 | Ada \\| Bob | m-1 |");
});

test("report collapses newlines so a name cannot forge a row", () => {
  const out = formatReport(
    [
      {
        senderId: "u1",
        senderName: "Ada\n| injected | row",
        msgId: "m-1",
        at: "2026-08-01T10:00:00.000Z",
        kind: "human",
      },
    ],
    null,
  );
  assert.equal(
    out.split("\n").filter((line) => line.includes("injected")).length,
    1,
  );
});