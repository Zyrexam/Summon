import assert from "node:assert/strict";
import test from "node:test";
import {
  decryptRoomText,
  encryptRoomText,
  generateRoomKey,
} from "./crypto.ts";

const AAD = { sessionId: "s1", msgId: "m1", senderId: "u1" };

test("room key encrypt/decrypt roundtrip", async () => {
  const key = await generateRoomKey();
  const { iv, enc } = await encryptRoomText(key, "host admit works");
  const plain = await decryptRoomText(key, iv, enc);
  assert.equal(plain, "host admit works");
});

test("wrong key fails to decrypt", async () => {
  const key = await generateRoomKey();
  const other = await generateRoomKey();
  const { iv, enc } = await encryptRoomText(key, "secret");
  await assert.rejects(() => decryptRoomText(other, iv, enc));
});

test("generateRoomKey returns a fresh 256-bit key per call", async () => {
  const a = await generateRoomKey();
  const b = await generateRoomKey();
  assert.notEqual(a, b);
  assert.equal(atob(a).length, 32);
  assert.equal(atob(b).length, 32);
});

test("encryptRoomText uses a fresh 12-byte IV per message", async () => {
  const key = await generateRoomKey();
  const first = await encryptRoomText(key, "same text", AAD);
  const second = await encryptRoomText(key, "same text", AAD);
  assert.equal(atob(first.iv).length, 12);
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.enc, second.enc);
});

test("intended caller usage: encryptRoomText(key, text, {sessionId, msgId, senderId}) then decryptRoomText(key, iv, enc, sameAad) returns the plaintext", async () => {
  const key = await generateRoomKey();
  const { iv, enc } = await encryptRoomText(key, "host admit works", AAD);
  assert.equal(await decryptRoomText(key, iv, enc, AAD), "host admit works");
});

test("decryptRoomText rejects when senderId AAD differs (replay as another member)", async () => {
  const key = await generateRoomKey();
  const { iv, enc } = await encryptRoomText(key, "spoofed", AAD);
  await assert.rejects(() =>
    decryptRoomText(key, iv, enc, { ...AAD, senderId: "u2" }),
  );
});

test("decryptRoomText rejects when sessionId or msgId AAD differs", async () => {
  const key = await generateRoomKey();
  const { iv, enc } = await encryptRoomText(key, "moved", AAD);
  await assert.rejects(() =>
    decryptRoomText(key, iv, enc, { ...AAD, sessionId: "s2" }),
  );
  await assert.rejects(() =>
    decryptRoomText(key, iv, enc, { ...AAD, msgId: "m2" }),
  );
});

test("decryptRoomText rejects when AAD is omitted on a ciphertext bound to AAD", async () => {
  const key = await generateRoomKey();
  const { iv, enc } = await encryptRoomText(key, "bound", AAD);
  await assert.rejects(() => decryptRoomText(key, iv, enc));
});

test("decryptRoomText rejects a tampered ciphertext", async () => {
  const key = await generateRoomKey();
  const { iv, enc } = await encryptRoomText(key, "tamper me", AAD);
  const raw = atob(enc);
  const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
  bytes[0] ^= 0xff;
  await assert.rejects(() => decryptRoomText(key, iv, btoa(String.fromCharCode(...bytes)), AAD));
});
