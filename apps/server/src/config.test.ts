import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, resolveLimits } from "./config";

describe("resolveLimits", () => {
  it("defaults everything with an empty environment", () => {
    const { limits, invalid } = resolveLimits({});
    expect(limits).toEqual(DEFAULT_LIMITS);
    expect(invalid).toEqual([]);
    expect(DEFAULT_LIMITS.maxPeers).toBe(6);
  });

  it("applies valid environment overrides", () => {
    const { limits, invalid } = resolveLimits({
      SUMMON_MAX_PEERS: "10",
      SUMMON_PER_DAY: "200",
    });
    expect(limits.maxPeers).toBe(10);
    expect(limits.summonPerDay).toBe(200);
    expect(limits.summonPerMinute).toBe(DEFAULT_LIMITS.summonPerMinute);
    expect(invalid).toEqual([]);
  });

  it("falls back on missing, garbage, or out-of-range values and reports them", () => {
    const { limits, invalid } = resolveLimits({
      SUMMON_MAX_PEERS: "1",
      SUMMON_PER_MINUTE: "lots",
      SUMMON_HISTORY_LIMIT: "999999999",
      SUMMON_REPORT_TTL_MS: "-5",
    });
    expect(limits.maxPeers).toBe(DEFAULT_LIMITS.maxPeers);
    expect(limits.summonPerMinute).toBe(DEFAULT_LIMITS.summonPerMinute);
    expect(limits.historyLimit).toBe(DEFAULT_LIMITS.historyLimit);
    expect(limits.reportTtlMs).toBe(DEFAULT_LIMITS.reportTtlMs);
    expect(invalid).toEqual([
      "SUMMON_MAX_PEERS",
      "SUMMON_PER_MINUTE",
      "SUMMON_HISTORY_LIMIT",
      "SUMMON_REPORT_TTL_MS",
    ]);
  });

  it("explicit options win over the environment", () => {
    const { limits } = resolveLimits({ SUMMON_MAX_PEERS: "10" }, { maxPeers: 4 });
    expect(limits.maxPeers).toBe(4);
  });

  it("keeps every value an integer within SQL-safe bounds", () => {
    const { limits } = resolveLimits({ SUMMON_HISTORY_LIMIT: "250" });
    expect(Number.isSafeInteger(limits.historyLimit)).toBe(true);
  });
});
