import assert from "node:assert/strict";
import test from "node:test";
import { createRateLimiter } from "./rate-limit.ts";

test("allows up to the limit, then rejects", () => {
  let now = 0;
  const limiter = createRateLimiter({ limit: 3, windowMs: 1000, now: () => now });
  assert.equal(limiter.take("ip:1"), true);
  assert.equal(limiter.take("ip:1"), true);
  assert.equal(limiter.take("ip:1"), true);
  assert.equal(limiter.take("ip:1"), false);
  assert.equal(limiter.take("ip:1"), false);
});

test("keys are independent", () => {
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => 0 });
  assert.equal(limiter.take("ip:1"), true);
  assert.equal(limiter.take("ip:2"), true);
  assert.equal(limiter.take("email:a@b.com"), true);
  assert.equal(limiter.take("ip:1"), false);
});

test("resets after the window", () => {
  let now = 0;
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000, now: () => now });
  limiter.take("ip:1");
  limiter.take("ip:1");
  assert.equal(limiter.take("ip:1"), false);
  now = 1000;
  assert.equal(limiter.take("ip:1"), true);
  assert.equal(limiter.take("ip:1"), true);
  assert.equal(limiter.take("ip:1"), false);
});

test("stays bounded and evicts expired buckets lazily", () => {
  let now = 0;
  const limiter = createRateLimiter({ limit: 1, windowMs: 100, now: () => now });
  for (let i = 0; i < 3000; i++) {
    now = i * 10;
    limiter.take(`ip:${i}`);
  }
  assert.ok(limiter.size() <= 1024, `expected a bounded map, got ${limiter.size()}`);
  now = 1_000_000;
  for (let i = 0; i < 1100; i++) limiter.take(`ip:fresh-${i}`);
  assert.ok(limiter.size() <= 1100, `expected expired buckets evicted, got ${limiter.size()}`);
});
