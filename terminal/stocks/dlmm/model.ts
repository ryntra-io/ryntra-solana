import { spendable } from '../../../city/lib/districts/harbor/deposit.ts';
import { GOAL_SHAPE, PIER_RESERVE_LAMPORTS, PIER_SLIPPAGE_BPS, STYLE_HALF, type PierGoal, type PierStyle } from '../../../city/lib/earn/pier.ts';
import type { Holdings } from '../../../city/lib/trade/wallet.ts';
import { rawFromText, textFromRaw } from '../../../lib/earn/model.ts';
import type { DlmmStockRead, DlmmStockReview } from '../../../lib/earn-dlmm/stocks.ts';

/**
 * What the ticket of a stock's DLMM pool stands on, decided apart from the markup: the two amounts the
 * person puts in (the second follows the first at the pool's own price — the same worth of each, as an even range around
 * the price takes them), what the wallet holds against them, the request the engine's add is asked for, and the figures
 * of the Review it builds. The range is the Pier's own: a goal (how the money spreads) and a width (how far it reaches).
 * Nothing is swapped: both coins go in as they are.
 *
 * Pure.
 */

export const WRAPPED_SOL = 'So11111111111111111111111111111111111111112';
export const DEFAULT_STOCK_GOAL: PierGoal = 'even';
export const DEFAULT_STOCK_STYLE: PierStyle = 'balanced';

export type Lead = 'stock' | 'quote';
export type Typed = Readonly<{ stock: string; quote: string; lead: Lead }>;
export const NO_TYPED: Typed = { stock: '', quote: '', lead: 'stock' };

/** The other coin's symbol: the pool's own is USDC or SOL. */
export const quoteSymbol = (read: Pick<DlmmStockRead, 'quote'>): string => (read.quote.kind === 'sol' ? 'SOL' : 'USDC');

/** Places a figure the eye reads is cut to: four for a coin under a hundred, two above. */
const placesFor = (decimals: number, worth: number): number => Math.min(decimals, worth >= 100 ? 2 : worth >= 1 ? 4 : 6);

/**
 * The amount the other field follows to: the same worth as `text` of the coin the person typed, at the pool's price. An
 * amount that does not read leaves the other field empty.
 */
export function followOf(read: Pick<DlmmStockRead, 'price' | 'stock' | 'quote'>, lead: Lead, text: string): string {
  const from = lead === 'stock' ? read.stock.decimals : read.quote.decimals;
  const to = lead === 'stock' ? read.quote.decimals : read.stock.decimals;
  const raw = rawFromText(text, from);
  if (raw === null || raw <= 0n || !(read.price > 0)) return '';
  const whole = Number(raw) / 10 ** from;
  const other = lead === 'stock' ? whole * read.price : whole / read.price;
  if (!Number.isFinite(other) || other <= 0) return '';
  const places = placesFor(to, other);
  const units = BigInt(Math.floor(other * 10 ** places)) * 10n ** BigInt(to - places);
  return units > 0n ? textFromRaw(units, to, places) : '';
}

/** What the two fields say now: the one typed last as typed, the other following it. */
export function typedAfter(read: Pick<DlmmStockRead, 'price' | 'stock' | 'quote'>, lead: Lead, text: string): Typed {
  const other = followOf(read, lead, text);
  return lead === 'stock' ? { stock: text, quote: other, lead } : { stock: other, quote: text, lead };
}

export type StockProblem = 'format' | 'stock' | 'quote' | 'sol';

export type StockChoice = Readonly<{
  stockUnits: bigint | null;
  quoteUnits: bigint | null;
  /** The pool's X and Y, base units, as the engine's add takes them. */
  x: string;
  y: string;
  problem: StockProblem | null;
  /** The Review's key for this exact choice; null when it cannot be asked. */
  key: string | null;
}>;

/**
 * The choice on the form against the wallet: both coins as typed, each within what the wallet holds, and the SOL kept
 * aside for the position's deposit and the network (`reserve`: the Review's own figure once there is one). A wallet not
 * read yet fits — the engine has the last word.
 */
export function stockChoice(read: DlmmStockRead, owner: string | null, typed: Typed, holdings: Holdings | null, goal: PierGoal, style: PierStyle, reserve: bigint = PIER_RESERVE_LAMPORTS): StockChoice {
  const stockUnits = typed.stock.trim() ? rawFromText(typed.stock, read.stock.decimals) : 0n;
  const quoteUnits = typed.quote.trim() ? rawFromText(typed.quote, read.quote.decimals) : 0n;
  const stockSide = read.stock.side;
  const x = (stockSide === 'x' ? stockUnits : quoteUnits) ?? 0n;
  const y = (stockSide === 'x' ? quoteUnits : stockUnits) ?? 0n;
  let problem: StockProblem | null = null;
  if (stockUnits === null || quoteUnits === null || (stockUnits === 0n && quoteUnits === 0n)) problem = 'format';
  else {
    const heldStock = spendable(holdings, read.stock.mint);
    const heldQuote = read.quote.kind === 'sol' ? null : spendable(holdings, read.quote.mint);
    const sol = spendable(holdings, WRAPPED_SOL);
    // SOL goes in as the other coin of a SOL pool, beside what the position's deposit and the network take.
    const solIn = read.quote.kind === 'sol' ? quoteUnits : 0n;
    if (heldStock !== null && stockUnits > heldStock) problem = 'stock';
    else if (heldQuote !== null && quoteUnits > heldQuote) problem = 'quote';
    else if (sol !== null && solIn + reserve > sol) problem = solIn > 0n ? 'quote' : 'sol';
  }
  const key = owner && !problem ? `dlmm-stock:${owner}:${read.pool}:${style}:${goal}:${x}:${y}` : null;
  return { stockUnits, quoteUnits, x: x.toString(), y: y.toString(), problem, key };
}

export type StockAddBody = Readonly<{
  action: 'add';
  venue: 'meteora-dlmm';
  range: Readonly<{ place: 'around'; half: number }>;
  request: Readonly<{ pool: string; owner: string; amountX: string; amountY: string; shape: string; slippageBps: number }>;
}>;

/** The engine's add for the choice: a new position around the price, in the goal's shape and the style's width. */
export function stockAddBody(read: DlmmStockRead, owner: string, choice: StockChoice, goal: PierGoal, style: PierStyle): StockAddBody {
  return {
    action: 'add',
    venue: 'meteora-dlmm',
    range: { place: 'around', half: STYLE_HALF[style] },
    request: { pool: read.pool, owner, amountX: choice.x, amountY: choice.y, shape: GOAL_SHAPE[goal], slippageBps: PIER_SLIPPAGE_BPS },
  };
}

/** Where a new position earns for a width, in the other coin per stock, counted from the pool's price before a Review. */
export function stockRange(read: Pick<DlmmStockRead, 'price' | 'binStepBps'>, style: PierStyle): Readonly<{ low: number; high: number; downPct: number; upPct: number }> {
  const step = (1 + read.binStepBps / 10_000) ** STYLE_HALF[style];
  const low = read.price / step;
  const high = read.price * step;
  return { low, high, downPct: (1 - low / read.price) * 100, upPct: (high / read.price - 1) * 100 };
}

export type StockFigures = Readonly<{
  /** Each coin that goes in, «1.05 ANT», «100 USDC». */
  goesIn: readonly string[];
  /** The range the position opens on, in the other coin per stock; null where the Review states none. */
  low: number | null;
  high: number | null;
  /** SOL paid for the position's own account — it comes back when the position is closed. */
  depositBack: bigint;
  /** SOL paid for the pool's new space the position needs — it does not come back. */
  kept: bigint;
  network: bigint;
  /** Every lamport the add needs besides the coins: what the wallet keeps aside. */
  reserve: bigint;
  transactions: number;
}>;

const digitsOf = (text: string): bigint => (/^\d+$/.test(text) ? BigInt(text) : 0n);

/** A Review as the ticket reads it: every figure the engine's own. */
export function stockFigures(review: DlmmStockReview, read: Pick<DlmmStockRead, 'stock' | 'quote'>): StockFigures {
  const preview = review.preview;
  const stockOnX = read.stock.side === 'x';
  const deposit = preview.action === 'add' ? preview.deposit : null;
  const coin = (units: string, decimals: number, symbol: string) => (digitsOf(units) > 0n ? `${textFromRaw(digitsOf(units), decimals, Math.min(decimals, 4))} ${symbol}` : null);
  const goesIn = deposit
    ? [
        coin(stockOnX ? deposit.x.units : deposit.y.units, read.stock.decimals, read.stock.symbol),
        coin(stockOnX ? deposit.y.units : deposit.x.units, read.quote.decimals, quoteSymbol(read)),
      ].filter((text): text is string => text !== null)
    : [];
  let low: number | null = null;
  let high: number | null = null;
  if (preview.action === 'add' && preview.range.kind === 'bins') {
    const lower = Number(preview.range.lowerPrice);
    const upper = Number(preview.range.upperPrice);
    if (lower > 0 && upper > lower) [low, high] = stockOnX ? [lower, upper] : [1 / upper, 1 / lower];
  }
  let depositBack = 0n;
  let kept = 0n;
  for (const row of preview.rent) {
    if (row.direction !== 'pay') continue;
    if (row.refundable) depositBack += digitsOf(row.lamports);
    else kept += digitsOf(row.lamports);
  }
  const network = digitsOf(review.networkFeeLamports);
  return { goesIn, low, high, depositBack, kept, network, reserve: depositBack + kept + network, transactions: review.transactions.length };
}
