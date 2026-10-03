import { MAX_SESSION_PEERS } from "@summon/core";

/**
 * The relay admits against the same ceiling (MAX_SESSION_PEERS), so the mesh
 * must not hold a second copy of the number where the two can disagree.
 */
export function canAcceptPeer(peerCount: number): boolean {
  return peerCount < MAX_SESSION_PEERS;
}