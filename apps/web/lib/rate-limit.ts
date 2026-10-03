import { createRateLimiter } from "@summon/core";

const LIMIT = 10;
const WINDOW_MS = 60_000;

const perIp = createRateLimiter({ limit: LIMIT, windowMs: WINDOW_MS });
const perEmail = createRateLimiter({ limit: 5, windowMs: WINDOW_MS });

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export function isRateLimited(request: Request, email: string): boolean {
  return !perIp.take(`ip:${clientIp(request)}`) || !perEmail.take(`email:${email}`);
}
