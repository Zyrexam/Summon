import { IncomingMessage, type ServerResponse } from "node:http";
import { Socket } from "node:net";
import { verifyToken } from "@summon/core";
import { describe, expect, it } from "vitest";
import { createAuthHandler } from "./auth-http";

const SECRET = "test-secret-".padEnd(32, "x");

type Row = Record<string, string>;

function fakeDb(users = new Map<string, Row>()) {
  return {
    users,
    async query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }> {
      if (text.startsWith("INSERT INTO users")) {
        const [id, email, password_hash, name] = values as string[];
        if ([...users.values()].some((u) => u.email === email)) {
          return { rows: [] };
        }
        users.set(id, { id, email, password_hash, name });
        return { rows: [{ id, name } as unknown as T] };
      }
      if (text.startsWith("SELECT id, email")) {
        const row = [...users.values()].find((u) => u.email === values?.[0]);
        return { rows: (row ? [row] : []) as unknown as T[] };
      }
      throw new Error(`unexpected query: ${text}`);
    },
  };
}

function post(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<boolean>,
  url: string,
  body: unknown,
): Promise<{ status: number; body: Record<string, string> }> {
  const req = new IncomingMessage(new Socket());
  req.method = "POST";
  req.url = url;
  const payload = Buffer.from(JSON.stringify(body));
  let dataListener: ((chunk: Buffer) => void) | null = null;
  let endListener: (() => void) | null = null;
  req.on = ((event: string, listener: (...args: never[]) => void) => {
    if (event === "data") dataListener = listener as (chunk: Buffer) => void;
    if (event === "end") endListener = listener as () => void;
    return req;
  }) as IncomingMessage["on"];
  return new Promise((resolve) => {
    const res = {
      setHeader() {},
      writeHead(status: number) {
        (res as { status?: number }).status = status;
      },
      end(text?: string) {
        resolve({
          status: (res as { status?: number }).status ?? 200,
          body: text ? (JSON.parse(text) as Record<string, string>) : {},
        });
      },
    } as unknown as ServerResponse;
    void handler(req, res);
    setImmediate(() => {
      dataListener?.(payload);
      endListener?.();
    });
  });
}

/** Minimal ServerResponse double that records the status written. */
function fakeRes() {
  const state: { status?: number; body?: unknown } = {};
  const res = {
    setHeader() {},
    writeHead(status: number) {
      state.status = status;
    },
    end(text?: string) {
      state.body = text ? JSON.parse(text) : undefined;
    },
    destroy() {},
  } as unknown as ServerResponse;
  return {
    res,
    state,
    get status() {
      return state.status ?? 200;
    },
  };
}

/**
 * Replaces `on` with a recorder. Must run *before* the handler is invoked:
 * `readBody` attaches its listeners synchronously, and by then it needs to be
 * talking to the recorder rather than a real stream that will never emit.
 */
function stub(req: IncomingMessage) {
  const listeners: {
    data: ((chunk: Buffer) => void) | null;
    end: (() => void) | null;
  } = { data: null, end: null };
  req.on = ((event: string, listener: (...args: never[]) => void) => {
    if (event === "data") listeners.data = listener as (chunk: Buffer) => void;
    if (event === "end") listeners.end = listener as () => void;
    return req;
  }) as IncomingMessage["on"];
  return listeners;
}

/**
 * Pushes a raw body through a stubbed request. Returns false when the handler
 * refused the body outright (no `end` listener was ever attached), which is
 * how the oversized case is told apart from a body that was actually read.
 */
function feed(
  req: IncomingMessage,
  listeners: { data: ((chunk: Buffer) => void) | null; end: (() => void) | null },
  payload: Buffer,
): boolean {
  listeners.data?.(payload);
  listeners.end?.();
  return listeners.end !== null;
}

describe("backend auth API", () => {
  it("rejects an oversized declared body with 413, not an exception", async () => {
    const db = fakeDb();
    const handler = createAuthHandler({ getDb: () => db, tokenSecret: SECRET });
    const req = new IncomingMessage(new Socket());
    req.method = "POST";
    req.url = "/api/auth/register";
    req.headers = { "content-length": String(2_000_000) };
    const res = fakeRes();
    expect(await handler(req, res.res)).toBe(true);
    expect(res.status).toBe(413);
    // Nothing reached the database: the body was refused before any work.
    expect(db.users.size).toBe(0);
  });

  it("a null or unparseable body is answered, never left hanging", async () => {
    const handler = createAuthHandler({
      getDb: () => fakeDb(),
      tokenSecret: SECRET,
    });
    for (const raw of ["null", "not json at all"]) {
      const res = fakeRes();
      const req = new IncomingMessage(new Socket());
      req.method = "POST";
      req.url = "/api/auth/login";
      req.headers = { "content-length": String(raw.length) };
      const listeners = stub(req);
      // The handler blocks on the body, so invoke it, feed, then await.
      const handled = handler(req, res.res);
      // The body was read (not refused up front) and still produced a reply.
      expect(feed(req, listeners, Buffer.from(raw))).toBe(true);
      expect(await handled).toBe(true);
      // Reaches validation rather than returning early on a null sentinel.
      expect([400, 401]).toContain(res.status);
    }
  });

  it("register then login round-trips a verifiable token", async () => {
    const db = fakeDb();
    const handler = createAuthHandler({
      getDb: () => db,
      tokenSecret: SECRET,
      createId: () => "user-1",
    });
    const reg = await post(handler, "/api/auth/register", {
      email: "Ada@Example.com",
      password: "correct-horse",
      name: "Ada",
    });
    expect(reg.status).toBe(200);
    expect(await verifyToken(reg.body.token, SECRET)).toBe("user-1");

    const login = await post(handler, "/api/auth/login", {
      email: "ada@example.com",
      password: "correct-horse",
    });
    expect(login.status).toBe(200);
  });

  it("duplicate register is 409, wrong password is 401", async () => {
    const db = fakeDb();
    const handler = createAuthHandler({
      getDb: () => db,
      tokenSecret: SECRET,
      createId: () => "user-1",
    });
    await post(handler, "/api/auth/register", {
      email: "a@x.com",
      password: "password1",
    });
    const dup = await post(handler, "/api/auth/register", {
      email: "a@x.com",
      password: "password1",
    });
    expect(dup.status).toBe(409);
    const wrong = await post(handler, "/api/auth/login", {
      email: "a@x.com",
      password: "nope-nope-nope",
    });
    expect(wrong.status).toBe(401);
  });

  it("stored passwords are salted hashes, never plaintext", async () => {
    const db = fakeDb();
    const handler = createAuthHandler({
      getDb: () => db,
      tokenSecret: SECRET,
      createId: () => "user-9",
    });
    await post(handler, "/api/auth/register", {
      email: "b@x.com",
      password: "s3cret-password",
    });
    const stored = db.users.get("user-9")?.password_hash ?? "";
    expect(stored).not.toContain("s3cret-password");
    expect(stored).toMatch(/^[0-9a-f]{32}\.[0-9a-f]{128}$/);
  });

  it("rate limit trips to 429 without touching the database", async () => {
    let queries = 0;
    const db = {
      async query<T>(): Promise<{ rows: T[] }> {
        queries += 1;
        return { rows: [] };
      },
    };
    const handler = createAuthHandler({
      getDb: () => db,
      tokenSecret: SECRET,
      perIpLimit: 1000,
      perEmailLimit: 2,
    });
    for (let i = 0; i < 2; i++) {
      await post(handler, "/api/auth/login", {
        email: "v@x.com",
        password: "wrong",
      });
    }
    const limited = await post(handler, "/api/auth/login", {
      email: "v@x.com",
      password: "wrong",
    });
    expect(limited.status).toBe(429);
    expect(queries).toBe(2);
  });

  it("non-auth paths are not handled", async () => {
    const db = fakeDb();
    const handler = createAuthHandler({ getDb: () => db, tokenSecret: SECRET });
    const req = new IncomingMessage(new Socket());
    req.method = "GET";
    req.url = "/nope";
    expect(await handler(req, {} as ServerResponse)).toBe(false);
  });
});
