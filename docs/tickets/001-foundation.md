# 001 — Foundation

```yaml
status: open
order: 1
resolution: null
```

**Do**

- pnpm monorepo: `packages/core`, `apps/server`, `apps/web` (Next.js 15 + Tailwind).
- Shared domain + client/server cores in `core`; WS adapter in `server`.
- Register / login (scrypt + token), create room, invite, join, send, observe.
- E2EE: Megolm (vodozemac WASM). Ciphertext on the wire; room-key on invite/join.
- Basic web loop: login → room list → open chat → send/receive.

**Done when**

- Two browsers can open a room, invite, and exchange encrypted messages.
- `pnpm typecheck && pnpm test` green.
