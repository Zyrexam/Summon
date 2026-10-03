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

describe("backend auth API", () => {
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
