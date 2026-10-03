function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function importKey(keyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    base64ToBytes(keyB64) as BufferSource,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}

export type RoomMessageAad = {
  sessionId: string;
  msgId: string;
  senderId: string;
};

/** U+0000 cannot appear in a uuid, `m-<epoch>` msgId, or db-generated user id. */
const AAD_SEPARATOR = "\u0000";

function encodeAad(aad: RoomMessageAad): Uint8Array {
  return new TextEncoder().encode(
    [aad.sessionId, aad.msgId, aad.senderId].join(AAD_SEPARATOR),
  );
}

export async function generateRoomKey(): Promise<string> {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const raw = await crypto.subtle.exportKey("raw", key);
  return bytesToBase64(new Uint8Array(raw));
}

export async function encryptRoomText(
  keyB64: string,
  text: string,
  aad?: RoomMessageAad,
): Promise<{ iv: string; enc: string }> {
  const key = await importKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: aad ? (encodeAad(aad) as BufferSource) : undefined,
    },
    key,
    new TextEncoder().encode(text),
  );
  return { iv: bytesToBase64(iv), enc: bytesToBase64(new Uint8Array(enc)) };
}

export async function decryptRoomText(
  keyB64: string,
  ivB64: string,
  encB64: string,
  aad?: RoomMessageAad,
): Promise<string> {
  const key = await importKey(keyB64);
  const plain = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(ivB64) as BufferSource,
      additionalData: aad ? (encodeAad(aad) as BufferSource) : undefined,
    },
    key,
    base64ToBytes(encB64) as BufferSource,
  );
  return new TextDecoder().decode(plain);
}
