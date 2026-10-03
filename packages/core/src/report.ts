import type { ReportLine } from "./session.ts";

function clock(at: string): string {
  const parsed = new Date(at);
  return Number.isNaN(parsed.getTime()) ? at : parsed.toISOString().slice(11, 19);
}

/**
 * The downloadable session report (ticket 006). Metadata only: who spoke, when,
 * and the message reference. Message content stays encrypted on the clients and
 * never reaches the relay, so there is nothing here to quote.
 */
export function formatReport(lines: ReportLine[], endedAt: string | null): string {
  const rows = lines.map((line) => {
    const who = line.kind === "ai" ? "Summon AI" : line.senderName;
    return `| ${clock(line.at)} | ${who} | ${line.msgId} |`;
  });
  const header = ["| Time | Who | Message |", "| --- | --- | --- |"];
  const body = rows.length > 0 ? [...header, ...rows] : ["_No lines recorded._"];
  return [
    "# Summon session report",
    "",
    ...body,
    "",
    endedAt ? `Ended: ${clock(endedAt)} UTC` : "Status: still live",
    "",
  ].join("\n");
}