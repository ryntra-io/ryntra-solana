/**
 * The Grid's starting band and the one price it stands on (release check 19.11: in 2 of 6 loads the band stood at
 * 0.334–0.408 over MET at 0.264 — every level over the price). The cause: the first frame paints the bundled market
 * (`city/lib/market/snapshot.json`, SOL at $101), and when the DLMM Pro pool — quoted in SOL — answered before the live
 * market did, its price was turned into dollars at the bundled SOL, and the start, keyed on the coin and its venue alone,
 * never moved again.
 *
 * The rule:
 * - the band starts on one named price — the venue's own (the pool the levels are counted from) in dollars — and only
 *   once that price is read: the venue answered, and its quote coin's dollars are live (a dollar coin is always one);
 * - where no venue takes the coin, the market's live price of it (a picture, nothing signs);
 * - until then nothing is started: the form says it reads the pool, never numbers;
 * - the price read again moves a band the person has not touched (its width as it stood; the levels stay); a band she
 *   typed, picked or dragged stays hers — before the price came too;
 * - no plan is counted, drawn or signed on prices that are not live: the same gate (`pricesLive`);
 * - another coin starts again.
 *
 * Pure: the screen and the tests read it as it is.
 */

/** A price moved by less than this share is the same price: the band is not started again for it. */
const SAME = 0.001;

export type StartInput = Readonly<{
  /** The venue that takes the coin's orders: DLMM Pro, the classic DLMM pool, or none (null while unknown or none). */
  venue: 'pro' | 'dlmm' | null;
  /** Every venue answered for this coin: `venue` null is «none», not «not yet». */
  venuesKnown: boolean;
  /** The venue's price of the coin in its quote coin. */
  venuePrice: number | null;
  /** The quote coin's dollars, as the market says them; null — not known. */
  perQuote: number | null;
  /** The quote coin is a dollar coin: its dollars need no market read. */
  quoteIsDollar: boolean;
  /** The market's read is live, not the bundled first frame. */
  marketLive: boolean;
  /** The market's price of the coin itself, dollars. */
  coinUsd: number | null;
}>;

const positive = (value: number | null): value is number => value !== null && Number.isFinite(value) && value > 0;

/**
 * Whether the dollars the grid is counted in are live: a venue's — its quote coin a dollar coin, or the market read live;
 * no venue's — the market read live. Not live: no band starts, no plan is drawn or signed.
 */
export function pricesLive(input: Pick<StartInput, 'venue' | 'quoteIsDollar' | 'marketLive'>): boolean {
  return input.venue ? input.quoteIsDollar || input.marketLive : input.marketLive;
}

/** The one price the band starts on, dollars — or null: not read yet, the form says it reads. */
export function startPrice(input: StartInput): number | null {
  if (!pricesLive(input)) return null;
  if (input.venue) return positive(input.venuePrice) && positive(input.perQuote) ? input.venuePrice * input.perQuote : null;
  if (!input.venuesKnown) return null;
  return positive(input.coinUsd) ? input.coinUsd : null;
}

/** Where the band stood started: the coin, the venue its levels were fitted to, and the price it started on. */
export type Started = Readonly<{ mint: string; venue: 'pro' | 'dlmm' | null; usd: number }>;

/**
 * Whether the band starts (again) now: a coin not started yet, another coin, or the same coin's price read again
 * while the person has not touched the band. A band she touched stays as she left it.
 */
export function startsNow(started: Started | null, mint: string, usd: number | null, own: boolean): boolean {
  if (usd === null) return false;
  if (!started || started.mint !== mint) return true;
  if (own) return false;
  return Math.abs(usd / started.usd - 1) > SAME;
}

/**
 * What the start does now, for the coin on screen, its venue and its start price (`own` — the person touched this coin's
 * band since it was opened; the screen forgets it when another coin is picked):
 * - `clear` — another coin, its price not read yet: the old coin's band goes, the form reads;
 * - `note` — nothing started since the coin was opened, and the person made her own band before the price came: it
 *   stands, the start is only noted;
 * - `first` — the coin's first start, or its venue changed under an untouched band: its band and its levels (on a
 *   classic pool, fitted to the bins);
 * - `recentre` — the price read again, the band untouched: the band moves at the width it stood, the levels stay;
 * - `none` — nothing changes.
 */
export type StartStep = 'none' | 'clear' | 'note' | 'first' | 'recentre';

export function startStep(started: Started | null, mint: string, venue: Started['venue'], usd: number | null, own: boolean): StartStep {
  const sameCoin = started !== null && started.mint === mint;
  if (usd === null) return started && !sameCoin ? 'clear' : 'none';
  if (!started && own) return 'note';
  if (!sameCoin) return 'first';
  if (started.venue !== venue) return own ? 'none' : 'first';
  return startsNow(started, mint, usd, own) ? 'recentre' : 'none';
}
