/**
 * Liquidity context for a tokenized stock — the normalized model.
 *
 * A stock token is a claim on something; where it *trades* is a separate
 * fact, and one a person needs before a plan: which pools hold it, how much
 * sits there, what moved through in the last day, what the venue charges.
 * This module names those facts in Ryntra's words so no venue's response
 * shape reaches the stock UI.
 *
 * Every figure is the venue's own, in the venue's own unit — TVL, a 24-hour
 * volume, a 24-hour fee total, a fee rate — carried with the time it was
 * read. Nothing here derives a yield, an expected return or a "score": a
 * venue that publishes an APR publishes a marketing number over a window it
 * chose, and Ryntra does not repeat it.
 *
 * **Association is by mint and by side.** A pool is listed for a stock only
 * when one of its two tokens *is* the stock's verified mint; the model
 * records which side that is, so the other token in the pair — a stablecoin,
 * SOL, another stock, or a memecoin priced in the stock — is never read as
 * the stock itself. `NVDAx-SOL` and `GPUCAT-NVDAx` both contain NVDAx; only
 * the first is a place to buy NVDAx with money.
 *
 * **The dust line and the ranking, from the data read on 2026-09-21**
 * (`docs/research/meteora-dbc-spike-2026-09-21/`): the venue's test pools sit
 * at $0–715 TVL and the real stock pools at $1.4k–$4.7M, so a pool is
 * *meaningful* from $1,000 TVL. Pools rank by TVL, then by 24 h volume. The
 * *primary* pool — the one the summary leads with — is the deepest meaningful
 * pool whose other token is money (USDC, USDT, PYUSD, USDS, wrapped SOL); a
 * pool paired with another confirmed stock token leads only when no money pool
 * holds $1,000, because TVL alone ranked `SPYx-GMEx` ($7.6k, $3 traded a day)
 * above `SPYx-SOL` ($5.9k, $16k a day) on 2026-09-23 and the S&P 500 page read
 * as a dead market. A memecoin pool quoted in the stock, however deep, is
 * listed but never primary, because it is a place to buy the memecoin, not the
 * stock.
 *
 * Pure and client-safe; the venue clients and the reader are server-side.
 */

export const LIQUIDITY_PROVIDER = "meteora" as const;
export type LiquidityProvider = typeof LIQUIDITY_PROVIDER;

/** Meteora's two pool programs the Data APIs index. DBC (a launch curve) is deliberately absent: no tokenized stock trades on one. */
export const LIQUIDITY_POOL_KINDS = ["dlmm", "damm-v2"] as const;
export type LiquidityPoolKind = (typeof LIQUIDITY_POOL_KINDS)[number];

export const POOL_KIND_LABEL: Readonly<Record<LiquidityPoolKind, string>> = { dlmm: "DLMM", "damm-v2": "DAMM v2" };

/** The other token in a pair, classified — the classification decides only what may lead the summary. */
export type CounterKind = "stablecoin" | "sol" | "stock" | "other";

export type PoolToken = Readonly<{
  mint: string;
  symbol: string;
  name: string;
  decimals: number | null;
}>;

export type LiquidityPool = Readonly<{
  provider: LiquidityProvider;
  kind: LiquidityPoolKind;
  /** The pool's own address on Solana. */
  address: string;
  /** The pair as the venue names it, e.g. `OPENAI-USDC`. */
  name: string;
  /** Which of the venue's two slots holds the stock: `x` or `y`. */
  stockSide: "x" | "y";
  /** The stock token as the venue lists it — its `mint` is the verified mint the pool was asked for. */
  stock: PoolToken;
  /** The other token in the pair. */
  counter: PoolToken;
  counterKind: CounterKind;
  /** Total value the pool holds, both sides, USD, as the venue states it. */
  tvlUsd: number | null;
  /** Traded through the pool in the venue's rolling 24 hours, USD. */
  volume24hUsd: number | null;
  /** Fees the pool earned in the venue's rolling 24 hours, USD; null when the venue does not state them. */
  fees24hUsd: number | null;
  /** The venue's base fee rate for a trade, in percent (0.01 = 0.01 %). */
  baseFeePct: number | null;
  /** DLMM's current rate — the base fee plus the variable part — in percent; null where the venue states none. */
  dynamicFeePct: number | null;
  /** How much of the stock token the pool holds, in the token's own unit as the venue shows it. */
  stockAmount: number | null;
  /** How much of the other token the pool holds. */
  counterAmount: number | null;
  /** When the venue created the pool, ISO; null when not stated. */
  createdAt: string | null;
  /** The venue's own blacklist flag, carried as read. */
  blacklisted: boolean;
  /** The venue's tag for the launchpad that made the pool, when it names one. */
  launchpad: string | null;
  source: Readonly<{
    /** The Data API resource this record came from. */
    api: string;
    /** The venue's own page for the pool. */
    page: string;
  }>;
}>;

export const MEANINGFUL_TVL_USD = 1_000;
/** Below this a pool is empty for any purpose and is counted, not listed — most of the venue's test pools hold nothing at all. */
export const LISTED_TVL_USD = 1;
export const SUMMARY_POOL_LIMIT = 3;

export function isMeaningful(pool: LiquidityPool): boolean {
  return (pool.tvlUsd ?? 0) >= MEANINGFUL_TVL_USD && !pool.blacklisted;
}

/** Money — a stablecoin or SOL: what a person buys the stock with, and what a primary pool is paired with first. */
export function isMoneyLike(kind: CounterKind): boolean {
  return kind === "stablecoin" || kind === "sol";
}

/** Money or a confirmed stock: the pairs in which a person can buy the stock at all. */
export function isMoneyLikeOrStock(kind: CounterKind): boolean {
  return isMoneyLike(kind) || kind === "stock";
}

const value = (n: number | null): number => (n === null || !Number.isFinite(n) ? -1 : n);

/** By TVL, then by 24 h volume, then by address so the order is stable. */
export function rankPools(pools: readonly LiquidityPool[]): LiquidityPool[] {
  return [...pools].sort((a, b) => value(b.tvlUsd) - value(a.tvlUsd) || value(b.volume24hUsd) - value(a.volume24hUsd) || a.address.localeCompare(b.address));
}

/**
 * The pool the summary leads with, from a ranked list: the deepest meaningful
 * pool paired with money; failing that, the deepest meaningful pool paired with
 * another stock; null when neither exists — a memecoin pair never leads.
 */
export function primaryOf(ranked: readonly LiquidityPool[]): LiquidityPool | null {
  const meaningful = ranked.filter(isMeaningful);
  return meaningful.find((pool) => isMoneyLike(pool.counterKind)) ?? meaningful.find((pool) => pool.counterKind === "stock") ?? null;
}

const STABLECOIN_MINTS: ReadonlyMap<string, string> = new Map([
  ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", "USDC"],
  ["Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", "USDT"],
  ["2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo", "PYUSD"],
  ["USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA", "USDS"],
]);
const WRAPPED_SOL = "So11111111111111111111111111111111111111112";

/** Classify the other token of a pair. `stockMints` are the confirmed stock representations, so a stock–stock pool is known as one — never as a memecoin pair. */
export function counterKindOf(mint: string, stockMints: ReadonlySet<string>): CounterKind {
  if (STABLECOIN_MINTS.has(mint)) return "stablecoin";
  if (mint === WRAPPED_SOL) return "sol";
  if (stockMints.has(mint)) return "stock";
  return "other";
}

/** How one venue source answered. */
export type LiquiditySourceState = Readonly<{
  ok: boolean;
  /** Served from the last complete copy under the grace period. */
  stale: boolean;
  fetchedAt: string | null;
  reason: string | null;
}>;

/**
 * `current`: every source answered fresh. `stale`: at least one served its
 * grace copy. `partial`: one source answered and the other did not — the
 * pools listed are real, the list may be short. `unavailable`: nothing
 * answered; the page says so and shows no figure.
 */
export type LiquidityState = "current" | "stale" | "partial" | "unavailable";

export type StockLiquidity = Readonly<{
  provider: LiquidityProvider;
  mint: string;
  state: LiquidityState;
  /** Every pool that contains the mint, ranked. */
  pools: readonly LiquidityPool[];
  primary: LiquidityPool | null;
  meaningfulCount: number;
  dustCount: number;
  /** Sums of the venue's figures over the meaningful pools — a total of listed pools, not a market-wide figure. */
  totals: Readonly<{ tvlUsd: number | null; volume24hUsd: number | null; fees24hUsd: number | null }>;
  sources: Readonly<Record<LiquidityPoolKind, LiquiditySourceState>>;
  /** The latest time any source answered fresh, or the time of the grace copy. */
  fetchedAt: string | null;
}>;

function sum(pools: readonly LiquidityPool[], pick: (pool: LiquidityPool) => number | null): number | null {
  let total = 0;
  let seen = false;
  for (const pool of pools) {
    const figure = pick(pool);
    if (figure === null || !Number.isFinite(figure)) continue;
    total += figure;
    seen = true;
  }
  return seen ? total : null;
}

/** Assemble the read from the two sources; pure, so the tests and the reader share it. */
export function assembleStockLiquidity(input: Readonly<{ mint: string; pools: readonly LiquidityPool[]; sources: Readonly<Record<LiquidityPoolKind, LiquiditySourceState>> }>): StockLiquidity {
  const ranked = rankPools(input.pools.filter((pool) => pool.stock.mint === input.mint));
  const meaningful = ranked.filter(isMeaningful);
  const states = Object.values(input.sources);
  const answered = states.filter((s) => s.ok);
  const state: LiquidityState = answered.length === 0 ? "unavailable" : answered.length < states.length ? "partial" : answered.some((s) => s.stale) ? "stale" : "current";
  const fetchedAt = answered.map((s) => s.fetchedAt).filter((t): t is string => t !== null).sort().at(-1) ?? null;
  return {
    provider: LIQUIDITY_PROVIDER,
    mint: input.mint,
    state,
    pools: ranked,
    primary: primaryOf(ranked),
    meaningfulCount: meaningful.length,
    dustCount: ranked.length - meaningful.length,
    totals: {
      tvlUsd: sum(meaningful, (pool) => pool.tvlUsd),
      volume24hUsd: sum(meaningful, (pool) => pool.volume24hUsd),
      fees24hUsd: sum(meaningful, (pool) => pool.fees24hUsd),
    },
    sources: input.sources,
    fetchedAt,
  };
}
