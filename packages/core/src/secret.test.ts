import test from "node:test";
import assert from "node:assert/strict";
import { assertStrongSecret, DEV_SECRET_FALLBACK } from "./secret.ts";

test("production refuses an unset secret", () => {
  assert.throws(() => assertStrongSecret(undefined, true), /TOKEN_SECRET/);
  assert.throws(() => assertStrongSecret("", true), /TOKEN_SECRET/);
  assert.throws(() => assertStrongSecret("   ", true), /TOKEN_SECRET/);
});

test("production refuses the published default", () => {
  // This fallback is printed in the README. Shipping it means anyone can mint a
  // valid token for any user id, so it must fail loudly, not quietly work.
  assert.throws(
    () => assertStrongSecret(DEV_SECRET_FALLBACK, true),
    /TOKEN_SECRET/,
  );
});

test("production refuses a secret that is too short to be secret", () => {
  assert.throws(() => assertStrongSecret("short", true), /TOKEN_SECRET/);
});

test("production accepts a strong secret", () => {
  const strong = "k3Jt9xPq2Vw7LtZb5Nc8Rd1Sf4Gh6Jm0Y";
  assert.doesNotThrow(() => assertStrongSecret(strong, true));
});

test("development keeps the fallback so the repo runs with no setup", () => {
  assert.doesNotThrow(() => assertStrongSecret(undefined, false));
  assert.doesNotThrow(() => assertStrongSecret(DEV_SECRET_FALLBACK, false));
});

test("the error names the variable, not the value", () => {
  try {
    assertStrongSecret(DEV_SECRET_FALLBACK, true);
    assert.fail("should have thrown");
  } catch (error) {
    const message = (error as Error).message;
    assert.match(message, /TOKEN_SECRET/);
    assert.doesNotMatch(message, new RegExp(DEV_SECRET_FALLBACK));
  }
});