import { aadFor, decryptRoomText } from "@summon/core";

export const UNREADABLE_BODY = "This message could not be decrypted.";

export type ReadableBody = { body: string; readable: boolean };

export type RoomFrame = {
  key: string | null;
  iv: string;
  enc: string;
  sessionId: string;
  msgId: string;
  senderId: string;
};

/**
 * A frame that fails its AAD check is replayed or tampered, not a bug worth
 * crashing a chat sidebar over, so every failure mode lands on one state.
 */
export async function readRoomMessage(frame: RoomFrame): Promise<ReadableBody> {
  const unreadable: ReadableBody = { body: UNREADABLE_BODY, readable: false };
  if (!frame.key) return unreadable;
  try {
    const body = await decryptRoomText(
      frame.key,
      frame.iv,
      frame.enc,
      aadFor(frame.sessionId, frame.msgId, frame.senderId),
    );
    return { body, readable: true };
  } catch {
    return unreadable;
  }
}