import { limitAmounts, rawToDecimal, scaledDecimal } from '../../../lib/solana/limits/model.ts';
import type { Side } from './tiles.ts';

/**
 * A stop in the city: «sell when the price falls to», «buy when the price rises to». The engine's limits lane has no
 * stop that rests at a venue so a stop here is the engine's watched kind, the same as Ryntra's exit plan: an intent kept
 * on this device, never an order. While Ryntra is open, the city asks the swap engine's quote for the stop's exact
 * amount; when what that amount would bring is no more than it brings at the stop's price, the stop is reached and
 * the city opens the sale's exact order — the person's wallet signs it, or nothing is sold. Nothing here holds a key,
 * and nothing moves by itself.
 *
 * The stop's price is checked the engine's way: its line is `limitAmounts` of the limits engine — what the amount
 * delivers at that price, in the output's raw units — and the quote's own `outAmountRaw` is compared with it.
 */

export type StopExpiry = '1d' | '7d' | '30d' | 'never';
export const STOP_EXPIRIES: readonly StopExpiry[] = ['1d', '7d', '30d', 'never'];
const EXPIRY_MS: Record<Exclude<StopExpiry, 'never'>, number> = { '1d': 86_400_000, '7d': 7 * 86_400_000, '30d': 30 * 86_400_000 };

/** A stop's life: watched, reached and waiting for the person, done (the sale settled), or let go. */
export type StopState = 'watching' | 'reached' | 'done' | 'cancelled';
export type StopView = StopState | 'expired';

export type StopCoin = Readonly<{ mint: string; symbol: string; decimals: number }>;

export type Stop = Readonly<{
  id: string;
  owner: string;
  side: Side;
  /** The coin bought or sold. */
  base: StopCoin & Readonly<{ name: string }>;
  /** What the price is counted in, and what pays or is paid. */
  quote: StopCoin;
  /** What the stop spends when reached: the quote on a buy, the base on a sale; raw units. */
  amountRaw: string;
  /** Quote per base, as the person typed it. */
  price: string;
  /** What the amount brings at the stop's price, raw units of the output: reached when a quote brings no more. */
  thresholdRaw: string;
  createdAt: number;
  expiresAt: number | null;
  state: StopState;
  reachedAt: number | null;
}>;

/** At most this many stops are kept per wallet on this device. */
export const MAX_STOPS = 20;

export type StopInput = Readonly<{
  owner: string;
  side: Side;
  base: Stop['base'];
  quote: StopCoin;
  amountRaw: string;
  price: string;
  expiry: StopExpiry;
}>;

export type StopProblem = Readonly<{ code: 'PRICE' | 'AMOUNT' | 'REACHED'; text: string }>;

export const inputMintOf = (stop: Pick<Stop, 'side' | 'base' | 'quote'>): string => (stop.side === 'buy' ? stop.quote.mint : stop.base.mint);
export const outputMintOf = (stop: Pick<Stop, 'side' | 'base' | 'quote'>): string => (stop.side === 'buy' ? stop.base.mint : stop.quote.mint);

/** What `amountRaw` brings at `price`, raw units of the output, by the limits engine's own arithmetic. */
export function stopThreshold(input: Pick<StopInput, 'side' | 'base' | 'quote' | 'amountRaw' | 'price'>): string | null {
  if (!/^\d+$/.test(input.amountRaw) || BigInt(input.amountRaw) === 0n) return null;
  const spentDecimals = input.side === 'buy' ? input.quote.decimals : input.base.decimals;
  const amounts = limitAmounts({
    pair: { baseMint: input.base.mint, baseDecimals: input.base.decimals, quoteMint: input.quote.mint, quoteDecimals: input.quote.decimals },
    side: input.side,
    amount: rawToDecimal(input.amountRaw, spentDecimals),
    price: input.price,
  });
  return amounts?.takingRaw ?? null;
}

/**
 * A new stop, or why it cannot be one. `nowOutRaw` is what the engine's quote says the amount brings now: a stop that
 * would be reached at once is a market order, and the card says so instead.
 */
export function makeStop(input: StopInput, now: number, nowOutRaw: string | null, id: string): Readonly<{ ok: true; stop: Stop }> | Readonly<{ ok: false; problem: StopProblem }> {
  const scaled = scaledDecimal(input.price, 18);
  if (scaled === null || scaled <= 0n) return { ok: false, problem: { code: 'PRICE', text: 'Type the stop price.' } };
  const thresholdRaw = stopThreshold(input);
  if (!thresholdRaw || thresholdRaw === '0') return { ok: false, problem: { code: 'AMOUNT', text: 'Pick an amount for the stop.' } };
  if (nowOutRaw !== null && /^\d+$/.test(nowOutRaw) && BigInt(nowOutRaw) <= BigInt(thresholdRaw)) {
    const text = input.side === 'sell' ? 'The price is already there. Use Market or set it lower.' : 'The price is already there. Use Market or set it higher.';
    return { ok: false, problem: { code: 'REACHED', text } };
  }
  const expiresAt = input.expiry === 'never' ? null : now + EXPIRY_MS[input.expiry];
  return {
    ok: true,
    stop: { id, owner: input.owner, side: input.side, base: input.base, quote: input.quote, amountRaw: input.amountRaw, price: input.price, thresholdRaw, createdAt: now, expiresAt, state: 'watching', reachedAt: null },
  };
}

/** Whether the engine's quote for the stop's amount has come to the stop's price. */
export function stopReached(stop: Pick<Stop, 'thresholdRaw'>, outAmountRaw: string): boolean {
  return /^\d+$/.test(outAmountRaw) && BigInt(outAmountRaw) <= BigInt(stop.thresholdRaw);
}

/** How the stop stands now: a watched or reached stop past its time has expired. */
export function stopView(stop: Pick<Stop, 'state' | 'expiresAt'>, now: number): StopView {
  if ((stop.state === 'watching' || stop.state === 'reached') && stop.expiresAt !== null && now >= stop.expiresAt) return 'expired';
  return stop.state;
}

/** The stops the city asks the engine about: this wallet's, watched, not past their time. */
export function stopsToWatch(stops: readonly Stop[], owner: string, now: number): readonly Stop[] {
  return stops.filter((stop) => stop.owner === owner && stopView(stop, now) === 'watching');
}

export function withState(stops: readonly Stop[], id: string, change: Partial<Pick<Stop, 'state' | 'reachedAt'>>): readonly Stop[] {
  return stops.map((stop) => (stop.id === id ? { ...stop, ...change } : stop));
}

/** What is kept: the newest first; let-go stops, and finished ones older than thirty days, are dropped. */
export function keptStops(stops: readonly Stop[], now: number): readonly Stop[] {
  const old = (stop: Stop) => now - stop.createdAt > 30 * 86_400_000;
  const live = stops.filter((stop) => {
    const view = stopView(stop, now);
    return view !== 'cancelled' && !((view === 'done' || view === 'expired') && old(stop));
  });
  return [...live].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_STOPS);
}

const RAW = /^\d{1,30}$/;
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const STATES: ReadonlySet<string> = new Set(['watching', 'reached', 'done', 'cancelled']);

function coin(value: unknown): (StopCoin & { name: string }) | null {
  const v = value as Record<string, unknown> | null;
  if (!v || typeof v !== 'object' || typeof v.mint !== 'string' || !MINT.test(v.mint) || typeof v.symbol !== 'string' || v.symbol.length > 40) return null;
  if (typeof v.decimals !== 'number' || !Number.isInteger(v.decimals) || v.decimals < 0 || v.decimals > 18) return null;
  return { mint: v.mint, symbol: v.symbol, decimals: v.decimals, name: typeof v.name === 'string' ? v.name.slice(0, 128) : v.symbol };
}

/** The stops kept on this device, read back; anything not exactly a stop is left out, never guessed at. */
export function parseStops(text: string | null): readonly Stop[] {
  if (!text) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const stops: Stop[] = [];
  for (const item of raw.slice(0, MAX_STOPS)) {
    const v = item as Record<string, unknown> | null;
    if (!v || typeof v !== 'object') continue;
    const base = coin(v.base);
    const quote = coin(v.quote);
    if (!base || !quote || typeof v.id !== 'string' || typeof v.owner !== 'string' || !MINT.test(v.owner)) continue;
    if ((v.side !== 'buy' && v.side !== 'sell') || typeof v.amountRaw !== 'string' || !RAW.test(v.amountRaw) || typeof v.thresholdRaw !== 'string' || !RAW.test(v.thresholdRaw)) continue;
    if (typeof v.price !== 'string' || scaledDecimal(v.price, 18) === null || typeof v.state !== 'string' || !STATES.has(v.state) || typeof v.createdAt !== 'number') continue;
    const expiresAt = typeof v.expiresAt === 'number' ? v.expiresAt : null;
    const reachedAt = typeof v.reachedAt === 'number' ? v.reachedAt : null;
    stops.push({ id: v.id, owner: v.owner, side: v.side, base, quote: { mint: quote.mint, symbol: quote.symbol, decimals: quote.decimals }, amountRaw: v.amountRaw, price: v.price, thresholdRaw: v.thresholdRaw, createdAt: v.createdAt, expiresAt, state: v.state as StopState, reachedAt });
  }
  return stops;
}

/** Where a wallet's stops are kept in this browser. */
export const stopsKey = (owner: string) => `ryntra.city.stops.v1:${owner}`;

/** The stop's condition in words, for «My orders». */
export function stopWhen(stop: Pick<Stop, 'side'>): string {
  return stop.side === 'sell' ? 'Sell if the price falls to' : 'Buy if the price rises to';
}

export function expiryWords(expiry: StopExpiry): string {
  return expiry === '1d' ? '1 day' : expiry === '7d' ? '7 days' : expiry === '30d' ? '30 days' : 'Until cancelled';
}
