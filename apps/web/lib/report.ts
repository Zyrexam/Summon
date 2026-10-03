import { formatReport, type ReportLine } from "@summon/core";

export type ReportState = {
  lines: ReportLine[];
  endedAt: string | null;
  ended: boolean;
  markdown: string;
  fileName: string;
};

function isReportLine(value: unknown): value is ReportLine {
  if (typeof value !== "object" || value === null) return false;
  const line = value as Partial<ReportLine>;
  return (
    typeof line.senderId === "string" &&
    typeof line.senderName === "string" &&
    typeof line.msgId === "string" &&
    typeof line.at === "string" &&
    (line.kind === "human" || line.kind === "ai")
  );
}

export function reportFileName(sessionId: string, endedAt: string | null): string {
  const safeSession =
    sessionId
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      .replace(/^[.\-]+/, "")
      .replace(/-+/g, "-") || "session";
  if (!endedAt) return `summon-report-${safeSession}-live.md`;
  const stamp = new Date(endedAt);
  const suffix = Number.isNaN(stamp.getTime())
    ? "ended"
    : stamp.toISOString().replace(/[:.]/g, "-");
  return `summon-report-${safeSession}-${suffix}.md`;
}

/** The relay's report frame is untrusted input: keep only well-formed lines. */
export function reportStateFrom(
  sessionId: string,
  lines: readonly unknown[],
  endedAt: string | null,
): ReportState {
  const kept = lines.filter(isReportLine);
  const ended = typeof endedAt === "string" && endedAt.length > 0;
  return {
    lines: kept,
    endedAt: ended ? endedAt : null,
    ended,
    markdown: formatReport(kept, ended ? endedAt : null),
    fileName: reportFileName(sessionId, ended ? endedAt : null),
  };
}