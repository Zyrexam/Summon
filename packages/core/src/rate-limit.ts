export type RateLimiterOptions = {
  limit: number;
  windowMs: number;
  now?: () => number;
};

export type RateLimiter = {
  take: (key: string) => boolean;
  size: () => number;
};

type Bucket = { count: number; resetAt: number };

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { limit, windowMs } = options;
  const now = options.now ?? Date.now;
  const buckets = new Map<string, Bucket>();

  const evict = (at: number) => {
    if (buckets.size < 1024) return;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= at) buckets.delete(key);
    }
  };

  return {
    take(key) {
      const at = now();
      evict(at);
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= at) {
        buckets.set(key, { count: 1, resetAt: at + windowMs });
        return true;
      }
      if (bucket.count >= limit) return false;
      bucket.count += 1;
      return true;
    },
    size: () => buckets.size,
  };
}
