/**
 * A pool's liquidity by price, in one format for both of Meteora's concentrated pools: DLMM's bins around the
 * active bin, and DLMM Pro's steps of its tick spacing around the price. A row is one step of the price with what lies
 * on it of each coin; beside the rows stand the facts a person reads before adding to the pool — where the market
 * prices the pair now, and what a new position's accounts cost and give back.
 *
 * Read-only: every figure is the chain's or the venue's own SDK's; the one figure worked out here is how far the pool's
 * price stands from the market's, a plain ratio. Pure and client-safe: the server builds the answer from it, the screen
 * and the tests read it alike.
 */

export type EarnBinsVenue = "dlmm" | "pro";

/** Steps read on each side of the price when the caller names none, and the most one answer carries a side. */
export const EARN_BINS_HALF = 40;
export const EARN_BINS_MAX_HALF = 70;

export type EarnBin = Readonly<{
  /** Steps from the price: 0 — the step the price stands in, negative below it, positive above. */
  offset: number;
  /** The step's own id on its pool: DLMM's bin id, DLMM Pro's lower tick id. */
  id: number;
  /** Y per one X in whole coins at the step (DLMM Pro: at its lower edge). */
  price: number;
  /** What lies on the step, base units of each coin. */
  x: string;
  y: string;
}>;

/**
 * One of the pool's shared ledgers of steps. A new position names two of them — the one its lowest step is in and the
 * one after — and pays to open whichever nobody opened yet.
 */
export type EarnBinLedger = Readonly<{ lower: number; upper: number; open: boolean }>;

export type EarnBinsRent = Readonly<{
  /** A new position's own account, lamports: it comes back when the position is closed. */
  positionLamports: string;
  /** Opening one shared ledger, lamports: it stays with the pool. */
  ledgerLamports: string;
  /** The ledgers around the price, ascending, by the step ids each holds. */
  ledgers: readonly EarnBinLedger[];
}>;

export type EarnBinsCoin = Readonly<{ mint: string; decimals: number }>;

export type EarnBinsAnswer = Readonly<{
  venue: EarnBinsVenue;
  pool: string;
  x: EarnBinsCoin;
  y: EarnBinsCoin;
  /** The price step between neighbours, basis points: DLMM's bin step; DLMM Pro's tick spacing (a tick is one). */
  stepBps: number;
  /** The id of the step the price stands in. */
  activeId: number;
  /** Y per one X in whole coins, the pool's own price now. */
  price: number;
  /** Ascending by `offset`; a step nothing lies on is carried with zeros. */
  bins: readonly EarnBin[];
  /** Where the market prices the pair (Jupiter), and how far the pool stands from it, per cent; null — not read. */
  market: Readonly<{ price: number | null; gapPct: number | null }>;
  /** What a new position's accounts cost; null where the venue's Review alone says it. */
  rent: EarnBinsRent | null;
  /** When the chain was read, ISO. */
  at: string;
}>;

/** A tick spacing of DLMM Pro as the price step between neighbours, basis points: a tick is a ten-thousandth, compounded. */
export const stepBpsOfSpacing = (tickSpacing: number): number => (Math.pow(1.0001, tickSpacing) - 1) * 10_000;

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Whether a text can be a pool's address at all. */
export function isPoolAddress(value: unknown): value is string {
  return typeof value === "string" && BASE58.test(value);
}

/** The side width a request asks for: a whole number within the answer's bounds; the default when it names none; null — refused. */
export function binsHalfOf(text: string | null): number | null {
  if (text === null || text === "") return EARN_BINS_HALF;
  if (!/^\d{1,3}$/.test(text)) return null;
  const half = Number(text);
  return half >= 1 && half <= EARN_BINS_MAX_HALF ? half : null;
}

/** How far the pool's price stands from the market's, per cent of the market's: positive — the pool is dearer. */
export function gapPctOf(poolPrice: number, marketPrice: number | null): number | null {
  if (marketPrice === null || !(marketPrice > 0) || !(poolPrice > 0)) return null;
  const gap = (poolPrice / marketPrice - 1) * 100;
  return Number.isFinite(gap) ? gap : null;
}

/** The market's price of X in Y from each coin's dollar price; null when either is not known. */
export function marketPriceOf(xUsd: number | null, yUsd: number | null): number | null {
  if (xUsd === null || yUsd === null || !(xUsd > 0) || !(yUsd > 0)) return null;
  const price = xUsd / yUsd;
  return Number.isFinite(price) ? price : null;
}

const UNITS = /^\d{1,40}$/;

/** Whether an answer has the shape the screen draws from: a guard for what came over the network. */
export function isEarnBinsAnswer(value: unknown): value is EarnBinsAnswer {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const coin = (c: unknown) => Boolean(c) && typeof c === "object" && typeof (c as EarnBinsCoin).mint === "string" && Number.isInteger((c as EarnBinsCoin).decimals);
  if (v.venue !== "dlmm" && v.venue !== "pro") return false;
  if (typeof v.pool !== "string" || !coin(v.x) || !coin(v.y)) return false;
  if (typeof v.stepBps !== "number" || !(v.stepBps > 0) || !Number.isInteger(v.activeId) || typeof v.price !== "number" || !(v.price > 0)) return false;
  if (!Array.isArray(v.bins) || !v.bins.length) return false;
  for (const bin of v.bins as EarnBin[]) {
    if (!bin || !Number.isInteger(bin.offset) || !Number.isInteger(bin.id) || typeof bin.price !== "number" || !(bin.price > 0)) return false;
    if (typeof bin.x !== "string" || typeof bin.y !== "string" || !UNITS.test(bin.x) || !UNITS.test(bin.y)) return false;
  }
  const market = v.market as EarnBinsAnswer["market"] | undefined;
  if (!market || typeof market !== "object") return false;
  const rent = v.rent as EarnBinsRent | null | undefined;
  if (rent !== null && (!rent || !UNITS.test(rent.positionLamports) || !UNITS.test(rent.ledgerLamports) || !Array.isArray(rent.ledgers))) return false;
  return typeof v.at === "string";
}
