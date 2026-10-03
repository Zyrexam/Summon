import {
  createPostgresRateLimitStore,
  createRateLimiter,
  type RateLimiter,
  type RateLimitStore,
} from "@summon/core";
import { getPool } from "@/lib/pg";

const WINDOW_MS = 60_000;

export type RateLimitGuardOptions = {
  /** Behind a proxy, forwarding headers identify the client. */
  trustProxy?: boolean;
  perIpLimit?: number;
  perEmailLimit?: number;
  perIpWindowMs?: number;
  perEmailWindowMs?: number;
  now?: () => number;
  /** Shared counter store. Required once the app runs as several instances. */
  store?: RateLimitStore;
};

export type RateLimitGuard = {
  clientIp: (request: Request) => string;
  isRateLimited: (request: Request, email: string) => Promise<boolean>;
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
    store: options.store,
  });
  const perEmail: RateLimiter = createRateLimiter({
    limit: perEmailLimit,
    windowMs: perEmailWindowMs,
    now,
    store: options.store,
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
    isRateLimited: async (request, email) => {
      // Both buckets are always charged, even when one already refused.
      const [ipOk, emailOk] = await Promise.all([
        perIp.take(`ip:${clientIp(request)}`),
        perEmail.take(`email:${email}`),
      ]);
      return !(ipOk && emailOk);
    },
  };
}

/**
 * Counting happens in Postgres when a database is configured, because a
 * serverless instance keeps nothing between invocations: an in-process Map
 * would start every cold start with an empty budget, which is precisely when
 * an attacker is likely to be hammering the endpoint.
 */
let guard: RateLimitGuard | null = null;

function rateLimitGuard(): RateLimitGuard {
  // Built on first use, so importing this module never needs a database.
  guard ??= createRateLimitGuard({
    trustProxy: process.env.TRUST_PROXY === "true",
    store: process.env.DATABASE_URL
      ? createPostgresRateLimitStore(getPool())
      : undefined,
  });
  return guard;
}

export function clientIp(request: Request): string {
  return rateLimitGuard().clientIp(request);
}

export function isRateLimited(request: Request, email: string): Promise<boolean> {
  return rateLimitGuard().isRateLimited(request, email);
}