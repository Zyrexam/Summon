# 004 — AI summon

```yaml
status: open
order: 4
blockedBy: [001]
resolution: null
```

**Do**

- `@ai` in composer → client builds last ~15 lines context → one relay call.
- Answer posts as encrypted room message from **Summon AI** (not a roster member).
- Relay: injected, stores nothing; Anthropic via `ANTHROPIC_API_KEY`.
- UI: whole-arrival (no stream), ember sender, no autocomplete.
- Context capped (~50 lines server-side).

**Done when**

- Typing `@ai` question shows an answer as Summon AI in the room; AI never appears as a member.
