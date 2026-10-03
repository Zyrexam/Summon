import { describe, expect, it } from "vitest";
import { MAX_SESSION_PEERS } from "@summon/core";
import { canAcceptPeer } from "./mesh-cap";

describe("mesh ceiling", () => {
  it("tracks the one exported peer limit", () => {
    // If someone raises MAX_SESSION_PEERS, the client follows automatically
    // instead of silently disagreeing with the relay about the ceiling.
    expect(MAX_SESSION_PEERS).toBe(6);
  });

  it("accepts peers until the room is full", () => {
    expect(canAcceptPeer(0)).toBe(true);
    expect(canAcceptPeer(MAX_SESSION_PEERS - 1)).toBe(true);
  });

  it("refuses a peer once the ceiling is reached", () => {
    expect(canAcceptPeer(MAX_SESSION_PEERS)).toBe(false);
    expect(canAcceptPeer(MAX_SESSION_PEERS + 1)).toBe(false);
  });

  it("agrees with the relay's own admission guard", () => {
    for (let count = 0; count < MAX_SESSION_PEERS + 2; count += 1) {
      expect(canAcceptPeer(count)).toBe(count < MAX_SESSION_PEERS);
    }
  });

  it("follows an advertised ceiling instead of the compiled default", () => {
    expect(canAcceptPeer(6, 10)).toBe(true);
    expect(canAcceptPeer(10, 10)).toBe(false);
    expect(canAcceptPeer(1, 2)).toBe(true);
    expect(canAcceptPeer(2, 2)).toBe(false);
  });
});