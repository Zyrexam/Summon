import type { RosterMember } from "./signal.ts";

export type SenderVisibilityInput = {
  /** Humans in the roster. Summon AI is never on the roster, so it is never counted. */
  humanCount: number;
  kind: "human" | "ai";
  isYou: boolean;
  from: string;
  fromName: string;
  /** senderKey of the message rendered above this one, if it is in the same run. */
  previousKey?: string;
};

export type SenderLabel = { show: boolean; text: string };

/** Summon AI always speaks under its own name, ember styling included. */
const AI_LABEL = "Summon AI";

export function humanSenderCount(roster: RosterMember[]): number {
  return roster.length;
}

/** Identity of a message's sender, for grouping consecutive messages into a run. */
export function senderKey(input: SenderVisibilityInput): string {
  if (input.kind === "ai") return "ai";
  return input.isYou ? `you:${input.from}` : `human:${input.from}`;
}

/**
 * docs/chat-ui-spec.md: two humans need no sender names, three or more do.
 * A name is also suppressed while a run of messages from the same sender
 * continues, so the name reads once per run rather than once per line.
 */
export function senderLabel(input: SenderVisibilityInput): SenderLabel {
  if (input.kind === "ai") {
    return input.previousKey === "ai"
      ? { show: false, text: "" }
      : { show: true, text: input.fromName || AI_LABEL };
  }
  if (input.humanCount < 3) return { show: false, text: "" };
  if (input.previousKey === senderKey(input)) return { show: false, text: "" };
  return { show: true, text: input.isYou ? "You" : input.fromName };
}