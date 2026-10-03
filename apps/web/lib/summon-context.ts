import type { SummonContextLine } from "@summon/core";
import type { SessionMessage } from "./session";

/**
 * What the relay is allowed to forward to the provider: the tail of the human
 * conversation only. Undecryptable frames hold placeholder text, not anything
 * the room said, and Summon AI's own answers are not context.
 */
export function summonContextLines(
  messages: SessionMessage[],
  limit: number,
): SummonContextLine[] {
  return messages
    .filter((message) => message.readable && message.kind !== "ai")
    .map((message) => ({
      name: message.you ? "You" : message.fromName,
      body: message.body.trim(),
    }))
    .filter((line) => line.body.length > 0)
    .slice(-limit);
}