import type { SummonContextLine } from "@summon/core";
import type { SessionMessage } from "./session";

/**
 * What the relay is allowed to forward to the provider: the tail of the
 * readable conversation, including Summon AI's own earlier answers labeled
 * as such so follow-ups ("there", "nearby", "it") resolve. Undecryptable
 * frames hold placeholder text, not anything the room said.
 */
export function summonContextLines(
  messages: SessionMessage[],
  limit: number,
): SummonContextLine[] {
  return messages
    .filter((message) => message.readable)
    .map((message) => ({
      name:
        message.kind === "ai"
          ? "Summon AI"
          : message.you
            ? "You"
            : message.fromName,
      body: message.body.trim(),
    }))
    .filter((line) => line.body.length > 0)
    .slice(-limit);
}