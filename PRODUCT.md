# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Small teams who need private rooms for work chat and 1:1 video. Situation: daily work communication where content must not sit on a server in plaintext. Job: open a room, talk, call, occasionally summon AI without AI becoming a member of the room.

## Product Purpose

Private rooms: end-to-end encrypted chat, video call, and `@ai` — AI only answers when summoned. Success = two members can exchange encrypted messages and see each other on a call; AI answers only on summon and never appears on the roster.

## Positioning

AI is a guest, not a participant: `@ai` is client-mediated (client builds context → one relay call → answer returns as an encrypted room message). Summon AI is never a roster member and is never DM-able. Server stores ciphertext only.

## Operating Context

- Rooms: create, invite, join (later: join-by-link + host admit). One device per member (new login evicts old).
- Chat loop: login → room list → open chat → send/receive.
- Video: WebRTC 1:1 inside a room (mesh, no SFU), over the existing WS.
- AI summon: `@ai` in composer → ~15 lines recent context → one relay call → whole-arrival (non-streaming) encrypted answer as **Summon AI**.
- Relay stores nothing; provider on zero-data-retention terms (Anthropic first, `ANTHROPIC_API_KEY`).
- AI memory ends when the room empties or sits idle 24h; human history stays.

## Capabilities and Constraints

- Ticket 001 scope: monorepo foundation + auth (scrypt + token) + rooms + E2EE chat loop + basic web UI. Video, join/admit, AI UI, responsive pass are later locked tickets.
- Build order locked: foundation → video → chat polish → AI → responsive. Do not jump ahead.
- No roles, no multi-device, no federation.
- Server: in-memory only for now (no DB). Node + `ws` relay, shared TypeScript core.
- E2EE: Megolm (vodozemac WASM) in the browser; room-key on invite/join.
- UI brand constraint (user-binding): white theme, shadcn concept-based UI; Ink & Ember — human = ink, AI = ember; no `@ai` autocomplete; whole-arrival answers, no streaming.
- Tests: `pnpm typecheck && pnpm test`.

## Brand Commitments

- Name: Summon. Verb for AI: summon (`@ai`).
- Ink & Ember palette rule: human messages = ink, AI messages = ember.
- White theme + shadcn-style component system (user-declared binding for this UI pass).
- Voice: short, no hype. Nouns: Room, Member, Session, Summon AI, Summon, Moment, Relay, Summon Recall (later).

## Evidence on Hand

- `README.md`, `docs/DECISIONS.md` (10 locked decisions), `docs/tickets/001–005`.
- No real user content, screenshots, or brand assets exist yet. AI/human message copy in UI must be labeled synthetic; no invented customers, metrics, or claims.

## Product Principles

1. Ship the loop; skip the extras (no roles, multi-device, federation).
2. Server never sees plaintext; relay stores nothing.
3. AI is summoned, never ambient — presence and memory rules are product law.
4. Build order is locked; one ticket at a time.
5. One device per member until multi-device is deliberately added.

## Accessibility & Inclusion

No product-specific standard established yet; default to keyboard-reachable chat controls, visible focus, and contrast suitable for a white theme. Record a real standard only if the user sets one.
