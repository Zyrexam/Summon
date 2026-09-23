# Summon

Private rooms: end-to-end encrypted chat, video call, and `@ai` — AI only answers when summoned.

## Build order (locked)

1. Foundation (monorepo + auth + rooms + E2EE chat loop)
2. Video call (1:1 first)
3. Chat polish (join-by-link + host admit, presence UI)
4. AI summon (`@ai` → answer as Summon AI)
5. Responsive (375 / 768 / 1280)

## Docs

- [docs/DECISIONS.md](docs/DECISIONS.md) — locked decisions
- [docs/tickets/](docs/tickets/) — open tickets, one at a time

No roles. No multi-device. No federation. Ship the loop; skip the extras.
