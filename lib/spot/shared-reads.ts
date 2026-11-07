/**
 * One read layer for the market data the city shows (CITY-208).
 *
 * Why (2026-11-06, `docs/research/city-200-qa/REPORT.md` item 13): the city's
 * first open, a change of the chart's interval, a search and a coin's window
 * answered `429` on `/api/spot/pulse`, `/api/spot/candles`, `/api/spot/token`
 * and `/api/solana/tokens/search`, and people saw an empty chart and an empty
 * search. Ryntra's own per-client window was not the cause (117–118 of 120
 * left); the one Jupiter key's shared window was — the same question asked by
 * several requests at once, each asking the provider itself, and after a
 * refusal every next request asking again into the same spent window.
 *
 * What every read through this layer gets:
 *
 *  1. **Collapsing.** The same key asked while a read of it runs joins that
 *     read: one provider call, however many requests are waiting on it.
 *  2. **A short memory by kind of data.** A read younger than its `ttlMs` is
 *     answered from memory, untouched.
 *  3. **A pause after `429`.** A refusal for rate stops every read of that
 *     provider in this instance for the provider's own pause (`retry-after`,
 *     else the window's reset, else a default), bounded. Inside the pause
 *     nothing is asked: asking a spent window only keeps it spent.
 *  4. **The last good answer, with its own time.** When the provider refused,
 *     failed, or is paused, a read that may be held (`heldMs`, and the caller
 *     allows it) is answered with the last good value, `stale: true` and the
 *     time it was read — never a zero, never a value that was not read. With
 *     nothing held the failure is the answer, with how long to wait.
 *  5. **A failed key waits a moment.** A key whose read just failed is not
 *     asked again for `failureMs`: a source that is down is not asked once per
 *     request.
 *
 * Everything here is one instance's memory. What reduces calls *between*
 * instances is the edge cache of the routes (`CDN-Cache-Control` with
 * `stale-while-revalidate`) and, for the reads that are keyed narrowly
 * enough, the platform's data cache (`lib/stocks/shared-read.ts`); the report
 * of CITY-208 says which read uses which.
 *
 * Reads only. Quotes, orders and swaps never pass through here.
 */

export type ReadProvider = "jupiter" | "geckoterminal";

/** The pause after a refusal for rate when the provider names none. Jupiter's window resets within ~10 s; GeckoTerminal's is a minute. */
export const RATE_PAUSE_DEFAULT_MS: Readonly<Record<ReadProvider, number>> = { jupiter: 3_000, geckoterminal: 15_000 };
/** No pause is shorter: a refusal is not answered by an immediate second ask. */
export const RATE_PAUSE_MIN_MS = 500;
/** No pause is longer: past this the provider is asked again, once, by whoever comes first. */
export const RATE_PAUSE_MAX_MS = 30_000;
/** A key whose read failed is not asked again for this long. */
export const FAILED_KEY_WAIT_MS = 2_000;

const pauses = new Map<ReadProvider, number>();

/** Pause every read of `provider` for its own wait (bounded); a longer pause already running is kept. Returns when the pause ends. */
export function pauseAfterRate(provider: ReadProvider, waitMs: number | null | undefined, now: number = Date.now()): number {
  const wanted = typeof waitMs === "number" && Number.isFinite(waitMs) && waitMs > 0 ? waitMs : RATE_PAUSE_DEFAULT_MS[provider];
  const until = now + Math.min(RATE_PAUSE_MAX_MS, Math.max(RATE_PAUSE_MIN_MS, Math.round(wanted)));
  const current = pauses.get(provider) ?? 0;
  if (until > current) pauses.set(provider, until);
  return Math.max(until, current);
}

/** Milliseconds left of the provider's pause; 0 when it may be asked. */
export function ratePauseLeftMs(provider: ReadProvider, now: number = Date.now()): number {
  const until = pauses.get(provider);
  if (until === undefined) return 0;
  if (now >= until) {
    pauses.delete(provider);
    return 0;
  }
  return until - now;
}

/** Test seam. */
export function resetRatePauses(): void {
  pauses.clear();
}

export type ReadFailure = Readonly<{ ok: false; code: string; reason: string; retryAfterMs?: number | null }>;

/** The answer while the provider is paused and nothing is held: a refusal for rate, with how long to wait. */
export type RatePaused = Readonly<{ ok: false; code: "RATE_LIMITED"; reason: string; retryAfterMs: number }>;

export type HeldRead<T> = Readonly<{
  ok: true;
  value: T;
  /** When the value was read from the provider (epoch ms). */
  readAt: number;
  /** True when this is the last good value served because a fresh read was refused, failed or paused. */
  stale: boolean;
}>;

export type Loaded<T> = Readonly<{ ok: true; value: T; readAt?: number }>;

export type SharedReadsOptions = Readonly<{
  provider: ReadProvider;
  /** A value younger than this is served as it is. */
  ttlMs: number;
  /** A value younger than this may be served, stated stale, when a fresh read cannot be had. 0: never. */
  heldMs: number;
  /** A failed key is not asked again for this long. */
  failureMs?: number;
  /** The most keys kept; the oldest read leaves first. */
  maxKeys?: number;
  /** For the log: what this layer reads. */
  name: string;
}>;

export type SharedReads<T, F extends ReadFailure> = Readonly<{
  /**
   * Read `key`: from memory when fresh, joining a running read, or with
   * `load` — once. `held: false` refuses the held copy (a caller that keeps
   * its own memory and must not take an old value for a new one).
   */
  read: (key: string, load: () => Promise<Loaded<T> | F>, options?: Readonly<{ held?: boolean }>) => Promise<HeldRead<T> | F | RatePaused>;
  /** What memory holds for `key`, without reading. */
  peek: (key: string) => Readonly<{ value: T; readAt: number }> | undefined;
  /** Every held value, oldest read first. */
  entries: () => IterableIterator<[string, Readonly<{ value: T; readAt: number }>]>;
  /** Wait for the reads still running (tests). */
  settled: () => Promise<void>;
  reset: () => void;
}>;

export function rateFailureOf(provider: ReadProvider, leftMs: number): RatePaused {
  const label = provider === "jupiter" ? "Jupiter" : "GeckoTerminal";
  return { ok: false, code: "RATE_LIMITED", reason: `${label} is pausing after a refusal for rate; nothing is held to show yet.`, retryAfterMs: leftMs };
}

export function createSharedReads<T, F extends ReadFailure>(options: SharedReadsOptions): SharedReads<T, F> {
  const store = new Map<string, { value: T; readAt: number }>();
  const failed = new Map<string, { failure: F; at: number }>();
  const inflight = new Map<string, Promise<Loaded<T> | F>>();
  const failureMs = options.failureMs ?? FAILED_KEY_WAIT_MS;
  const maxKeys = options.maxKeys ?? 500;

  const keep = (key: string, value: T, readAt: number) => {
    const held = store.get(key);
    /* A slower read that started earlier does not replace a newer one. */
    if (held && held.readAt > readAt) return;
    store.delete(key);
    store.set(key, { value, readAt });
    while (store.size > maxKeys) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
  };

  const start = (key: string, load: () => Promise<Loaded<T> | F>): Promise<Loaded<T> | F> => {
    const startedAt = Date.now();
    const run = load()
      .catch((failure: unknown) => ({ ok: false, code: "UNREACHABLE", reason: `The ${options.name} read failed: ${failure instanceof Error ? failure.message : String(failure)}` }) as unknown as F)
      .then((result) => {
        if (result.ok) {
          keep(key, result.value, result.readAt ?? startedAt);
          failed.delete(key);
        } else {
          failed.set(key, { failure: result, at: Date.now() });
          if (failed.size > maxKeys) failed.delete(failed.keys().next().value as string);
          if (result.code === "RATE_LIMITED") pauseAfterRate(options.provider, result.retryAfterMs ?? null);
        }
        return result;
      })
      .finally(() => {
        if (inflight.get(key) === run) inflight.delete(key);
      });
    inflight.set(key, run);
    return run;
  };

  async function read(key: string, load: () => Promise<Loaded<T> | F>, readOptions: Readonly<{ held?: boolean }> = {}): Promise<HeldRead<T> | F | RatePaused> {
    const now = Date.now();
    const hit = store.get(key);
    if (hit && now - hit.readAt < options.ttlMs) return { ok: true, value: hit.value, readAt: hit.readAt, stale: false };
    const held = readOptions.held !== false && hit && now - hit.readAt < options.heldMs ? hit : null;
    const asHeld = (h: { value: T; readAt: number }): HeldRead<T> => ({ ok: true, value: h.value, readAt: h.readAt, stale: true });

    let pending = inflight.get(key);
    if (!pending) {
      const paused = ratePauseLeftMs(options.provider, now);
      if (paused > 0) return held ? asHeld(held) : rateFailureOf(options.provider, paused);
      const recent = failed.get(key);
      if (recent && now - recent.at < failureMs) return held ? asHeld(held) : recent.failure;
      pending = start(key, load);
    }
    const result = await pending;
    if (result.ok) {
      const kept = store.get(key);
      return { ok: true, value: result.value, readAt: kept && kept.value === result.value ? kept.readAt : (result.readAt ?? Date.now()), stale: false };
    }
    return held ? asHeld(held) : result;
  }

  return {
    read,
    peek: (key) => store.get(key),
    entries: () => store.entries(),
    settled: async () => {
      await Promise.allSettled([...inflight.values()]);
    },
    reset: () => {
      store.clear();
      failed.clear();
      inflight.clear();
    },
  };
}

/** The `Retry-After` header for a refusal for rate, in whole seconds (at least one); empty when no wait is known. */
export function retryAfterHeader(retryAfterMs: number | null | undefined): Record<string, string> {
  if (typeof retryAfterMs !== "number" || !Number.isFinite(retryAfterMs) || retryAfterMs <= 0) return {};
  return { "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))) };
}
