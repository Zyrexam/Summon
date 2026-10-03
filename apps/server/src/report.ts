import type { ReportLine } from "@summon/core";

export const MAX_REPORT_LINES = 500;

export type ReportBuffer = {
  add(line: ReportLine): void;
  lines(): ReportLine[];
  size(): number;
};

export type ReportLineInput = {
  senderId: string;
  senderName: string;
  msgId: string;
  kind: "human" | "ai";
  at?: string;
};

/** Metadata only: the relay never sees plaintext, so it never stores any. */
export function reportLineFor(input: ReportLineInput): ReportLine {
  return {
    senderId: input.senderId,
    senderName: input.senderName,
    msgId: input.msgId,
    at: input.at ?? new Date().toISOString(),
    kind: input.kind,
  };
}

/** Fixed-capacity ring: appends stay O(1) instead of shifting the whole log. */
export function createReportBuffer(cap: number = MAX_REPORT_LINES): ReportBuffer {
  const ring: ReportLine[] = new Array(cap);
  let next = 0;
  let count = 0;
  return {
    add(line) {
      ring[next] = line;
      next = (next + 1) % cap;
      if (count < cap) count += 1;
    },
    lines() {
      if (count < cap) return ring.slice(0, count);
      return [...ring.slice(next), ...ring.slice(0, next)];
    },
    size() {
      return count;
    },
  };
}
