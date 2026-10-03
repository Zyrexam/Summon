-- Sessions and chat ciphertext. Plaintext never leaves the browsers: messages
-- persist as (iv, enc) only, so a reload or relay restart can replay history
-- that only holders of the room key can read.
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

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'live',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS session_members (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  host BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (session_id, user_id)
);

-- Ciphertext only. kind is metadata ("human" | "ai"), same as the report.
CREATE TABLE IF NOT EXISTS messages (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  msg_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  iv TEXT NOT NULL,
  enc TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'human',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, msg_id)
);

CREATE INDEX IF NOT EXISTS messages_session_idx
  ON messages (session_id, created_at);

-- Login attempts, counted in the database rather than in process memory so
-- that a serverless cold start cannot hand an attacker a fresh budget.
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS rate_limits_reset_at_idx
  ON rate_limits (reset_at);