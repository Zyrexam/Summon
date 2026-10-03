// Exercises the real provider against the live API.
// Usage: pnpm exec tsx scripts/verify-summon.ts
import { readFileSync } from "node:fs";
import { createGroqProvider, DEFAULT_SUMMON_MODEL } from "../src/ai";

const vars = new Map<string, string>();
for (const line of readFileSync("../../.env", "utf8").split("\n")) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (match) vars.set(match[1], match[2].replace(/^["']|["']$/g, ""));
}

const apiKey = vars.get("GROQ_API_KEY") ?? "";
const model = vars.get("SUMMON_MODEL") ?? DEFAULT_SUMMON_MODEL;
const provider = createGroqProvider({ apiKey, model });
console.log(`provider: ${provider.name}\n`);

const started = Date.now();
const answer = await provider.complete({
  question: "What did the group just agree on, and who said it?",
  context: [
    { name: "Ada", body: "The relay ships Friday if the admit flow is green." },
    { name: "Bo", body: "Admit is green. I will do the report ticket after." },
    { name: "You", body: "Great, that works for me." },
  ],
});
console.log(`answered in ${Date.now() - started}ms:\n`);
console.log(answer);
