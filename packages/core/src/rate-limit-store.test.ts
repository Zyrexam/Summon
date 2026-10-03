import test from "node:test";
import assert from "node:assert/strict";
import { createPostgresRateLimitStore, RATE_LIMIT_SQL } from "./rate-limit-store.ts";
import { createRateLimiter } from "./rate-limit.ts";

/** Minimal Queryable stand-in that answers the rate-limit upsert. */
function stubDb(counts: { ip: number; email: number }) {
  const calls: { text: string; values: unknown[] }[] = [];
  return {
    calls,
    query: async <T>(text: string, values?: unknown[]) => {
      calls.push({ text, values: values ?? [] });
      const bucket = ((values ?? [])[0] as string).startsWith("ip:")
        ? "ip"
        : "email";
      counts[bucket] += 1;
      return { rows: [{ count: counts[bucket] }] as T[] };
    },
  };
}

test("the upsert is atomic and never deletes", () => {
  assert.match(RATE_LIMIT_SQL, /INSERT INTO rate_limits/i);
  assert.match(RATE_LIMIT_SQL, /ON CONFLICT/i);
  assert.match(RATE_LIMIT_SQL, /RETURNING count/i);
  assert.doesNotMatch(RATE_LIMIT_SQL, /\bDELETE\b/i);
  assert.doesNotMatch(RATE_LIMIT_SQL, /\bTRUNCATE\b/i);
});

test("the store counts through Postgres so every instance shares it", async () => {
  const db = stubDb({ ip: 0, email: 0 });
  const store = createPostgresRateLimitStore(db);
  const results = [];
  for (let i = 0; i < 3; i += 1) {
    results.push(await store.take("ip:1.2.3.4", 2, 60_000));
  }
  assert.deepEqual(results, [true, true, false]);
  assert.equal(db.calls[0].values[0], "ip:1.2.3.4");
});

test("separate keys are counted separately", async () => {
  const db = stubDb({ ip: 0, email: 0 });
  const store = createPostgresRateLimitStore(db);
  assert.equal(await store.take("email:a@b.c", 1, 60_000), true);
  assert.equal(await store.take("email:d@e.f", 5, 60_000), true);
  assert.equal(await store.take("email:a@b.c", 1, 60_000), false);
});

test("a limiter built on the store behaves like the in-memory one", async () => {
  const db = stubDb({ ip: 0, email: 0 });
  const limiter = createRateLimiter({
    limit: 3,
    windowMs: 60_000,
    store: createPostgresRateLimitStore(db),
  });
  const results = [];
  for (let i = 0; i < 4; i += 1) results.push(await limiter.take("ip:x"));
  assert.deepEqual(results, [true, true, true, false]);
});

test("the limiter still works with no store (single instance)", async () => {
  const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
  const results = [];
  for (let i = 0; i < 3; i += 1) results.push(await limiter.take("ip:y"));
  assert.deepEqual(results, [true, true, false]);
});