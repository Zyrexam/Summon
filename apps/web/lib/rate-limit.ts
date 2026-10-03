import { createRateLimiter, type RateLimiter } from "@summon/core";

const WINDOW_MS = 60_000;

export type RateLimitGuardOptions = {
  /** Behind a proxy, forwarding headers identify the client. */
  trustProxy?: boolean;
  perIpLimit?: number;
  perEmailLimit?: number;
  perIpWindowMs?: number;
  perEmailWindowMs?: number;
  now?: () => number;
};

export type RateLimitGuard = {
  clientIp: (request: Request) => string;
  isRateLimited: (request: Request, email: string) => boolean;
};

export function createRateLimitGuard(
  options: RateLimitGuardOptions = {},
): RateLimitGuard {
  const {
    trustProxy = false,
    perIpLimit = trustProxy ? 10 : 60,
    perEmailLimit = 5,
    perIpWindowMs = WINDOW_MS,
    perEmailWindowMs = WINDOW_MS,
    now,
  } = options;
  const perIp: RateLimiter = createRateLimiter({
    limit: perIpLimit,
    windowMs: perIpWindowMs,
    now,
  });
  const perEmail: RateLimiter = createRateLimiter({
    limit: perEmailLimit,
    windowMs: perEmailWindowMs,
    now,
  });

  /**
   * Without a trusted proxy in front, a forwarding header is whatever the
   * client typed, so honouring it would hand every attacker a fresh bucket on
   * each request. Everything from an untrusted socket shares one bucket.
   */
  const clientIp = (request: Request): string => {
    if (!trustProxy) return "direct";
    const forwarded = request.headers.get("x-forwarded-for");
    const first = forwarded?.split(",")[0]?.trim();
    return first || request.headers.get("x-real-ip")?.trim() || "unknown";
  };

  return {
    clientIp,
    // Both buckets are always consumed: short-circuiting on the IP bucket would
    // let a blocked client reset its email allowance for free.
    isRateLimited: (request, email) => {
      const ipOk = perIp.take(`ip:${clientIp(request)}`);
      const emailOk = perEmail.take(`email:${email}`);
      return !(ipOk && emailOk);
    },
  };
}

const guard = createRateLimitGuard({
  trustProxy: process.env.TRUST_PROXY === "true",
});

export function clientIp(request: Request): string {
  return guard.clientIp(request);
}

export function isRateLimited(request: Request, email: string): boolean {
  return guard.isRateLimited(request, email);
}