import assert from "node:assert/strict";
import test from "node:test";
import { parseClientSignal } from "./signal.ts";

test("parseClientSignal room-msg keeps ciphertext fields", () => {
  const parsed = parseClientSignal(
    JSON.stringify({
      type: "room-msg",
      sessionId: "s1",
      msgId: "m1",
      iv: "aXY=",
      enc: "ZW5j",
      kind: "human",
    }),
  );
  assert.deepEqual(parsed, {
    type: "room-msg",
    sessionId: "s1",
    msgId: "m1",
    iv: "aXY=",
    enc: "ZW5j",
    kind: "human",
  });
});

test("parseClientSignal room-msg drops a client-supplied plaintext body", () => {
  const parsed = parseClientSignal(
    JSON.stringify({
      type: "room-msg",
      sessionId: "s1",
      msgId: "m1",
      iv: "aXY=",
      enc: "ZW5j",
      body: "plaintext must not survive parsing",
    }),
  );
  assert.deepEqual(parsed, {
    type: "room-msg",
    sessionId: "s1",
    msgId: "m1",
    iv: "aXY=",
    enc: "ZW5j",
    kind: undefined,
  });
  assert.equal(
    parsed && "body" in parsed,
    false,
    "parsed client room-msg must not carry body",
  );
});
