/**
 * The market a token watch reads (AI-05) — one read per token for everyone
 * who watches it, never one per rule.
 *
 * - Jupiter Price v3, up to 50 tokens a request: the price and its 24 h change
 *   (the price a person sees across Ryntra);
 * - DexScreener `tokens/v1`, up to 30 tokens a request, keyless: the 5 min and
 *   1 h change of the deepest pool against USDC, USDT or SOL, the hour's and
 *   the day's volume and the depth of those pools (a pool against a fresh
 *   token can print any figure — `dexscreener.ts`), and the depth of each
 *   pool, for a rule that names one.
 *
 * A token keeps a short history of its own reads (`samples`): every read of
 * the last 70 minutes and one an hour back to a day — what a change of
 * liquidity is measured against. Pure: answers in, figures out; the fetch is
 * passed in (`reads.ts`).
 */

import { DEXSCREENER_BASE_URL, parseDexPairs, summariseDexPairs } from "../data/dexscreener.ts";

export const JUPITER_BATCH = 50;
export const DEXSCREENER_BATCH = 30;
export const PRICE_SOURCE = "Jupiter";
export const DEX_SOURCE = "DexScreener";
/** A read older than this decides nothing: the watch says «not read» rather than judge on it. */
export const READ_FRESH_MS = 3 * 60_000;
/** All reads of the last 70 minutes are kept; past that, one an hour, back to 25 hours. */
const DENSE_MS = 70 * 60_000;
const KEEP_MS = 25 * 3_600_000;

export type Windows = Readonly<{ m5: number | null; h1: number | null; h24: number | null }>;

/** One token as the pass read it. Every figure null where its source did not answer or did not state it. */
export type MintRead = Readonly<{
  mint: string;
  symbol: string | null;
  observedAt: string;
  priceUsd: number | null;
  /** Percent; m5 and h1 — DexScreener's deepest major pool; h24 — Jupiter (DexScreener where Jupiter did not state it). */
  changePct: Windows;
  changeSource: Readonly<{ m5: string | null; h1: string | null; h24: string | null }>;
  volumeUsd: Readonly<{ h1: number | null; h24: number | null }>;
  /** The pools against USDC, USDT or SOL, their depth added up. */
  liquidityUsd: number | null;
  /** Each pool's depth by its address, for a rule that names one pool. */
  pools: Readonly<Record<string, number>>;
  /** Which sources answered. */
  jupiter: boolean;
  dex: boolean;
}>;

export type Sample = Readonly<{ at: string; price: number | null; liq: number | null; pools?: Readonly<Record<string, number>> }>;

const num = (value: unknown): number | null => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
};

export function jupiterPriceUrl(base: string, mints: readonly string[]): string {
  return `${base}?ids=${mints.join(",")}`;
}

export function dexTokensUrl(mints: readonly string[]): string {
  return `${DEXSCREENER_BASE_URL}/tokens/v1/solana/${mints.join(",")}`;
}

/** Jupiter Price v3's answer: `{ <mint>: { usdPrice, priceChange24h, … } }`. */
export function parseJupiterPrices(body: unknown): ReadonlyMap<string, Readonly<{ price: number | null; change24h: number | null }>> {
  const out = new Map<string, { price: number | null; change24h: number | null }>();
  if (!body || typeof body !== "object" || Array.isArray(body)) return out;
  for (const [mint, raw] of Object.entries(body as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const price = num(row.usdPrice);
    out.set(mint, { price: price !== null && price > 0 ? price : null, change24h: num(row.priceChange24h) });
  }
  return out;
}

/** One token's read from the two answers (either may be missing). */
export function composeMintRead(input: Readonly<{ mint: string; observedAt: string; jupiter: Readonly<{ price: number | null; change24h: number | null }> | null; jupiterAnswered: boolean; dexBody: unknown; dexAnswered: boolean }>): MintRead {
  const pairs = input.dexAnswered ? parseDexPairs(input.dexBody, input.mint) : [];
  const summary = summariseDexPairs(pairs);
  const top = summary.top;
  const majors = summary.majors;
  const sum = (values: readonly (number | null)[]) => {
    const kept = values.filter((value): value is number => value !== null);
    return kept.length > 0 ? kept.reduce((total, value) => total + value, 0) : null;
  };
  const pools: Record<string, number> = {};
  for (const pair of pairs) if (pair.liquidityUsd !== null) pools[pair.pairAddress] = pair.liquidityUsd;
  const jupiterH24 = input.jupiter?.change24h ?? null;
  const dexH24 = top?.changePct.h24 ?? null;
  return {
    mint: input.mint,
    symbol: top?.baseSymbol && top.baseSymbol !== "?" ? top.baseSymbol : null,
    observedAt: input.observedAt,
    priceUsd: input.jupiter?.price ?? top?.priceUsd ?? null,
    changePct: { m5: top?.changePct.m5 ?? null, h1: top?.changePct.h1 ?? null, h24: jupiterH24 ?? dexH24 },
    changeSource: { m5: top?.changePct.m5 != null ? DEX_SOURCE : null, h1: top?.changePct.h1 != null ? DEX_SOURCE : null, h24: jupiterH24 !== null ? PRICE_SOURCE : dexH24 !== null ? DEX_SOURCE : null },
    volumeUsd: { h1: sum(majors.map((pair) => pair.volumeUsd.h1)), h24: summary.volume24hUsd },
    liquidityUsd: sum(majors.map((pair) => pair.liquidityUsd)),
    pools,
    jupiter: input.jupiterAnswered && input.jupiter !== null,
    dex: input.dexAnswered && pairs.length > 0,
  };
}

/** The history with this read added: dense for the last 70 minutes, hourly back to 25 hours, oldest first. */
export function addSample(samples: readonly Sample[], read: MintRead, nowMs: number, namedPools: readonly string[]): Sample[] {
  const pools: Record<string, number> = {};
  for (const pool of namedPools) if (read.pools[pool] !== undefined) pools[pool] = read.pools[pool];
  const next: Sample = { at: read.observedAt, price: read.priceUsd, liq: read.liquidityUsd, ...(Object.keys(pools).length > 0 ? { pools } : {}) };
  const all = [...samples.filter((row) => row.at !== next.at), next].sort((a, b) => (a.at < b.at ? -1 : 1));
  const kept: Sample[] = [];
  const hours = new Set<string>();
  for (const row of all) {
    const age = nowMs - Date.parse(row.at);
    if (!(age <= KEEP_MS)) continue;
    if (age <= DENSE_MS) {
      kept.push(row);
      continue;
    }
    const hour = row.at.slice(0, 13);
    if (hours.has(hour)) continue;
    hours.add(hour);
    kept.push(row);
  }
  return kept;
}

/**
 * The liquidity `windowMs` ago from the history: the newest read at least that
 * old, and no older than half the window again — a gap in the reads is «not
 * known yet», never a guess.
 */
export function liquidityAgo(samples: readonly Sample[], windowMs: number, nowMs: number, pool: string | null): number | null {
  let found: number | null = null;
  for (const row of samples) {
    const age = nowMs - Date.parse(row.at);
    if (age < windowMs || age > windowMs * 1.5) continue;
    const value = pool ? (row.pools?.[pool] ?? null) : row.liq;
    if (value !== null && value > 0) found = value;
  }
  return found;
}

/** Whether a read is fresh enough to judge on. */
export function readIsFresh(read: MintRead | undefined, nowMs: number): read is MintRead {
  return read !== undefined && nowMs - Date.parse(read.observedAt) <= READ_FRESH_MS;
}
