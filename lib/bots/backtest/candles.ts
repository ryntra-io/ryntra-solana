/**
 * Candles for the bots' weather and backtests, from Ryntra's market-data
 * gateway (CH-10): a page of `/v1/history` in the chart core's contract —
 * bars oldest first, prices as decimal strings — turned into numbers for the
 * arithmetic. A pool is the instrument `solana:pool:<address>` the gateway
 * records from the chain's swaps; a perp market is `hyperliquid:<coin>`.
 *
 * Pure and client-safe: the read is in `candles.server.ts`.
 */

/** Floats, for a simulation's arithmetic only — never a sum a transaction is sized from. */
export type Candle = Readonly<{ t: number; o: number; h: number; l: number; c: number }>;

export const BACKTEST_PERIODS = ["7d", "30d", "180d"] as const;
export type BacktestPeriod = (typeof BACKTEST_PERIODS)[number];

/** Each period as one page of the gateway (at most 1 500 bars): hours for a week and a month, four hours for half a year. */
export const PERIOD_PAGE: Readonly<Record<BacktestPeriod, Readonly<{ days: number; resolution: "1h" | "4h"; barMs: number; bars: number }>>> = {
  "7d": { days: 7, resolution: "1h", barMs: 3_600_000, bars: 168 },
  "30d": { days: 30, resolution: "1h", barMs: 3_600_000, bars: 720 },
  "180d": { days: 180, resolution: "4h", barMs: 14_400_000, bars: 1_080 },
};

export function isBacktestPeriod(value: unknown): value is BacktestPeriod {
  return typeof value === "string" && (BACKTEST_PERIODS as readonly string[]).includes(value);
}

const POOL = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The gateway's instrument for a pool. */
export function poolInstrument(pool: string): string | null {
  return POOL.test(pool) ? `solana:pool:${pool}` : null;
}

type PageBar = Readonly<{ t: unknown; o: unknown; h: unknown; l: unknown; c: unknown }>;

const decimal = (value: unknown): number => (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : Number.NaN);

/** A page's bars as numbers, oldest first, one per open; a bar that is not a priced candle is dropped, never guessed. */
export function candlesOf(bars: readonly PageBar[]): Candle[] {
  const out = new Map<number, Candle>();
  for (const bar of bars) {
    const t = typeof bar.t === "number" && Number.isSafeInteger(bar.t) ? bar.t : Number.NaN;
    const o = decimal(bar.o);
    const h = decimal(bar.h);
    const l = decimal(bar.l);
    const c = decimal(bar.c);
    if (!Number.isFinite(t) || ![o, h, l, c].every((v) => Number.isFinite(v) && v > 0)) continue;
    if (h < Math.max(o, c, l) || l > Math.min(o, c, h)) continue;
    out.set(t, { t, o, h, l, c });
  }
  return [...out.values()].sort((a, b) => a.t - b.t);
}

/** The share of a period's bars a page actually holds: a pool with gaps answers less than it was asked. */
export function coverage(candles: readonly Candle[], period: BacktestPeriod): number {
  return Math.min(1, candles.length / PERIOD_PAGE[period].bars);
}
