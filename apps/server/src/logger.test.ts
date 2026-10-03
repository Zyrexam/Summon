import { describe, expect, it } from "vitest";
import { createLogger } from "./logger";

function collecting() {
  const lines: string[] = [];
  const logger = createLogger({
    sink: (line) => lines.push(line),
    now: () => 1_700_000_000_000,
  });
  return { logger, lines };
}

describe("structured logs", () => {
  it("emits one JSON object per line", () => {
    const { logger, lines } = collecting();
    logger.warn("knock_denied", { sessionId: "s-1", visitorId: "u-2" });
    expect(lines).toHaveLength(1);
    expect(lines[0].includes("\n")).toBe(false);
    expect(JSON.parse(lines[0])).toEqual({
      ts: "2023-11-14T22:13:20.000Z",
      level: "warn",
      event: "knock_denied",
      sessionId: "s-1",
      visitorId: "u-2",
    });
  });

  it("defaults to info and supports error", () => {
    const { logger, lines } = collecting();
    logger.info("session_created", { sessionId: "s-1" });
    logger.error("relay_failed", { reason: "boom" });
    expect(JSON.parse(lines[0]).level).toBe("info");
    expect(JSON.parse(lines[1]).level).toBe("error");
  });

  it("never lets a secret reach the sink", () => {
    const { logger, lines } = collecting();
    logger.warn("auth_failed", {
      token: "user-1.deadbeef",
      password: "hunter2",
      key: "k",
      authorization: "Bearer abc",
    });
    const line = lines[0];
    for (const secret of ["deadbeef", "hunter2", "\"k\"", "Bearer abc"]) {
      expect(line).not.toContain(secret);
    }
    expect(JSON.parse(line).token).toBe("[redacted]");
  });

  it("keeps identifying fields that are safe to log", () => {
    const { logger, lines } = collecting();
    logger.warn("auth_failed", { userId: "u-1", sessionId: "s-1", code: "bad-token" });
    expect(JSON.parse(lines[0])).toMatchObject({
      userId: "u-1",
      sessionId: "s-1",
      code: "bad-token",
    });
  });

  it("survives a field that cannot be serialised", () => {
    const { logger, lines } = collecting();
    logger.info("weird", { error: new Error("nope") as unknown as string });
    expect(JSON.parse(lines[0]).event).toBe("weird");
  });

  it("keeps event names greppable", () => {
    const { logger, lines } = collecting();
    logger.info("session_ended", { sessionId: "s-1" });
    expect(lines[0]).toContain('"event":"session_ended"');
  });
});