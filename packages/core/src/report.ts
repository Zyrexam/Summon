import type { ReportLine } from "./session.ts";

function clock(at: string): string {
  const parsed = new Date(at);
  return Number.isNaN(parsed.getTime()) ? at : parsed.toISOString().slice(11, 19);
}

/** A display name is user input; it must not be able to forge a table row. */
function cell(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

/**
 * The downloadable session report (ticket 006). Metadata only: who spoke, when,
 * and the message reference. Message content stays encrypted on the clients and
 * never reaches the relay, so there is nothing here to quote.
 */
export function formatReport(lines: ReportLine[], endedAt: string | null): string {
  const rows = lines.map((line) => {
    const who = line.kind === "ai" ? "Summon AI" : line.senderName;
    return `| ${cell(clock(line.at))} | ${cell(who)} | ${cell(line.msgId)} |`;
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