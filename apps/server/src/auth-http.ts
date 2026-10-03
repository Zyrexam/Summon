import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import {
  createRateLimiter,
  createUser,
  findUserByEmail,
  normalizeEmail,
  signToken,
  type Queryable,
} from "@summon/core";
import { hashPassword, verifyPassword } from "./password";
import { authErrorResponse } from "./auth-errors";
import type { Logger } from "./logger";

const WINDOW_MS = 60_000;
const MAX_BODY_BYTES = 1_000_000;

export type AuthHttpDeps = {
  getDb: () => Queryable;
  tokenSecret: string;
  trustProxy?: boolean;
  perIpLimit?: number;
  perEmailLimit?: number;
  now?: () => number;
  createId?: () => string;
  logger?: Logger;
};

function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (!trustProxy) return "direct";
  const forwarded = req.headers["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return (
    first?.trim() ||
    (req.headers["x-real-ip"] as string | undefined)?.trim() ||
    req.socket.remoteAddress ||
    "unknown"
  );
}

function cors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}

function json(res: ServerResponse, status: number, body: unknown): void {
  cors(res);
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

/**
 * Distinct type, because this failure is the caller's to answer: a rejected
 * body read that escapes as an unhandled rejection takes the whole relay with
 * it, and with it every live room.
 */
export class BodyTooLargeError extends Error {
  constructor() {
    super("request body too large");
    this.name = "BodyTooLargeError";
  }
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // Declared length first: it answers 413 without reading a byte, which is
    // the shape every browser and nearly every attacker actually sends.
    const declared = Number(req.headers["content-length"] ?? 0);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      reject(new BodyTooLargeError());
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      // Backstop for a chunked request that lies about, or omits, its length.
      if (size > MAX_BODY_BYTES) {
        reject(new BodyTooLargeError());
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        resolve(null);
      }
    });
    req.on("error", reject);
  });
}

/**
 * Auth API owned by the relay so Vercel never touches the database.
 * Returns true when the request was an auth route (handled), false otherwise.
 * Rate limits are in-memory: one persistent process needs no shared store,
 * which also means zero rate-limit writes against the database.
 */
export function createAuthHandler(deps: AuthHttpDeps) {
  const trustProxy = deps.trustProxy ?? false;
  const perIp = createRateLimiter({
    limit: deps.perIpLimit ?? (trustProxy ? 10 : 60),
    windowMs: WINDOW_MS,
    now: deps.now,
  });
  const perEmail = createRateLimiter({
    limit: deps.perEmailLimit ?? 5,
    windowMs: WINDOW_MS,
    now: deps.now,
  });
  const createId = deps.createId ?? randomUUID;

  const limited = async (req: IncomingMessage, email: string): Promise<boolean> => {
    const ip = clientIp(req, trustProxy);
    const [ipOk, emailOk] = await Promise.all([
      perIp.take(`ip:${ip}`),
      perEmail.take(`email:${email}`),
    ]);
    return !(ipOk && emailOk);
  };

  const fail = (
    res: ServerResponse,
    route: string,
    cause: unknown,
    status?: number,
    body?: { error: string },
  ): void => {
    deps.logger?.warn("auth_failed", {
      route,
      reason: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause),
    });
    if (status !== undefined && body !== undefined) {
      json(res, status, body);
      return;
    }
    const failure = authErrorResponse(cause);
    json(res, failure.status, failure.body);
  };

  /**
   * A read failure is answered here rather than thrown: `register`/`login`
   * only wrap their *work* in a try/catch, so anything thrown before that —
   * an oversized body included — would surface as an unhandled rejection and
   * kill the process along with every open WebSocket.
   *
   * The result is discriminated rather than `null`: a body of literal `null`,
   * or unparseable JSON, both parse to `null` and must still reach the
   * validation below instead of being mistaken for "already answered".
   */
  type ReadResult =
    | { ok: true; body: unknown }
    | { ok: false };

  const readJson = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<ReadResult> => {
    try {
      return { ok: true, body: await readBody(req) };
    } catch (cause) {
      if (cause instanceof BodyTooLargeError) {
        json(res, 413, { error: "Body too large" });
        return { ok: false };
      }
      json(res, 400, { error: "Invalid body" });
      return { ok: false };
    }
  };

  const register = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const read = await readJson(req, res);
    if (!read.ok) return;
    const body = read.body as { email?: string; password?: string; name?: string } | null;
    const email = normalizeEmail(body?.email ?? "");
    const password = body?.password ?? "";
    const name = (body?.name ?? "").trim() || "Guest";
    if (!email.includes("@") || password.length < 6) {
      json(res, 400, { error: "Valid email and password (6+ chars) required" });
      return;
    }
    if (await limited(req, email)) {
      json(res, 429, { error: "Too many attempts" });
      return;
    }
    try {
      const user = await createUser(
        deps.getDb(),
        createId(),
        email,
        await hashPassword(password),
        name,
      );
      if (!user) {
        json(res, 409, { error: "Email already registered" });
        return;
      }
      const token = await signToken(user.id, deps.tokenSecret);
      json(res, 200, { token, user: { id: user.id, email, name: user.name } });
    } catch (cause) {
      fail(res, "register", cause);
    }
  };

  const login = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const read = await readJson(req, res);
    if (!read.ok) return;
    const body = read.body as { email?: string; password?: string } | null;
    const email = normalizeEmail(body?.email ?? "");
    const password = body?.password ?? "";
    if (!email || !password) {
      json(res, 400, { error: "Email and password required" });
      return;
    }
    if (await limited(req, email)) {
      json(res, 429, { error: "Too many attempts" });
      return;
    }
    try {
      const user = await findUserByEmail(deps.getDb(), email);
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        json(res, 401, { error: "Invalid credentials" });
        return;
      }
      const token = await signToken(user.id, deps.tokenSecret);
      json(res, 200, {
        token,
        user: { id: user.id, email: user.email, name: user.name },
      });
    } catch (cause) {
      fail(res, "login", cause);
    }
  };

  return async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = req.url ?? "";
    const path = url.split("?")[0];
    if (req.method === "OPTIONS" && (path === "/api/auth/login" || path === "/api/auth/register")) {
      cors(res);
      res.writeHead(204);
      res.end();
      return true;
    }
    if (req.method !== "POST") return false;
    if (path === "/api/auth/register") {
      await register(req, res);
      return true;
    }
    if (path === "/api/auth/login") {
      await login(req, res);
      return true;
    }
    return false;
  };
}
