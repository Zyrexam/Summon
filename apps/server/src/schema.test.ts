import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const schema = readFileSync(
  fileURLToPath(new URL("../schema.sql", import.meta.url)),
  "utf8",
);

it("P3-3: schema.sql never destroys data", () => {
  const destructive = schema.match(/^\s*(DROP|TRUNCATE)\b.*;$/gim) ?? [];
  expect(destructive).toEqual([]);
});

it("P3-3: creating the schema is idempotent", () => {
  const creates = schema.match(/CREATE TABLE/gim) ?? [];
  for (const statement of creates) expect(statement).toBe("CREATE TABLE");
  expect(/CREATE TABLE IF NOT EXISTS/gim.test(schema)).toBe(true);
});