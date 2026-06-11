/**
 * Tiny in-memory fixed-window rate limiter for the credential-guessing
 * surfaces (login, register, join-by-password). One server, ~15 users: a Map
 * is plenty — no external store, no new dependencies. Uses the logic clock
 * (FAKE_NOW-aware) so tests can drive the window deterministically.
 */
import { nowMs } from '@/lib/clock';
import { AppError } from '@/lib/errors';

interface Bucket {
  count: number;
  resetAt: number; // epoch ms when the window expires
}

const buckets = new Map<string, Bucket>();

/** Keep the map bounded: drop expired buckets once it grows past this. */
const PRUNE_THRESHOLD = 1000;

function prune(now: number): void {
  if (buckets.size < PRUNE_THRESHOLD) return;
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

/**
 * Count one attempt for `key`; throws 429 once more than `limit` attempts
 * land inside a single `windowMs` window.
 */
export function assertRateLimit(key: string, limit: number, windowMs: number): void {
  const now = nowMs();
  prune(now);
  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    throw new AppError('Too many attempts — try again later', 429);
  }
}

/** Forget a key (e.g. after a successful login, so honest mistakes don't accrue). */
export function clearRateLimit(key: string): void {
  buckets.delete(key);
}

/**
 * Best-effort client address for rate-limit keys: first hop of
 * x-forwarded-for when behind a proxy, else a fixed label (single server).
 */
export function clientIp(req: { headers: Headers }): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (!forwarded) return 'local';
  return forwarded.split(',')[0]!.trim() || 'local';
}
