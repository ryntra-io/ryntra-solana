export const TRACK_MAX_BODY_BYTES = 2_048;
export const ARCUS_POST_MAX_BODY_BYTES = 32_768;

type Clock = () => number;

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAfterSeconds: number;
  retryAfterSeconds: number;
};

type Bucket = {
  count: number;
  resetAt: number;
};

type LimiterOptions = {
  limit: number;
  windowMs: number;
  maxKeys: number;
  now?: Clock;
};

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive safe integer`);
  }
  return value;
}

/**
 * Best-effort warm-instance limiter. It bounds memory and upstream amplification inside each
 * function instance; Vercel Firewall remains the right global layer when a project rate-limit
 * rule is configured.
 */
export class FixedWindowLimiter {
  readonly limit: number;
  readonly windowMs: number;
  readonly maxKeys: number;
  private readonly now: Clock;
  private readonly buckets = new Map<string, Bucket>();

  constructor(options: LimiterOptions) {
    this.limit = positiveInteger(options.limit, "limit");
    this.windowMs = positiveInteger(options.windowMs, "windowMs");
    this.maxKeys = positiveInteger(options.maxKeys, "maxKeys");
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.buckets.size;
  }

  consume(rawKey: string): RateLimitDecision {
    const now = this.now();
    this.sweepExpired(now);
    const key = rawKey.slice(0, 128) || "unknown";
    let bucket = this.buckets.get(key);

    if (!bucket) {
      this.makeRoom();
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    } else {
      this.buckets.delete(key);
      this.buckets.set(key, bucket);
    }

    const allowed = bucket.count < this.limit;
    if (allowed) bucket.count += 1;
    const resetAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000));
    return {
      allowed,
      limit: this.limit,
      remaining: Math.max(0, this.limit - bucket.count),
      resetAfterSeconds,
      retryAfterSeconds: resetAfterSeconds,
    };
  }

  private sweepExpired(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  private makeRoom(): void {
    while (this.buckets.size >= this.maxKeys) {
      const oldest = this.buckets.keys().next().value as string | undefined;
      if (oldest === undefined) return;
      this.buckets.delete(oldest);
    }
  }
}

type CacheEntry<T> =
  | { state: "pending"; pending: Promise<T> }
  | { state: "ready"; value: T; expiresAt: number };

type CacheOptions = {
  maxEntries: number;
  now?: Clock;
};

/** Bounded in-memory TTL cache with in-flight coalescing and no error caching. */
export class BoundedTtlCache {
  readonly maxEntries: number;
  private readonly now: Clock;
  private readonly entries = new Map<string, CacheEntry<unknown>>();

  constructor(options: CacheOptions) {
    this.maxEntries = positiveInteger(options.maxEntries, "maxEntries");
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  has(key: string): boolean {
    const entry = this.entries.get(key);
    if (!entry) return false;
    if (entry.state === "ready" && entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return false;
    }
    return true;
  }

  async get<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
    positiveInteger(ttlMs, "ttlMs");
    const now = this.now();
    this.sweepExpired(now);
    const existing = this.entries.get(key) as CacheEntry<T> | undefined;

    if (existing?.state === "pending") return existing.pending;
    if (existing?.state === "ready" && existing.expiresAt > now) {
      this.touch(key, existing);
      return existing.value;
    }

    this.makeRoom();
    const pending: Promise<T> = Promise.resolve()
      .then(loader)
      .then((value) => {
        const current = this.entries.get(key) as CacheEntry<T> | undefined;
        if (current?.state === "pending" && current.pending === pending) {
          this.entries.set(key, { state: "ready", value, expiresAt: this.now() + ttlMs });
        }
        return value;
      })
      .catch((error: unknown) => {
        const current = this.entries.get(key) as CacheEntry<T> | undefined;
        if (current?.state === "pending" && current.pending === pending) this.entries.delete(key);
        throw error;
      });

    this.entries.set(key, { state: "pending", pending });
    return pending;
  }

  private sweepExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.state === "ready" && entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  private makeRoom(): void {
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) return;
      this.entries.delete(oldest);
    }
  }

  private touch<T>(key: string, entry: CacheEntry<T>): void {
    this.entries.delete(key);
    this.entries.set(key, entry as CacheEntry<unknown>);
  }
}

export function clientIp(headers: Headers): string {
  const first = (headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  return first.length > 0 && first.length <= 64 && /^[0-9a-f:.]+$/i.test(first) ? first : "unknown";
}

export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  const headers: Record<string, string> = {
    "RateLimit-Limit": String(decision.limit),
    "RateLimit-Remaining": String(decision.remaining),
    "RateLimit-Reset": String(decision.resetAfterSeconds),
  };
  if (!decision.allowed) headers["Retry-After"] = String(decision.retryAfterSeconds);
  return headers;
}

export function publicCacheHeaders(ttlSeconds: number, staleSeconds: number): Record<string, string> {
  const ttl = positiveInteger(ttlSeconds, "ttlSeconds");
  const stale = positiveInteger(staleSeconds, "staleSeconds");
  const cdn = `public, s-maxage=${ttl}, stale-while-revalidate=${stale}`;
  return {
    "Cache-Control": "public, max-age=0, must-revalidate",
    "CDN-Cache-Control": cdn,
    "Vercel-CDN-Cache-Control": cdn,
  };
}

export function privateNoStoreHeaders(): Record<string, string> {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "CDN-Cache-Control": "no-store",
    "Vercel-CDN-Cache-Control": "no-store",
  };
}
