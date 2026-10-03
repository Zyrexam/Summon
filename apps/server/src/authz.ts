import { MAX_SESSION_PEERS, type SessionId, type UserId } from "@summon/core";
import type { WebSocket } from "ws";
import type { ReportBuffer } from "./report";

export type RelayMember = {
  id: UserId;
  name: string;
  socket: WebSocket | null;
  online: boolean;
  host: boolean;
};

export type SessionRec = {
  id: SessionId;
  hostId: UserId;
  status: "live" | "ended";
  members: Map<UserId, RelayMember>;
  knocks: Map<UserId, RelayMember>;
  peers: Map<UserId, WebSocket>;
  report: ReportBuffer;
  endedAt: number | null;
  reportTtl: ReturnType<typeof setTimeout> | null;
};

export type Denial = {
  code: "no-session" | "not-host" | "forbidden" | "full";
  message: string;
};

export type Guard = { ok: true } | { ok: false; denial: Denial };

const allow: Guard = { ok: true };

function deny(code: Denial["code"], message: string): Guard {
  return { ok: false, denial: { code, message } };
}

/** A report holds the roster of a real conversation; members only. */
export function canReadReport(
  session: SessionRec | undefined,
  userId: UserId,
): Guard {
  if (!session) return allow;
  if (!session.members.has(userId)) {
    return deny("forbidden", "You are not a member of this session");
  }
  return allow;
}

function isMember(session: SessionRec, userId: UserId): boolean {
  return session.members.has(userId);
}

function isHost(session: SessionRec, userId: UserId): boolean {
  return session.hostId === userId;
}

/** Capability required to run a message type against a session. */
export type Capability = "host" | "member";

export function canSend(
  session: SessionRec | undefined,
  userId: UserId,
  capability: Capability,
): Guard {
  if (!session) return deny("no-session", "Session not found or ended");
  if (capability === "host" && !isHost(session, userId)) {
    return deny("not-host", "Only the host can do that");
  }
  if (capability === "member" && !isMember(session, userId)) {
    return deny("forbidden", "You are not a member of this session");
  }
  return allow;
}

/** The mesh ceiling applies to every way a socket enters the call. */
export function hasPeerRoom(session: SessionRec, userId: UserId): boolean {
  return session.peers.size < MAX_SESSION_PEERS || session.peers.has(userId);
}

/**
 * Admission has its own ceiling: a host could otherwise admit without limit,
 * since a member does not occupy a mesh slot until they join.
 */
export function hasMemberRoom(session: SessionRec, userId: UserId): boolean {
  return session.members.size < MAX_SESSION_PEERS || session.members.has(userId);
}
