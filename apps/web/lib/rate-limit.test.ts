import { describe, expect, it } from "vitest";
import { createRateLimitGuard } from "./rate-limit";

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/auth/login", { headers });
}

describe("client identity", () => {
  it("ignores forwarding headers unless a proxy is trusted", () => {
    const guard = createRateLimitGuard();
    const spoofed = request({ "x-forwarded-for": "10.0.0.1" });
    expect(guard.clientIp(spoofed)).toBe("direct");
  });

  it("honours forwarding headers behind a trusted proxy", () => {
    const guard = createRateLimitGuard({ trustProxy: true });
    expect(
      guard.clientIp(request({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })),
    ).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip behind a trusted proxy", () => {
    const guard = createRateLimitGuard({ trustProxy: true });
    expect(guard.clientIp(request({ "x-real-ip": "198.51.100.4" }))).toBe(
      "198.51.100.4",
    );
  });

  it("buckets an unknown client rather than trusting nothing", () => {
    const guard = createRateLimitGuard({ trustProxy: true });
    expect(guard.clientIp(request())).toBe("unknown");
  });
});

describe("limiting", () => {
  it("stops rotating x-forwarded-for from resetting the bucket", () => {
    const guard = createRateLimitGuard({ perIpLimit: 3 });
    const attempts = Array.from({ length: 6 }, (_, index) =>
      guard.isRateLimited(
        request({ "x-forwarded-for": `10.0.0.${index}` }),
        "ada@example.com",
      ),
    );
    expect(attempts.slice(0, 3)).toEqual([false, false, false]);
    expect(attempts.slice(3)).toEqual([true, true, true]);
  });

  it("still limits a single email when the client rotates", () => {
    const guard = createRateLimitGuard({ perEmailLimit: 3, perIpLimit: 100 });
    const attempts = Array.from({ length: 6 }, (_, index) =>
      guard.isRateLimited(
        request({ "x-forwarded-for": `10.0.0.${index}` }),
        "ada@example.com",
      ),
    );
    expect(attempts.filter(Boolean)).toHaveLength(3);
  });

  it("counts the email bucket even when the IP bucket is already spent", () => {
    let clock = 0;
    const guard = createRateLimitGuard({
      perIpLimit: 1,
      perIpWindowMs: 5_000,
      perEmailLimit: 1,
      perEmailWindowMs: 60_000,
      now: () => clock,
    });
    expect(guard.isRateLimited(request(), "a@example.com")).toBe(false);
    // Rejected on the IP bucket, but the email bucket must still be charged:
    // once the short IP window lapses this client gets no free email attempt.
    expect(guard.isRateLimited(request(), "b@example.com")).toBe(true);
    clock += 5_001;
    expect(guard.isRateLimited(request(), "b@example.com")).toBe(true);
  });

  it("keeps separate clients and separate emails independent", () => {
    const guard = createRateLimitGuard({ trustProxy: true, perEmailLimit: 1 });
    expect(
      guard.isRateLimited(request({ "x-forwarded-for": "203.0.113.1" }), "a@b.c"),
    ).toBe(false);
    expect(
      guard.isRateLimited(request({ "x-forwarded-for": "203.0.113.2" }), "a@b.c"),
    ).toBe(true);
    expect(
      guard.isRateLimited(request({ "x-forwarded-for": "203.0.113.2" }), "x@y.z"),
    ).toBe(false);
  });

  it("lets attempts through again once the window passes", () => {
    let clock = 0;
    const guard = createRateLimitGuard({ perEmailLimit: 1, now: () => clock });
    expect(guard.isRateLimited(request(), "a@example.com")).toBe(false);
    expect(guard.isRateLimited(request(), "a@example.com")).toBe(true);
    clock += 60_001;
    expect(guard.isRateLimited(request(), "a@example.com")).toBe(false);
  });
});