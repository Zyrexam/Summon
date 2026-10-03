import type { Queryable } from "./accounts.ts";

/**
 * One atomic upsert per attempt. Read-then-write would race between the server
 * instances that share a database, which is exactly the case rate limiting
 * exists for: two concurrent attempts could both read "count 0" and both be
 * allowed.
 */
export const RATE_LIMIT_SQL = `INSERT INTO rate_limits (key, count, reset_at)
   VALUES ($1, 1, now() + ($2::bigint * interval '1 millisecond'))
   ON CONFLICT (key) DO UPDATE SET
     count = CASE
       WHEN rate_limits.reset_at <= now() THEN 1
       ELSE rate_limits.count + 1
     END,
     reset_at = CASE
       WHEN rate_limits.reset_at <= now()
         THEN now() + ($2::bigint * interval '1 millisecond')
       ELSE rate_limits.reset_at
     END
   RETURNING count`;

export type RateLimitStore = {
  /** Charges one attempt and reports whether it is still within `limit`. */
  take: (key: string, limit: number, windowMs: number) => Promise<boolean>;
};

/**
 * Counts attempts in Postgres so every server instance shares one budget.
 * On a single instance the in-memory limiter is cheaper; this is for when the
 * app runs as more than one (serverless), where a per-process Map resets with
 * every cold start and lets brute force walk straight through.
 */
export function createPostgresRateLimitStore(
  db: Queryable,
): RateLimitStore {
  return {
    async take(key, limit, windowMs) {
      const result = await db.query<{ count: number }>(RATE_LIMIT_SQL, [
        key,
        windowMs,
      ]);
      const count = Number(result.rows[0]?.count ?? Number.MAX_SAFE_INTEGER);
      return count <= limit;
    },
  };
}