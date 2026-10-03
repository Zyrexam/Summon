export type SessionId = string;
export type UserId = string;

export type SessionStatus = "live" | "ended";

export type ReportLine = {
  senderId: UserId;
  senderName: string;
  msgId: string;
  at: string;
  kind: "human" | "ai";
};

export const REPORT_TTL_MS = 2 * 60 * 60 * 1000;
export const MAX_SESSION_PEERS = 6;

/** Hard ceiling on the context a client may attach to a summon. */
export const MAX_SUMMON_CONTEXT_LINES = 50;

/** What a client sends as recent conversation when summoning. */
export type SummonContextLine = {
  name: string;
  body: string;
};
