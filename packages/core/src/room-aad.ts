import type { RoomMessageAad } from "./crypto.ts";

function requirePart(value: string, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`aadFor: ${name} must be a non-empty string`);
  }
  return value;
}

/**
 * The triple a room ciphertext is bound to. Every receiver must be able to
 * rebuild it from the frame alone, so blank fields are a hard error: a weakly
 * bound frame is exactly the replay hole AAD exists to close.
 */
export function aadFor(
  sessionId: string,
  msgId: string,
  senderId: string,
): RoomMessageAad {
  return {
    sessionId: requirePart(sessionId, "sessionId"),
    msgId: requirePart(msgId, "msgId"),
    senderId: requirePart(senderId, "senderId"),
  };
}