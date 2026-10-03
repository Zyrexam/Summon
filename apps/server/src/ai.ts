import type { SummonContextLine } from "@summon/core";

/**
 * Summon AI is a guest, not a participant. It answers a question about the
 * recent conversation and nothing else: it has no roster identity, no memory
 * past this request, and no ability to act in the session.
 */
export const SUMMON_SYSTEM_PROMPT = [
  "You are Summon AI, a guest in a private call.",
  "You are given the last few lines of the conversation, then one question.",
  "Answer the question directly and concisely, in at most a short paragraph.",
  "Base your answer on the conversation shown. If it does not contain the answer, say so plainly rather than guessing.",
  "Never invent facts, people, or events that are not in the conversation.",
  "Do not use markdown headings or bullet lists. Plain prose only.",
  "You are not a member of the call: do not refer to yourself as a participant, and do not ask to be added.",
].join(" ");

export const DEFAULT_SUMMON_MODEL = "openai/gpt-oss-120b";

export type SummonRequest = {
  question: string;
  context: SummonContextLine[];
};

export type AiProvider = {
  readonly name: string;
  complete(request: SummonRequest): Promise<string>;
};

export type GroqProviderOptions = {
  apiKey: string;
  model: string;
  baseUrl?: string;
  signal?: AbortSignal;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * OpenAI-compatible chat responses put the answer in `choices[0].message.content`.
 * Reasoning models may leave it null and expose the text via `reasoning_content`.
 */
function readAnswer(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!isRecord(first)) return null;
  const message = first.message;
  if (!isRecord(message)) return null;
  const content = message.content;
  if (typeof content === "string" && content.trim().length > 0) {
    return content.trim();
  }
  const reasoning = message.reasoning_content;
  if (typeof reasoning === "string" && reasoning.trim().length > 0) {
    return reasoning.trim();
  }
  return null;
}

function toMessages(request: SummonRequest) {
  const transcript = request.context.map(
    (line) => `${line.name}: ${line.body}`,
  );
  const userTurns = transcript.length > 0
    ? [
        { role: "user" as const, content: `Recent conversation:\n${transcript.join("\n")}` },
        { role: "assistant" as const, content: "Understood." },
      ]
    : [];
  return [
    { role: "system" as const, content: SUMMON_SYSTEM_PROMPT },
    ...userTurns,
    { role: "user" as const, content: request.question },
  ];
}

export function createGroqProvider(options: GroqProviderOptions): AiProvider {
  const baseUrl = options.baseUrl ?? "https://api.groq.com/openai/v1";
  return {
    name: `groq:${options.model}`,
    async complete(request) {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: options.model,
          messages: toMessages(request),
          temperature: 0.3,
          max_tokens: 512,
          stream: false,
        }),
        signal: options.signal,
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        throw new Error(`provider responded ${res.status}: ${detail}`);
      }
      const answer = readAnswer(await res.json());
      if (answer === null) {
        throw new Error("provider returned no message content");
      }
      return answer;
    },
  };
}
