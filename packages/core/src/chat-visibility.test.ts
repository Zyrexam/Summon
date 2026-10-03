import assert from "node:assert/strict";
import test from "node:test";
import {
  humanSenderCount,
  senderKey,
  senderLabel,
  type SenderVisibilityInput,
} from "./chat-visibility.ts";

function input(over: Partial<SenderVisibilityInput> = {}): SenderVisibilityInput {
  return {
    humanCount: 3,
    kind: "human",
    isYou: false,
    from: "u2",
    fromName: "Bob",
    previousKey: undefined,
    ...over,
  };
}

test("humanSenderCount counts the roster, which never holds Summon AI", () => {
  assert.equal(
    humanSenderCount([
      { id: "u1", name: "Ada", online: true, host: true },
      { id: "u2", name: "Bob", online: false, host: false },
    ]),
    2,
  );
  assert.equal(humanSenderCount([]), 0);
});

test("a two-human session shows no sender name and never says You", () => {
  assert.deepEqual(senderLabel(input({ humanCount: 2, isYou: true, from: "u1" })), {
    show: false,
    text: "",
  });
  assert.deepEqual(
    senderLabel(input({ humanCount: 2, isYou: false, from: "u2" })),
    { show: false, text: "" },
  );
  assert.equal(
    senderLabel(input({ humanCount: 1, isYou: false, from: "u2" })).show,
    false,
  );
});

test("three or more humans show the display name", () => {
  assert.deepEqual(senderLabel(input({})), { show: true, text: "Bob" });
});

test("a three-human session labels your own messages You", () => {
  assert.deepEqual(senderLabel(input({ isYou: true, from: "u1", fromName: "Ada" })), {
    show: true,
    text: "You",
  });
});

test("consecutive messages from one sender are grouped under one name", () => {
  const label = senderLabel(input({ previousKey: senderKey(input({})) }));
  assert.equal(label.show, false);
});

test("the name returns when the sender changes", () => {
  const label = senderLabel(input({ previousKey: "human:u3" }));
  assert.deepEqual(label, { show: true, text: "Bob" });
});

test("Summon AI is labelled when a run begins, not for every message", () => {
  assert.deepEqual(senderLabel(input({ kind: "ai", fromName: "Summon AI" })), {
    show: true,
    text: "Summon AI",
  });
  assert.equal(senderLabel(input({ kind: "ai", previousKey: "ai" })).show, false);
});

test("Summon AI keeps its label in a two-human session", () => {
  assert.equal(
    senderLabel(input({ humanCount: 2, kind: "ai", fromName: "Summon AI" })).text,
    "Summon AI",
  );
});

test("senderKey separates you, humans and the AI", () => {
  assert.equal(senderKey(input({ isYou: true, from: "u1" })), "you:u1");
  assert.equal(senderKey(input()), "human:u2");
  assert.equal(senderKey(input({ kind: "ai" })), "ai");
});