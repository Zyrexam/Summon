import { describe, expect, it } from "vitest";
import { SUMMON_SYSTEM_PROMPT, trimSummonContext } from "./ai";

describe("trimSummonContext", () => {
  it("keeps the most recent lines within every budget", () => {
    const lines = Array.from({ length: 10 }, (_, i) => ({
      name: "A",
      body: `line ${i}`,
    }));
    const out = trimSummonContext(lines, 4, 100, 1000);
    expect(out.map((l) => l.body)).toEqual(["line 6", "line 7", "line 8", "line 9"]);
  });

  it("truncates long bodies and drops the oldest past the total budget", () => {
    const lines = [
      { name: "A", body: "old ".repeat(200) },
      { name: "B", body: "new" },
    ];
    const out = trimSummonContext(lines, 50, 10, 13);
    expect(out.map((l) => l.body)).toEqual(["old old ol", "new"]);
  });

  it("drops blank lines", () => {
    const out = trimSummonContext(
      [
        { name: "A", body: "   " },
        { name: "B", body: "kept" },
      ],
      50,
      500,
      6000,
    );
    expect(out).toEqual([{ name: "B", body: "kept" }]);
  });
});

describe("summon system prompt", () => {
  it("sets open-domain behavior without hardcoded topics", () => {
    expect(SUMMON_SYSTEM_PROMPT).toMatch(/general knowledge/i);
    expect(SUMMON_SYSTEM_PROMPT).toMatch(/follow-ups/i);
    expect(SUMMON_SYSTEM_PROMPT).not.toMatch(/kyoto|javascript|restaurant|hotel/i);
  });
});
