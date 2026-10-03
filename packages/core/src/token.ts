const encoder = new TextEncoder();

export const DEFAULT_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type SignTokenOptions = {
  now?: number;
  ttlMs?: number;
  legacy?: boolean;
};

export type VerifyTokenOptions = {
  now?: number;
};

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

function fromHex(value: string): Uint8Array<ArrayBuffer> | null {
  if (value.length === 0 || value.length % 2 !== 0) return null;
  if (!/^[0-9a-f]+$/.test(value)) return null;
  const out = new Uint8Array(new ArrayBuffer(value.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function key(secret: string, usage: "sign" | "verify") {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

async function sign(payload: string, secret: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await key(secret, "sign"), encoder.encode(payload));
  return hex(new Uint8Array(sig));
}

export async function signToken(
  userId: string,
  secret: string,
  options: SignTokenOptions = {},
): Promise<string> {
  if (options.legacy) return `${userId}.${await sign(userId, secret)}`;
  const exp = (options.now ?? Date.now()) + (options.ttlMs ?? DEFAULT_TOKEN_TTL_MS);
  const payload = `${userId}.${exp}`;
  return `${payload}.${await sign(payload, secret)}`;
}

export async function verifyToken(
  token: string,
  secret: string,
  options: VerifyTokenOptions = {},
): Promise<string | null> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const sig = fromHex(token.slice(dot + 1));
  if (!sig) return null;
  const head = token.slice(0, dot);
  const split = head.lastIndexOf(".");
  const hasExpiry = split > 0;
  const userId = hasExpiry ? head.slice(0, split) : head;
  const exp = hasExpiry ? Number(head.slice(split + 1)) : null;
  if (!userId) return null;
  if (exp !== null && (!Number.isSafeInteger(exp) || exp <= 0)) return null;
  if (exp !== null && (options.now ?? Date.now()) >= exp) return null;
  return (await crypto.subtle.verify(
    "HMAC",
    await key(secret, "verify"),
    sig,
    encoder.encode(head),
  ))
    ? userId
    : null;
}
