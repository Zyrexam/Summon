import assert from "node:assert/strict";
import test from "node:test";
import { name } from "./index.ts";

test("core exports name", () => {
  assert.equal(name, "summon");
});
