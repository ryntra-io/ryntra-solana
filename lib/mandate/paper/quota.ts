/**
 * Paper's own budget of Jupiter's requests, so the paper week never takes a quote from an agent with money.
 *
 * Jupiter's limit is the organisation's: one 60-second sliding window for every request of the key (skill
 * `jupiter-truth` §3), the live agent's quotes and routes, its exit and a person's swap among them. The
 * window as the provider last stated it is kept in one place, the shared ledger (`../../solana/jupiter-budget.ts`); paper
 * mounts there and changes nothing in it: it reads the window, and it writes back what every one of its own answers said,
 * so the ledger stays current for everyone else too.
 *
 * Paper is the lowest of the background readers. It spends only:
 * - while the shared window is not low for background work at all (`jupiterBackgroundAllowed`);
 * - from the top of the window: while at least half of it is left, as last observed less what paper asked since — the
 *   bottom half is the agents' with money and people's, always;
 * - up to its own share, a fifth of the window per 60 s in this instance (ten asks while the window was never observed);
 * - and not at all for a while after Jupiter refused one of its asks (its reset, or a minute).
 * An ask paper may not make is never sent: the read throws `PaperQuotaSpent`, and the pass or the start that asked stops
 * there and leaves the rest for later (`./service.server.ts`). Nothing waits, nothing retries.
 *
 * Quotes of the same coins for the same amount within a minute are asked once (`createPaperQuoteCache`): paper agents
 * on the same coin and budget, a start and its first pass. The table's facts of a coin are kept ten minutes.
 */

import { jupiterBudget, jupiterRetryWaitMs, noteJupiterResponse, type JupiterBudget } from "../../solana/jupiter-budget.ts";

export const PAPER_QUOTA = Object.freeze({
  /** Paper's share of the key's window, per `windowMs`, in each instance. */
  share: 0.2,
  /** Paper spends only while at least this share of the window is left: the rest belongs to money. */
  floor: 0.5,
  /** Asks per `windowMs` while the window has never been observed in this instance. */
  blind: 10,
  windowMs: 60_000,
  /** How long paper stands down after Jupiter refused one of its asks and named no nearer reset. */
  coolMs: 60_000,
  /** An observation of the window older than this says nothing about the window now. */
  freshMs: 60_000,
});

/** The most asks one paper agent's pass makes: a dip's or a grid's mark, the holding's worth, the buy, the worth after. */
export const PAPER_STEP_COST = 4;
/** The most asks a start makes: the table's facts, the first buy's quote, and its first pass (whose buy is the same quote). */
export const PAPER_START_COST = 4;

/** Paper's share of Jupiter is spent for now: nothing was asked. */
export class PaperQuotaSpent extends Error {
  constructor() {
    super("paper's share of Jupiter is spent for now");
    this.name = "PaperQuotaSpent";
  }
}

export type PaperQuota = Readonly<{
  /** How many asks paper may make now. */
  room(now?: number): number;
  /** One ask, counted when paper may make it; false — it may not, and the refusal is counted. */
  take(now?: number): boolean;
  /** What Jupiter answered one of paper's asks: the shared ledger hears it; a refusal stands paper down. */
  note(headers: Headers, status: number, now?: number): void;
  /** How many asks paper was refused so far: a pass or a start compares it before and after. */
  refusals(): number;
}>;

export type PaperQuotaDeps = Readonly<{
  now?: () => number;
  /** The shared window as last observed; the shared ledger's own when not handed in. */
  budget?: (now: number) => JupiterBudget;
  /** Tell the shared ledger what an answer said; the shared ledger's own when not handed in. */
  note?: (headers: Headers, now: number) => void;
}>;

/** Paper's budget in this instance. The deployment keeps one (`./wire.server.ts`); a test makes its own. */
export function createPaperQuota(deps: PaperQuotaDeps = {}): PaperQuota {
  const clock = deps.now ?? Date.now;
  const read = deps.budget ?? ((now: number) => jupiterBudget("shared", now));
  const tell = deps.note ?? ((headers: Headers, now: number) => noteJupiterResponse(headers, "shared", { now: () => now }));
  let asks: number[] = [];
  let cooledUntil = 0;
  let refused = 0;

  function room(now: number = clock()): number {
    if (now < cooledUntil) return 0;
    asks = asks.filter((at) => at > now - PAPER_QUOTA.windowMs);
    const window = read(now);
    if (window.low) return 0;
    const own = (window.limit === null ? PAPER_QUOTA.blind : Math.max(1, Math.floor(window.limit * PAPER_QUOTA.share))) - asks.length;
    const fresh = window.observedAt !== null && window.remaining !== null && window.limit !== null && now - window.observedAt < PAPER_QUOTA.freshMs && (window.resetAt === null || now < window.resetAt);
    if (!fresh) return Math.max(0, own);
    /* The top of the window only: what was left when last observed, less paper's own asks since, above money's half. */
    const since = asks.filter((at) => at >= window.observedAt!).length;
    const top = window.remaining! - since - Math.ceil(window.limit! * PAPER_QUOTA.floor);
    return Math.max(0, Math.min(own, top));
  }

  return {
    room,
    take(now: number = clock()) {
      if (room(now) < 1) {
        refused += 1;
        return false;
      }
      asks.push(now);
      return true;
    },
    note(headers, status, now: number = clock()) {
      tell(headers, now);
      if (status === 429) cooledUntil = Math.max(cooledUntil, now + (jupiterRetryWaitMs(headers, now, PAPER_QUOTA.coolMs) ?? PAPER_QUOTA.coolMs));
    },
    refusals: () => refused,
  };
}

/** A fetch that asks Jupiter only within paper's budget, and tells the budget every answer. */
export function paperFetch(quota: PaperQuota, base?: typeof fetch): typeof fetch {
  const ask = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
    if (!quota.take()) throw new PaperQuotaSpent();
    const response = await (base ?? fetch)(input, init);
    quota.note(response.headers, response.status);
    return response;
  };
  return ask as typeof fetch;
}

/** A quote is the price now for a minute. */
export const PAPER_QUOTE_TTL_MS = 60_000;
/** The table's facts of a coin change rarely. */
export const PAPER_FACTS_TTL_MS = 10 * 60_000;
const CACHE_MAX = 2_000;

export type PaperQuoteCache = Readonly<{
  /** The answer kept under `key` for `ttlMs`, or the one being asked; a failure is never kept. */
  get<T>(key: string, ttlMs: number, ask: () => Promise<T>): Promise<T>;
  size(): number;
}>;

/** Quotes and facts kept briefly in this instance: the same question within its time is asked of Jupiter once. */
export function createPaperQuoteCache(deps: Readonly<{ now?: () => number; max?: number }> = {}): PaperQuoteCache {
  const clock = deps.now ?? Date.now;
  const max = deps.max ?? CACHE_MAX;
  const kept = new Map<string, { at: number; ttlMs: number; value: Promise<unknown> }>();
  return {
    get<T>(key: string, ttlMs: number, ask: () => Promise<T>): Promise<T> {
      const now = clock();
      const was = kept.get(key);
      if (was && now - was.at < was.ttlMs) return was.value as Promise<T>;
      if (was) kept.delete(key);
      while (kept.size >= max) kept.delete(kept.keys().next().value as string);
      const value = ask();
      kept.set(key, { at: now, ttlMs, value });
      value.catch(() => {
        if (kept.get(key)?.value === value) kept.delete(key);
      });
      return value;
    },
    size: () => kept.size,
  };
}
