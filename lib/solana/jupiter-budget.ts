/**
 * The Jupiter rate budget, as the provider states it.
 *
 * Every keyed Jupiter response carries `x-ratelimit-current`,
 * `x-ratelimit-remaining` and `x-ratelimit-reset` (epoch seconds) for the
 * organisation's 60-second sliding window; `/swap/v2/execute` has a bucket of
 * its own. The key's tier is never known to the code — the headers are, and
 * they are the only honest budget: whatever the plan says, the window is what
 * the last answer said it was.
 *
 * This ledger is per instance and observational. It never blocks a person's
 * own request — a quote, an order, the market they are looking at — because
 * refusing those to protect a budget would be the outage it tries to prevent.
 * It decides one thing: whether **background** work — a list refresh, a
 * universe rebuild, a header poll that already has a recent answer — may
 * spend the window now, or must wait for the reset and serve what it has,
 * stated as stale. A rebuild that runs into an exhausted window is refused by
 * the provider; a rebuild that is not started spends nothing.
 *
 * Measured on 2026-09-15: bursts of automated reads exhausted the window and
 * the person-facing quote then answered 503 while three background rebuilds
 * were refused in the same minute. Nothing here retries anything; the callers
 * that may ask once more do so with the provider's own pause, bounded.
 */

export type JupiterBucket = "shared" | "execute";

export type JupiterBudget = Readonly<{
  /** The window's size as last observed: current + remaining. */
  limit: number | null;
  remaining: number | null;
  /** Epoch milliseconds when the observed window resets; null when unknown. */
  resetAt: number | null;
  observedAt: number | null;
  /** True while the observed window is nearly spent and has not reset. */
  low: boolean;
}>;

type Ledger = { limit: number | null; remaining: number | null; resetAt: number | null; observedAt: number | null; warnedFor: number | null };

const ledgers: Record<JupiterBucket, Ledger> = {
  shared: { limit: null, remaining: null, resetAt: null, observedAt: null, warnedFor: null },
  execute: { limit: null, remaining: null, resetAt: null, observedAt: null, warnedFor: null },
};

/** The share of the window kept for people: background work stops below it. */
export const JUPITER_RESERVE_SHARE = 0.25;
/** Never fewer than this many requests are kept back, however small the window. */
export const JUPITER_RESERVE_MIN = 3;
/** A bounded pause: a caller may wait this long for the window, never longer. */
export const JUPITER_RETRY_WAIT_MAX_MS = 2_500;
/**
 * The pause a person's own signable order may wait for the window: the key's
 * window resets within about ten seconds (observed 2026-09-15 … 09-28, «reset
 * in 0–9 s»), and the person is waiting on this one press — a $1 purchase on
 * 2026-09-28 was refused with the reset 4 s away, past the 2.5 s a read waits.
 */
export const JUPITER_ORDER_RETRY_WAIT_MAX_MS = 10_000;
/** An observation older than this says nothing about the current window. */
const OBSERVATION_MAX_AGE_MS = 90_000;

function integerHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null) return null;
  const value = Number(raw.trim());
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** The provider's rate headers, or null for each one it did not send. */
export function readJupiterRateHeaders(headers: Headers): Readonly<{ current: number | null; remaining: number | null; resetAt: number | null; retryAfterMs: number | null }> {
  const resetSeconds = integerHeader(headers, "x-ratelimit-reset");
  const retryAfter = Number(headers.get("retry-after") ?? "");
  return {
    current: integerHeader(headers, "x-ratelimit-current"),
    remaining: integerHeader(headers, "x-ratelimit-remaining"),
    resetAt: resetSeconds === null ? null : resetSeconds * 1_000,
    retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.round(retryAfter * 1_000) : null,
  };
}

export function jupiterReserve(limit: number | null): number {
  if (limit === null) return JUPITER_RESERVE_MIN;
  return Math.max(JUPITER_RESERVE_MIN, Math.ceil(limit * JUPITER_RESERVE_SHARE));
}

/**
 * Record what the provider said about the window. Called after every Jupiter
 * response, success or refusal; a response without the headers changes
 * nothing.
 */
export function noteJupiterResponse(
  headers: Headers,
  bucket: JupiterBucket = "shared",
  deps: Readonly<{ now?: () => number; warn?: (message: string) => void }> = {},
): void {
  const read = readJupiterRateHeaders(headers);
  if (read.remaining === null) return;
  const now = (deps.now ?? Date.now)();
  const ledger = ledgers[bucket];
  const limit = read.current === null ? ledger.limit : read.current + read.remaining;
  ledger.limit = limit === null ? null : Math.max(limit, ledger.limit ?? 0);
  ledger.remaining = read.remaining;
  ledger.resetAt = read.resetAt ?? ledger.resetAt;
  ledger.observedAt = now;
  const budget = jupiterBudget(bucket, now);
  if (budget.low && ledger.warnedFor !== ledger.resetAt) {
    ledger.warnedFor = ledger.resetAt;
    const resetIn = ledger.resetAt === null ? "unknown" : `${Math.max(0, Math.round((ledger.resetAt - now) / 1000))} s`;
    (deps.warn ?? ((message: string) => console.warn(message)))(
      `jupiter budget low (${bucket}): ${budget.remaining} of ${budget.limit ?? "?"} left in the window, reset in ${resetIn}; background reads wait`,
    );
  }
}

/** The observed window for one bucket. Stale observations and passed resets read as unknown, never as low. */
export function jupiterBudget(bucket: JupiterBucket = "shared", now: number = Date.now()): JupiterBudget {
  const ledger = ledgers[bucket];
  if (ledger.observedAt === null || ledger.remaining === null) return { limit: ledger.limit, remaining: null, resetAt: null, observedAt: ledger.observedAt, low: false };
  const observationFresh = now - ledger.observedAt < OBSERVATION_MAX_AGE_MS;
  const windowOpen = ledger.resetAt === null ? observationFresh : now < ledger.resetAt;
  const low = observationFresh && windowOpen && ledger.remaining < jupiterReserve(ledger.limit);
  return { limit: ledger.limit, remaining: ledger.remaining, resetAt: ledger.resetAt, observedAt: ledger.observedAt, low };
}

/** Whether background work may spend the shared window now. */
export function jupiterBackgroundAllowed(now: number = Date.now()): boolean {
  return !jupiterBudget("shared", now).low;
}

/**
 * How long a caller that may ask once more should wait: the provider's
 * `retry-after`, else the time to the window's reset — and null when that is
 * longer than the bounded maximum (a read's 2.5 s unless the caller names
 * its own), which means "do not wait, answer honestly".
 */
export function jupiterRetryWaitMs(headers: Headers, now: number = Date.now(), maxMs: number = JUPITER_RETRY_WAIT_MAX_MS): number | null {
  const read = readJupiterRateHeaders(headers);
  const candidates: number[] = [];
  if (read.retryAfterMs !== null) candidates.push(read.retryAfterMs);
  if (read.resetAt !== null) candidates.push(Math.max(0, read.resetAt - now));
  if (candidates.length === 0) return null;
  const wait = Math.min(...candidates);
  return wait <= maxMs ? wait : null;
}

export function resetJupiterBudget(): void {
  for (const bucket of Object.keys(ledgers) as JupiterBucket[]) {
    ledgers[bucket] = { limit: null, remaining: null, resetAt: null, observedAt: null, warnedFor: null };
  }
}
