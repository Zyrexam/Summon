-- Auth only. Chat content is never stored: the relay keeps ciphertext in
-- memory for the life of a session and drops it after the report TTL.
--
-- Safe to apply repeatedly. It creates what is missing and never drops data,
-- so `psql -f schema.sql` against a live database is harmless.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Login attempts, counted in the database rather than in process memory so
-- that a serverless cold start cannot hand an attacker a fresh budget.
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS rate_limits_reset_at_idx
  ON rate_limits (reset_at);