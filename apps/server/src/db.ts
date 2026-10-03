import { Pool } from "@neondatabase/serverless";

import type { Queryable } from "@summon/core";

export type PoolOptions = {
  connectionString: string;
  /** One persistent process, not a fleet of lambdas: a small pool is plenty. */
  max: number;
  /** Never wait forever for a connection: fail fast and let the caller retry. */
  connectionTimeoutMillis: number;
  /** Release connections an idle process is still pinning. */
  idleTimeoutMillis: number;
  /** Stop a pathological query from occupying a pooled connection. */
  statement_timeout: number;
};

export function poolOptions(connectionString: string | undefined): PoolOptions {
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Point it at your Postgres connection string.",
    );
  }
  return {
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    statement_timeout: 5_000,
  };
}

/**
 * Lazy on purpose: importing this module (or booting the relay for chat and
 * video) must never require a database. The first auth request pays for it.
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
