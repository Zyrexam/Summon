# Decisions

Locked calls. Edit only deliberately.

| # | Decision |
|---|----------|
| 1 | Custom stack: Node + WS relay, shared TypeScript core. No Matrix, no federation. |
| 2 | E2EE with vodozemac (Megolm) in the browser. Server stores ciphertext only. |
| 3 | `@ai` is client-mediated: client builds recent context → one relay call → answer returns as an encrypted room message. |
| 4 | Ksana AI is not a member: never on the roster, never DM-able. |
| 5 | AI memory ends when the room empties or sits idle 24h. Human history stays. |
| 6 | One device per member (new login evicts old). Multi-device later. |
| 7 | Relay stores nothing; provider must accept zero-data-retention terms. Anthropic first. |
| 8 | UI is Ink & Ember only: human = ink, AI = ember, whole-arrival answers (no streaming), no `@ai` autocomplete. |
| 9 | pnpm monorepo: `packages/core`, `apps/server`, `apps/web` (Next.js 15 + Tailwind). |
| 10 | Build order is locked: foundation → video → chat polish → AI UI → responsive. Do not jump ahead. |

## Product nouns

**Room** · **Member** · **Session** · **Ksana AI** · **Summon** (`@ai`) · **Moment** · **Relay** · **Ksana Recall** (later).

## Stack notes

- Server: in-memory only for now (no DB). Node, `ws`, scrypt auth, bearer token.
- Tests: `pnpm typecheck && pnpm test`.
- Style: short commits, minimal comments, never push until a remote exists.
