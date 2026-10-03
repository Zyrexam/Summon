import { MAX_SESSION_PEERS } from "@summon/core";

/**
 * Client-side copy of the ceiling the relay advertised in `ready` (which
 * defaults to MAX_SESSION_PEERS until then). The relay always enforces the
 * real limit; this only avoids building offers it would refuse.
 */
export function canAcceptPeer(peerCount: number, cap: number = MAX_SESSION_PEERS): boolean {
  return peerCount < cap;
}