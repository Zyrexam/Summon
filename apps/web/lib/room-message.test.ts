import { describe, expect, test } from "vitest";
import { aadFor, encryptRoomText, generateRoomKey } from "@summon/core";
import { UNREADABLE_BODY, readRoomMessage } from "./room-message";

const frame = { sessionId: "s1", msgId: "m-1", senderId: "u1" };

describe("readRoomMessage", () => {
  test("reads a message bound to its own frame", async () => {
    const key = await generateRoomKey();
    const { iv, enc } = await encryptRoomText(key, "hello", aadFor("s1", "m-1", "u1"));
    const out = await readRoomMessage({ key, iv, enc, ...frame });
    expect(out).toEqual({ body: "hello", readable: true });
  });

  test("rejects a frame whose sender was swapped", async () => {
    const key = await generateRoomKey();
    const { iv, enc } = await encryptRoomText(key, "hello", aadFor("s1", "m-1", "u1"));
    const out = await readRoomMessage({ key, iv, enc, ...frame, senderId: "u2" });
    expect(out).toEqual({ body: UNREADABLE_BODY, readable: false });
  });

  test("rejects legacy ciphertext sent without aad", async () => {
    const key = await generateRoomKey();
    const { iv, enc } = await encryptRoomText(key, "hello");
    const out = await readRoomMessage({ key, iv, enc, ...frame });
    expect(out).toEqual({ body: UNREADABLE_BODY, readable: false });
  });

  test("missing key or blank frame part degrades instead of throwing", async () => {
    const key = await generateRoomKey();
    const { iv, enc } = await encryptRoomText(key, "hello", aadFor("s1", "m-1", "u1"));
    const noKey = await readRoomMessage({ key: null, iv, enc, ...frame });
    const blankSender = await readRoomMessage({ key, iv, enc, ...frame, senderId: "" });
    expect(noKey).toEqual({ body: UNREADABLE_BODY, readable: false });
    expect(blankSender).toEqual({ body: UNREADABLE_BODY, readable: false });
  });
});