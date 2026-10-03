// Drives the relay over a real socket: hello -> create -> summon -> ai-answer.
// Usage: pnpm exec tsx scripts/verify-relay.ts
import { readFileSync } from "node:fs";
import { WebSocket } from "ws";
import { signToken, type SignalServerMessage } from "@summon/core";

const vars = new Map<string, string>();
for (const line of readFileSync("../../.env", "utf8").split("\n")) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (match) vars.set(match[1], match[2].replace(/^["']|["']$/g, ""));
}

const secret = vars.get("TOKEN_SECRET") ?? "summon-dev-secret";
const url = `ws://127.0.0.1:${process.env.PORT ?? vars.get("PORT") ?? 8787}`;
const token = await signToken("test-user-1", secret);

const ws = new WebSocket(url);
const seen: string[] = [];

function send(message: unknown) {
  ws.send(JSON.stringify(message));
}

function waitFor(match: (m: SignalServerMessage) => boolean, label: string) {
  return new Promise<SignalServerMessage>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), 30_000);
    const onMessage = (raw: unknown) => {
      const msg = JSON.parse(String(raw)) as SignalServerMessage;
      seen.push(msg.type);
      if (match(msg)) {
        clearTimeout(timer);
        ws.off("message", onMessage);
        resolve(msg);
      }
    };
    ws.on("message", onMessage);
  });
}

ws.on("open", async () => {
  try {
    send({ type: "hello", token, name: "Ada" });
    await waitFor((m) => m.type === "ready", "ready");
    send({ type: "create" });
    const created = await waitFor((m) => m.type === "session-created", "session-created");
    console.log(`session: ${created.sessionId}`);

    send({
      type: "summon",
      sessionId: created.sessionId,
      requestId: "req-1",
      question: "What did we just agree on?",
      context: [
        { name: "Bo", body: "The relay ships Friday." },
        { name: "You", body: "That works for me." },
      ],
    });

    const answer = await waitFor(
      (m) => m.type === "ai-answer" || m.type === "ai-error",
      "ai-answer",
    );

    if (answer.type === "ai-answer") {
      console.log(`requestId echoed: ${answer.requestId === "req-1"}`);
      console.log(`answer: ${answer.answer}`);
    } else {
      console.error(`relay error ${answer.code}: ${answer.message}`);
    }

    const roster = await waitFor((m) => m.type === "roster", "roster").catch(() => null);
    if (roster && roster.type === "roster") {
      const aiOnRoster = roster.members.some((m) => m.id === "summon-ai");
      console.log(`ai on roster: ${aiOnRoster}`);
    }
    console.log(`messages seen: ${seen.join(", ")}`);
    ws.close();
    process.exit(0);
  } catch (cause) {
    console.error(cause);
    console.error(`messages seen: ${seen.join(", ")}`);
    process.exit(1);
  }
});
