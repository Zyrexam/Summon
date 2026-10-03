import assert from "node:assert/strict";
import test from "node:test";
import {
  createUser,
  findUserByEmail,
  INSERT_USER_SQL,
  normalizeEmail,
  type Queryable,
} from "./accounts.ts";

type StubCall = { text: string; values: unknown[] | undefined };

function stub(rows: unknown[][]): { db: Queryable; calls: StubCall[] } {
  const calls: StubCall[] = [];
  const db: Queryable = {
    async query<T>(text: string, values?: unknown[]) {
      calls.push({ text, values });
      return { rows: rows.shift() as T[] };
    },
  };
  return { db, calls };
}

test("createUser returns the inserted row", async () => {
  const { db, calls } = stub([[{ id: "u1", name: "Ada" }]]);
  const user = await createUser(db, "u1", "  Ada@Example.COM ", "hash", "Ada");
  assert.deepEqual(user, { id: "u1", name: "Ada" });
  assert.match(calls[0]!.text, /RETURNING id, name/);
  assert.deepEqual(calls[0]!.values, ["u1", "ada@example.com", "hash", "Ada"]);
});

test("createUser returns null on email conflict instead of the existing user", async () => {
  const { db } = stub([[]]);
  assert.equal(await createUser(db, "attacker", "victim@example.com", "hash", "Attacker"), null);
});

test("findUserByEmail normalizes the email", async () => {
  const { db, calls } = stub([[{ id: "u1", email: "a@b.com", password_hash: "h", name: "A" }]]);
  const user = await findUserByEmail(db, " A@B.com ");
  assert.equal(user?.id, "u1");
  assert.deepEqual(calls[0]!.values, ["a@b.com"]);
});

test("normalizeEmail trims and lowercases", () => {
  assert.equal(normalizeEmail("  Ada@Example.COM "), "ada@example.com");
});

test("the insert never selects a pre-existing user", () => {
  assert.doesNotMatch(INSERT_USER_SQL, /SELECT/i);
});
