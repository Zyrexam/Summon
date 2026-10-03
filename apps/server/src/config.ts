/**
 * Operational limits. Code defaults are the product defaults; every field is
 * overridable via environment for deployments that need a smaller (or
 * larger) footprint — nothing about capacity is baked into the logic.
 */
export type RelayLimits = {
  /** Mesh + membership ceiling per session. */
  maxPeers: number;
  /** Provider calls per member per minute. */
  summonPerMinute: number;
  /** Provider calls per member per day (credit protection). */
  summonPerDay: number;
  /** Rejection threshold for an @ai question. */
  maxQuestionChars: number;
  /** Provider context: most-recent lines win. */
  maxContextLines: number;
  /** Per-line truncation for provider context. */
  maxLineChars: number;
  /** Total provider context budget. */
  maxContextChars: number;
  /** Ciphertext messages kept per session, and in-memory report lines. */
  historyLimit: number;
  /** How long an ended session stays readable for its report. */
  reportTtlMs: number;
};

export const DEFAULT_LIMITS: RelayLimits = {
  maxPeers: 6,
  summonPerMinute: 5,
  summonPerDay: 60,
  maxQuestionChars: 500,
  maxContextLines: 50,
  maxLineChars: 500,
  maxContextChars: 6_000,
  historyLimit: 500,
  reportTtlMs: 2 * 60 * 60 * 1000,
};

type Spec = {
  key: keyof RelayLimits;
  env: string;
  min: number;
  max: number;
};

const SPECS: Spec[] = [
  { key: "maxPeers", env: "SUMMON_MAX_PEERS", min: 2, max: 32 },
  { key: "summonPerMinute", env: "SUMMON_PER_MINUTE", min: 1, max: 100 },
  { key: "summonPerDay", env: "SUMMON_PER_DAY", min: 1, max: 10_000 },
  { key: "maxQuestionChars", env: "SUMMON_MAX_QUESTION_CHARS", min: 50, max: 4_000 },
  { key: "maxContextLines", env: "SUMMON_MAX_CONTEXT_LINES", min: 1, max: 200 },
  { key: "maxLineChars", env: "SUMMON_MAX_LINE_CHARS", min: 50, max: 4_000 },
  { key: "maxContextChars", env: "SUMMON_MAX_CONTEXT_CHARS", min: 500, max: 100_000 },
  { key: "historyLimit", env: "SUMMON_HISTORY_LIMIT", min: 10, max: 5_000 },
  { key: "reportTtlMs", env: "SUMMON_REPORT_TTL_MS", min: 60_000, max: 7 * 86_400_000 },
];

/**
 * Resolve limits from environment with clamping. Never throws: an missing or
 * out-of-range value falls back to the default and is reported in `invalid`
 * so boot can audit it. Values stay integers, which also keeps them safe to
 * interpolate into SQL LIMIT clauses.
 */
export function resolveLimits(
  env: Record<string, string | undefined> = process.env,
  overrides: Partial<RelayLimits> = {},
): { limits: RelayLimits; invalid: string[] } {
  const limits = { ...DEFAULT_LIMITS };
  const invalid: string[] = [];
  for (const spec of SPECS) {
    const override = overrides[spec.key] as number | undefined;
    if (override !== undefined) {
      if (Number.isSafeInteger(override) && override >= spec.min && override <= spec.max) {
        limits[spec.key] = override;
      } else {
        invalid.push(spec.env);
      }
      continue;
    }
    const raw = env[spec.env];
    if (raw === undefined || raw === "") continue;
    const value = Number(raw);
    if (Number.isSafeInteger(value) && value >= spec.min && value <= spec.max) {
      limits[spec.key] = value;
    } else {
      invalid.push(spec.env);
    }
  }
  return { limits, invalid };
}
