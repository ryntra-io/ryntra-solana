/**
 * The landing's market tape: eight markets that trade on
 * Solana — SOL, Bitcoin and Ether as Solana tokens, Jupiter, and four companies and the S&P 500 fund as xStocks —
 * each with its price, its change over a day and a day of hourly closes drawn by the core's sparkline
 * (`@ryntra/core/chart/compact`). It replaced TradingView's Ticker Tape: Ryntra draws no chart of anyone else's.
 *
 * Whose numbers: the price and the day's change are Jupiter's (the catalogue every route is quoted against), the
 * line is GeckoTerminal's hourly OHLCV of the market's deepest pool — the same two sources a spot page names.
 *
 * Pure: the reads live in `tape.server.ts`, the route in `app/api/spot/tape`.
 */
import type { DataStatus } from "@ryntra/core/adapters";

/** A candle as the chart source reads it: its open in unix seconds and its close. */
type Candle = Readonly<{ time: number; close: number }>;

/** The markets, in the tape's order — the order TradingView's tape had them in, as the tokens that trade here. */
export const TAPE_MARKETS = [
  { mint: "So11111111111111111111111111111111111111112", symbol: "SOL" },
  { mint: "cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij", symbol: "cbBTC" },
  { mint: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", symbol: "ETH" },
  { mint: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP" },
  { mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", symbol: "AAPLx" },
  { mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", symbol: "NVDAx" },
  { mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", symbol: "TSLAx" },
  { mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", symbol: "SPYx" },
] as const;

/** A day of hourly closes. */
export const TAPE_HOURS = 24;

/** How long a read of the tape is kept — by the server and at the edge: the line is hourly, the price a minute's. */
export const TAPE_TTL_MS = 120_000;

/**
 * How long a read with a line missing is kept: the chart source's minute budget is shared with the charts people have
 * open and the tape asks only for what is left, so a cold read fills in over a few reads instead of in one burst.
 */
export const TAPE_PARTIAL_TTL_MS = 20_000;

/** A sparkline's point: ms UTC and the price as a decimal string (the core's `SeriesPoint`). */
export type TapePoint = Readonly<{ t: number; v: string | null }>;

export type TapeRow = Readonly<{
  mint: string;
  symbol: string;
  /** Through Ryntra's own icon route — the landing's policy loads images from itself only. */
  icon: string | null;
  price: number | null;
  /** Percent over a day, Jupiter's. */
  change24hPct: number | null;
  /** Oldest first; empty when the market's chart source had nothing to give. */
  points: readonly TapePoint[];
}>;

export type TapeRead = Readonly<{
  rows: readonly TapeRow[];
  /** When the prices were read (ISO). */
  observedAt: string;
  /** When the oldest of the lines was read (ISO); null when no line came. */
  linesAt: string | null;
  /** The last good read is shown: a source did not answer this time. */
  stale: boolean;
  /** Every market has its line; false while some are still to come (`TAPE_PARTIAL_TTL_MS`). */
  complete: boolean;
}>;

/** A price as a decimal string with no exponent, to the digits it needs: $81,858.06 → "81858.06", $0.00002 → "0.00002". */
export function priceText(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  const decimals = value >= 1_000 ? 2 : value >= 1 ? 4 : Math.min(12, 2 - Math.floor(Math.log10(value)) + 2);
  return value.toFixed(decimals);
}

/** The newest day of closes, as the sparkline's points; a close that is not a positive number breaks the line. */
export function tapePoints(candles: readonly Candle[], hours: number = TAPE_HOURS): TapePoint[] {
  return candles.slice(-hours).map((candle) => ({
    t: Number(candle.time) * 1000,
    v: Number.isFinite(candle.close) && candle.close > 0 ? priceText(candle.close) : null,
  }));
}

/** The tape's own icon address: Ryntra's icon route with the catalogue's address, as the spot list asks it. */
export function tapeIcon(mint: string, url: string | null): string | null {
  if (!url) return null;
  return `/api/spot/icon?mint=${encodeURIComponent(mint)}&u=${encodeURIComponent(url)}`;
}

/**
 * The tape's status for the core's caption: `delayed` by as long as Ryntra keeps a read, `stale` when a source did
 * not answer and the last good read is shown — aged from the older of the price and the line. Jupiter and
 * GeckoTerminal named together: one line under the tape speaks for every sparkline in it.
 */
export function tapeStatus(read: Pick<TapeRead, "observedAt" | "linesAt" | "stale">, now: number = Date.now()): DataStatus {
  const prices = Date.parse(read.observedAt);
  const lines = read.linesAt === null ? Number.NaN : Date.parse(read.linesAt);
  const oldest = Math.min(Number.isFinite(prices) ? prices : now, Number.isFinite(lines) ? lines : now);
  const at = Math.min(now, oldest);
  return {
    state: read.stale ? "stale" : "delayed",
    market: "open",
    source: { id: "jupiter-geckoterminal", label: "Jupiter · GeckoTerminal", rights: "display", attribution: null },
    at,
    gateway_at: now,
    age_ms: Math.max(0, now - at),
    delay_ms: read.stale ? null : TAPE_TTL_MS,
    derived: false,
  };
}

/** Up, down or flat by the day's change — the figure beside the line says the same thing the line's colour does. */
export function tapeTone(change: number | null): "up" | "down" | "neutral" {
  if (change === null || !Number.isFinite(change) || change === 0) return "neutral";
  return change > 0 ? "up" : "down";
}
