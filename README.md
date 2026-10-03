# Summon

Private rooms: end-to-end encrypted chat, video, and `@ai` — an assistant that answers only when summoned.

Create a link, admit who you want, talk. When the call ends you get a short report of who spoke and when. Message content never leaves the browsers.

## Features

- **End-to-end encrypted chat.** AES-256-GCM per message, bound to `sessionId | msgId | senderId` so nobody can replay someone else's message. The relay sees ciphertext only.
- **Video for up to 6 people.** WebRTC mesh. Join by link; the host approves each visitor.
- **`@ai` answers on demand.** Ask in the chat box, get a reply as Summon AI. It is never a room member and cannot be addressed directly.
- **Session reports.** Metadata only — who spoke, when — kept two hours after the call, then dropped.
- **Nothing persists.** No stored messages, no message rows in the database.

## Setup

You need a Postgres database. The app talks to it over Neon’s HTTP driver, so
`DATABASE_URL` must be a Neon (or Neon-compatible) connection string — a local
Postgres over TCP will not work.

```bash
pnpm install
cp .env.example .env    # fill in DATABASE_URL, TOKEN_SECRET, GROQ_API_KEY
pnpm dev                # relay :8787, web :3000
```

Apply `apps/server/schema.sql` once to create the `users` and `rate_limits`
tables. It is `CREATE TABLE IF NOT EXISTS` only, so re-running it is safe.

Generate a real token secret:

```bash
openssl rand -base64 48
```

`TOKEN_SECRET` must be **identical** on the web app and the relay: the web app
signs session tokens, the relay verifies them.

`@ai` needs `GROQ_API_KEY`. Without it, chat and video work and `@ai` replies
that it is unavailable.

Check the build:

```bash
pnpm typecheck && pnpm test
```

## Deploying

Three deployables:

| Piece | Where | Why |
|---|---|---|
| `apps/web` | Vercel | Stateless server-rendered app plus auth routes. `vercel.json` is included. |
| `apps/server` | Fly.io / Railway / Render | A `ws` relay holding session state in memory; run `pnpm --filter @summon/server start`. |
| Postgres | Neon | Users and rate-limit counters only. |

The relay cannot run on Vercel: WebSocket connections are pinned to one function
instance, so two peers in the same room could land apart and never connect.

Set on Vercel: `NEXT_PUBLIC_SIGNAL_URL` **as a build variable** (`NEXT_PUBLIC_*` values are
inlined at build time) — that is the only variable the frontend needs. The browser
derives the auth API base (`https://host`) from the relay URL (`wss://host`).
Set on the relay: `DATABASE_URL`, `TOKEN_SECRET`, `GROQ_API_KEY`, `TRUST_PROXY=true`.

## Limits

- Up to 6 peers (a full mesh, so this is CPU-bound on a laptop).
- One device per member — a new login evicts the old one.
- Sessions live 7 days; `@ai` is capped at 5 calls per member per minute.
- One shared room key: no forward secrecy, and leaving a room does not revoke it.

## Notes

- `apps/server` is a `ws` relay plus the auth API (`POST /api/auth/login|register`). It authenticates, brokers WebRTC signalling, and keeps a session in memory. It stores no messages.
- The database holds users and nothing else. Rate limits are in-memory on the relay.
- Logs are one JSON object per line, with tokens and keys redacted.