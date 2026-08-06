/**
 * Minimal in-memory token-bucket rate limiter — adequate for a single-
 * instance MVP deployment. Note for scaling: a multi-instance/serverless
 * deployment needs a shared store (e.g. Postgres or Redis) instead of
 * process memory; swap this implementation, keep the call sites the same.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

export function clientIpFrom(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() ?? "unknown";
}
