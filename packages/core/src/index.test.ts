import assert from "node:assert/strict";
import test from "node:test";
import { name, parseClientSignal, signToken, verifyToken } from "./index.ts";

test("core exports name", () => {
  assert.equal(name, "summon");
});

test("parses hello with token", () => {
  const msg = parseClientSignal(
    JSON.stringify({ type: "hello", token: "t.ok", name: "Visitor" }),
  );
  assert.deepEqual(msg, {
    type: "hello",
    token: "t.ok",
    name: "Visitor",
    clientId: undefined,
  });
});

test("rejects hello without token", () => {
  assert.equal(
    parseClientSignal(
      JSON.stringify({ type: "hello", clientId: "c1", name: "Visitor" }),
    ),
    null,
  );
});

test("parses create and list-sessions", () => {
  assert.deepEqual(parseClientSignal(JSON.stringify({ type: "create" })), {
    type: "create",
  });
  assert.deepEqual(
    parseClientSignal(JSON.stringify({ type: "list-sessions" })),
    { type: "list-sessions" },
  );
});

test("parses knock and join by sessionId", () => {
  assert.deepEqual(
    parseClientSignal(JSON.stringify({ type: "knock", sessionId: "s1" })),
    { type: "knock", sessionId: "s1" },
  );
  assert.deepEqual(
    parseClientSignal(JSON.stringify({ type: "join", sessionId: "s1" })),
    { type: "join", sessionId: "s1" },
  );
});

test("parses admit and deny", () => {
  assert.deepEqual(
    parseClientSignal(
      JSON.stringify({ type: "admit", sessionId: "s1", visitorId: "v1" }),
    ),
    { type: "admit", sessionId: "s1", visitorId: "v1" },
  );
  assert.deepEqual(
    parseClientSignal(
      JSON.stringify({ type: "deny", sessionId: "s1", visitorId: "v1" }),
    ),
    { type: "deny", sessionId: "s1", visitorId: "v1" },
  );
});

test("parses room-key and room-msg", () => {
  assert.deepEqual(
    parseClientSignal(
      JSON.stringify({
        type: "room-key",
        sessionId: "s1",
        to: "u1",
        key: "abc",
      }),
    ),
    { type: "room-key", sessionId: "s1", to: "u1", key: "abc" },
  );
  const msg = parseClientSignal(
    JSON.stringify({
      type: "room-msg",
      sessionId: "s1",
      msgId: "m1",
      iv: "iv",
      enc: "enc",
      body: "hi",
      kind: "ai",
    }),
  );
  assert.equal(msg?.type, "room-msg");
});

test("parses offer and ice", () => {
  assert.deepEqual(
    parseClientSignal(
      JSON.stringify({ type: "rtc-offer", to: "p2", sdp: "v=0" }),
    ),
    { type: "rtc-offer", to: "p2", sdp: "v=0" },
  );
  const ice = parseClientSignal(
    JSON.stringify({
      type: "rtc-ice",
      to: "p2",
      candidate: { candidate: "candidate:1" },
    }),
  );
  assert.equal(ice?.type, "rtc-ice");
});

test("parses end leave report", () => {
  assert.deepEqual(
    parseClientSignal(JSON.stringify({ type: "end", sessionId: "s1" })),
    { type: "end", sessionId: "s1" },
  );
  assert.deepEqual(
    parseClientSignal(JSON.stringify({ type: "leave", sessionId: "s1" })),
    { type: "leave", sessionId: "s1" },
  );
  assert.deepEqual(
    parseClientSignal(JSON.stringify({ type: "report", sessionId: "s1" })),
    { type: "report", sessionId: "s1" },
  );
});

test("sign and verify token", async () => {
  const token = await signToken("user-1", "secret");
  assert.equal(await verifyToken(token, "secret"), "user-1");
  assert.equal(await verifyToken(token, "other"), null);
  assert.equal(await verifyToken("user-1.deadbeef", "secret"), null);
});

test("rejects garbage", () => {
  assert.equal(parseClientSignal("not json"), null);
  assert.equal(parseClientSignal("{}"), null);
  assert.equal(parseClientSignal(JSON.stringify({ type: "join" })), null);
  assert.equal(parseClientSignal(JSON.stringify({ type: "knock" })), null);
});
