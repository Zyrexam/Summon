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