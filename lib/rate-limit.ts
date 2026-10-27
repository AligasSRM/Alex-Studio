type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;

/** Process-local limiter. This is intentionally not a distributed/global quota. */
export function checkRateLimit(key: string, limit = 10, windowMs = 60_000, now = Date.now()) {
  if (!key || !Number.isInteger(limit) || limit < 1 || !Number.isFinite(windowMs) || windowMs < 1) {
    throw new Error('Invalid rate limit configuration');
  }

  buckets.forEach((bucket, bucketKey) => {
    if (bucket.resetAt <= now) buckets.delete(bucketKey);
  });

  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  if (bucket.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }

  bucket.count += 1;
  if (buckets.size > MAX_BUCKETS) {
    const oldest = buckets.keys().next().value as string | undefined;
    if (oldest) buckets.delete(oldest);
  }
  return { allowed: true, remaining: Math.max(0, limit - bucket.count), resetAt: bucket.resetAt };
}

export function resetRateLimitsForTests() {
  buckets.clear();
}
