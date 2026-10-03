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

```bash
pnpm install
docker compose up -d     # Postgres for auth only
cp .env.example .env     # add GROQ_API_KEY to enable @ai
pnpm dev                 # relay :8787, web :3000
```

`@ai` needs `GROQ_API_KEY`. Without it, chat and video work and `@ai` replies that it is unavailable.

Check the build:

```bash
pnpm typecheck && pnpm test
```

## Limits

- Up to 6 peers (a full mesh, so this is CPU-bound on a laptop).
- One device per member — a new login evicts the old one.
- Sessions live 7 days; `@ai` is capped at 5 calls per member per minute.
- One shared room key: no forward secrecy, and leaving a room does not revoke it.

## Notes

- `apps/server` is a `ws` relay. It authenticates, brokers WebRTC signalling, and keeps a session in memory. It stores no messages.
- Postgres holds users and nothing else.
- Logs are one JSON object per line, with tokens and keys redacted.