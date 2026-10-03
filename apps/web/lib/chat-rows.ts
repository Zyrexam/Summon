import {
  humanSenderCount,
  senderKey,
  senderLabel,
  type RosterMember,
} from "@summon/core";
import type { SessionMessage } from "@/lib/session";

export type SenderRow = { id: string; show: boolean; text: string };

/**
 * One sender label per message, decided by docs/chat-ui-spec.md: no names at two
 * humans, names per run at three or more, Summon AI always under its own name.
 */
export function senderRows(
  messages: SessionMessage[],
  roster: RosterMember[],
): SenderRow[] {
  const humanCount = humanSenderCount(roster);
  let previousKey: string | undefined;
  return messages.map((message) => {
    const input = {
      humanCount,
      kind: message.kind,
      isYou: Boolean(message.you),
      from: message.from,
      fromName: message.fromName,
      previousKey,
    };
    const label = senderLabel(input);
    previousKey = senderKey(input);
    return { id: message.id, show: label.show, text: label.text };
  });
}