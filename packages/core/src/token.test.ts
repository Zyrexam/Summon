import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_TOKEN_TTL_MS, signToken, verifyToken } from "./token.ts";

const secret = "test-secret";

test("signs userId.exp.sig with a 7 day default expiry", async () => {
  const now = 1_700_000_000_000;
  const token = await signToken("user-1", secret, { now });
  const parts = token.split(".");
  assert.equal(parts.length, 3);
  assert.equal(parts[0], "user-1");
  assert.equal(Number(parts[1]), now + DEFAULT_TOKEN_TTL_MS);
});

test("verifies a token before its expiry", async () => {
  const now = 1_700_000_000_000;
  const token = await signToken("user-1", secret, { now });
  assert.equal(await verifyToken(token, secret, { now: now + 1_000 }), "user-1");
});

test("returns null after the expiry", async () => {
  const now = 1_700_000_000_000;
  const token = await signToken("user-1", secret, { now });
  const after = now + DEFAULT_TOKEN_TTL_MS + 1;
  assert.equal(await verifyToken(token, secret, { now: after }), null);
});

test("rejects a tampered signature", async () => {
  const now = 1_700_000_000_000;
  const token = await signToken("user-1", secret, { now });
  const parts = token.split(".");
  const flipped = parts[2]!.startsWith("0") ? "1" : "0";
  const tampered = `${parts[0]}.${parts[1]}.${flipped}${parts[2]!.slice(1)}`;
  assert.equal(await verifyToken(tampered, secret, { now }), null);
});

test("rejects a token whose expiry was extended", async () => {
  const now = 1_700_000_000_000;
  const token = await signToken("user-1", secret, { now });
  const parts = token.split(".");
  const extended = `${parts[0]}.${Number(parts[1]) + 10_000_000}.${parts[2]}`;
  assert.equal(await verifyToken(extended, secret, { now }), null);
});

test("keeps verifying legacy userId.sig tokens as non-expiring", async () => {
  const legacy = await signToken("user-1", secret, { legacy: true });
  assert.equal(legacy.split(".").length, 2);
  assert.equal(await verifyToken(legacy, secret, { now: 9_000_000_000_000 }), "user-1");
});

test("rejects a legacy token signed with another secret", async () => {
  const legacy = await signToken("user-1", secret, { legacy: true });
  assert.equal(await verifyToken(legacy, "other", { now: 0 }), null);
});

test("rejects malformed tokens", async () => {
  const now = 1_700_000_000_000;
  assert.equal(await verifyToken("", secret, { now }), null);
  assert.equal(await verifyToken("nodot", secret, { now }), null);
  assert.equal(await verifyToken("user-1..sig", secret, { now }), null);
  assert.equal(await verifyToken("user-1.notanumber.sig", secret, { now }), null);
  assert.equal(await verifyToken("user-1.1.zz", secret, { now }), null);
});
