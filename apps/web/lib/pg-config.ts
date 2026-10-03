export type PoolOptions = {
  connectionString: string;
  /** A warm lambda holds this many connections; more exhausts Neon's ceiling. */
  max: number;
  /** Never wait forever for a connection: fail fast and let the caller retry. */
  connectionTimeoutMillis: number;
  /** Release connections an idle lambda is still pinning. */
  idleTimeoutMillis: number;
  /** Stop a pathological query from occupying a pooled connection. */
  statement_timeout: number;
};

/**
 * Tuned for serverless, where every warm instance carries its own pool. The
 * default of 10 connections per process is what exhausts a hosted database's
 * connection limit once a handful of instances are warm.
 */
export function poolOptions(connectionString: string | undefined): PoolOptions {
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Point it at your Postgres connection string.",
    );
  }
  return {
    connectionString,
    max: 2,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 10_000,
    statement_timeout: 5_000,
  };
}