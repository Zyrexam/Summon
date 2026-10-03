import assert from "node:assert/strict";
import test from "node:test";
import { MAX_SUMMON_CONTEXT_LINES, parseClientSignal } from "./index.ts";

test("summon context ceiling is a positive integer", () => {
  assert.equal(Number.isInteger(MAX_SUMMON_CONTEXT_LINES), true);
  assert.ok(MAX_SUMMON_CONTEXT_LINES > 0);
});

test("parses summon with question and context", () => {
  const msg = parseClientSignal(
    JSON.stringify({
      type: "summon",
      sessionId: "s1",
      requestId: "r1",
      question: "what did I just agree to?",
      context: [
        { name: "Ada", body: "Ship the relay on Friday" },
        { name: "You", body: "Agreed" },
      ],
    }),
  );
  assert.deepEqual(msg, {
    type: "summon",
    sessionId: "s1",
    requestId: "r1",
    question: "what did I just agree to?",
    context: [
      { name: "Ada", body: "Ship the relay on Friday" },
      { name: "You", body: "Agreed" },
    ],
  });
});

test("summon drops malformed context lines", () => {
  const msg = parseClientSignal(
    JSON.stringify({
      type: "summon",
      sessionId: "s1",
      requestId: "r1",
      question: "q",
      context: [
        { name: "Ada", body: "kept" },
        { name: "Bo" },
        "nope",
        { body: "no name" },
      ],
    }),
  );
  assert.ok(msg);
  assert.equal(msg.type, "summon");
  assert.deepEqual(msg.context, [{ name: "Ada", body: "kept" }]);
});

test("summon accepts an empty context", () => {
  const msg = parseClientSignal(
    JSON.stringify({
      type: "summon",
      sessionId: "s1",
      requestId: "r1",
      question: "q",
      context: [],
    }),
  );
  assert.ok(msg);
  assert.equal(msg.type, "summon");
  assert.deepEqual(msg.context, []);
});

test("rejects summon without a question", () => {
  assert.equal(
    parseClientSignal(
      JSON.stringify({
        type: "summon",
        sessionId: "s1",
        requestId: "r1",
        context: [],
      }),
    ),
    null,
  );
});

test("rejects summon without a requestId", () => {
  assert.equal(
    parseClientSignal(
      JSON.stringify({
        type: "summon",
        sessionId: "s1",
        question: "q",
        context: [],
      }),
    ),
    null,
  );
});

test("rejects summon with a blank question", () => {
  assert.equal(
    parseClientSignal(
      JSON.stringify({
        type: "summon",
        sessionId: "s1",
        requestId: "r1",
        question: "   ",
        context: [],
      }),
    ),
    null,
  );
});

test("rejects summon with non-array context", () => {
  assert.equal(
    parseClientSignal(
      JSON.stringify({
        type: "summon",
        sessionId: "s1",
        requestId: "r1",
        question: "q",
        context: "nope",
      }),
    ),
    null,
  );
});
