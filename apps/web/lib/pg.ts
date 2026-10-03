import { Pool } from "@neondatabase/serverless";

import { assertStrongSecret, DEV_SECRET_FALLBACK, type Queryable } from "@summon/core";

import { poolOptions } from "@/lib/pg-config";

/**
 * Neon's serverless driver talks HTTP rather than holding a TCP socket per
 * lambda, so a cold start costs no TLS handshake and an idle instance pins
 * nothing. A consequence: a local Postgres over TCP is not reachable from here,
 * so DATABASE_URL must point at Neon (or a Neon-compatible endpoint).
 *
 * Both accessors are lazy on purpose. `next build` imports route modules, and a
 * throw at import time would fail the deploy before a single request ran.
 */
let cachedPool: Queryable | null = null;

export function getPool(): Queryable {
  if (!cachedPool) {
    cachedPool = new Pool(
      poolOptions(process.env.DATABASE_URL),
    ) as unknown as Queryable;
  }
  return cachedPool;
}

export function getTokenSecret(): string {
  // A deploy that forgets TOKEN_SECRET would otherwise fall back to the value
  // printed in the README, silently accepting tokens anyone can mint.
  assertStrongSecret(
    process.env.TOKEN_SECRET,
    process.env.NODE_ENV === "production",
  );
  return process.env.TOKEN_SECRET ?? DEV_SECRET_FALLBACK;
}