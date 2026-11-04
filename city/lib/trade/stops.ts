import { scaledDecimal } from '../../../lib/solana/limits/model.ts';
import { expiresAtOf, inputMintOf, MAX_STOPS, outputMintOf, STOP_EXPIRIES, STOP_ID, stopReached, stopThreshold, type StopExpiry } from '../../../lib/stops/model.ts';
import { wordsNow } from '../i18n/dict.ts';
import type { Side } from './tiles.ts';
import { STOPS } from './words.ts';

/**
 * A stop in the city: «sell when the price falls to», «buy when the price rises to». The engine's limits lane has no
 * stop that rests at a venue so a stop here is the engine's watched kind: an intent, never an order. Since CITY-149 the
 * engine keeps it under the wallet's account (`lib/stops`, `stops-api.ts`), watches it with the swap engine's quote
 * around the clock and tells the person when it is reached; while Ryntra is open the city asks the same quote too.
 * Reached, the city opens the sale's exact order — the person's wallet signs it, or nothing is sold. A stop set before
 * the engine kept stops (or while its switch is shut) stays on this device, watched while Ryntra is open. Nothing here
 * holds a key, and nothing moves by itself.
 *
 * The stop's price is checked the engine's way, by the same two functions the cron uses (`lib/stops/model.ts`): its
 * line is `limitAmounts` of the limits engine — what the amount delivers at that price, in the output's raw units —
 * and the quote's own `outAmountRaw` is compared with it.
 */

export { inputMintOf, MAX_STOPS, outputMintOf, STOP_EXPIRIES, stopReached, stopThreshold, type StopExpiry };

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

/** A stop the engine keeps under the wallet (its id is the engine's); any other is kept on this device only. */
export const isEngineStop = (stop: Pick<Stop, 'id'>): boolean => STOP_ID.test(stop.id);

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

/**
 * A new stop, or why it cannot be one. `nowOutRaw` is what the engine's quote says the amount brings now: a stop that
 * would be reached at once is a market order, and the card says so instead.
 */
export function makeStop(input: StopInput, now: number, nowOutRaw: string | null, id: string): Readonly<{ ok: true; stop: Stop }> | Readonly<{ ok: false; problem: StopProblem }> {
  const scaled = scaledDecimal(input.price, 18);
  if (scaled === null || scaled <= 0n) return { ok: false, problem: { code: 'PRICE', text: wordsNow(STOPS).typePrice } };
  const thresholdRaw = stopThreshold(input);
  if (!thresholdRaw || thresholdRaw === '0') return { ok: false, problem: { code: 'AMOUNT', text: wordsNow(STOPS).pickAmount } };
  if (nowOutRaw !== null && /^\d+$/.test(nowOutRaw) && BigInt(nowOutRaw) <= BigInt(thresholdRaw)) {
    const text = input.side === 'sell' ? wordsNow(STOPS).thereLower : wordsNow(STOPS).thereHigher;
    return { ok: false, problem: { code: 'REACHED', text } };
  }
  const expiresAt = expiresAtOf(input.expiry, now);
  return {
    ok: true,
    stop: { id, owner: input.owner, side: input.side, base: input.base, quote: input.quote, amountRaw: input.amountRaw, price: input.price, thresholdRaw, createdAt: now, expiresAt, state: 'watching', reachedAt: null },
  };
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
  return stop.side === 'sell' ? wordsNow(STOPS).sellIfFalls : wordsNow(STOPS).buyIfRises;
}

export function expiryWords(expiry: StopExpiry): string {
  const w = wordsNow(STOPS);
  return expiry === '1d' ? w.day1 : expiry === '7d' ? w.days7 : expiry === '30d' ? w.days30 : w.untilCancelled;
}
