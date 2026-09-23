# 002 — Video call (1:1)

```yaml
status: open
order: 2
blockedBy: [001]
resolution: null
```

**Do**

- WebRTC 1:1 inside a room. Signal offer / answer / ICE over the existing WS.
- Show self + remote video. Controls: mute, camera, leave call.
- Mesh is enough (2 peers). No SFU, no recording.

**Done when**

- Two members in the same room can see and hear each other.
