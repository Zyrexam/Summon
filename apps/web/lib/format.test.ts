import { describe, expect, test } from "vitest";
import { initials, clockTime } from "./format";

test("initials takes at most two leading letters", () => {
  expect(initials("Ada Lovelace")).toBe("AL");
  expect(initials("ada-lovelace king")).toBe("AL");
  expect(initials("")).toBe("");
});

test("clockTime formats an instant for a chat timestamp", () => {
  const at = new Date(2026, 0, 1, 9, 5, 0);
  expect(clockTime(at)).toBe(
    at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
  );
});