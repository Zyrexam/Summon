import assert from "node:assert/strict";
import test from "node:test";
import { decryptRoomText, encryptRoomText, generateRoomKey } from "./crypto.ts";
import { aadFor } from "./room-aad.ts";

test("aadFor binds session, message and sender", () => {
  assert.deepEqual(aadFor("s1", "m1", "u1"), {
    sessionId: "s1",
    msgId: "m1",
    senderId: "u1",
  });
});

test("aadFor rejects blank fields so a frame can never be weakly bound", () => {
  assert.throws(() => aadFor("", "m1", "u1"));
  assert.throws(() => aadFor("s1", " ", "u1"));
  assert.throws(() => aadFor("s1", "m1", ""));
});

test("ciphertext made with aadFor only decrypts for the same triple", async () => {
  const key = await generateRoomKey();
  const aad = aadFor("s1", "m1", "u1");
  const { iv, enc } = await encryptRoomText(key, "hello", aad);
  assert.equal(await decryptRoomText(key, iv, enc, aadFor("s1", "m1", "u1")), "hello");
  await assert.rejects(() => decryptRoomText(key, iv, enc, aadFor("s1", "m2", "u1")));
  await assert.rejects(() => decryptRoomText(key, iv, enc, aadFor("s2", "m1", "u1")));
  await assert.rejects(() => decryptRoomText(key, iv, enc, aadFor("s1", "m1", "u2")));
  await assert.rejects(() => decryptRoomText(key, iv, enc));
});