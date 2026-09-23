# 003 — Join link + host admit

```yaml
status: open
order: 3
blockedBy: [001]
resolution: null
```

**Do**

- Shareable link `/room/<id>` → visitor knocks → host **Allow / Deny**.
- No self-join. On admit, host ships the room key; visitor joins as member.
- UI: copy link, “waiting for host”, knock list with Allow/Deny, admitted/rejected.
- Presence dots (online / offline) in the roster.

**Done when**

- Link visitor waits; only host admit gets them in with working decrypt.
