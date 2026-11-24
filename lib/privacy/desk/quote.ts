/**
 * The private desk's quote. A swap from the private balance done inside
 * the ring: the person pays the desk privately, the desk pays the person privately, both legs in one transaction
 * (`joint.ts`). This file is the price: pure, the same on the desk and in the person's browser.
 *
 * - A quote names **one desk address made for it** — a one-time key of the desk (`slots.ts`), stocked in advance from the
 *   desk's ring by a private transfer. One quote, one address: the desk's swaps are not one public address trading all
 *   day, and a quote can lose no more than the one address holds.
 * - The price is **firm for a few seconds** (`firmUntil`): taken in time, it stands while both sides prove their legs and
 *   the wallet signs (`fillUntil`). The person pays an exact amount; the desk pays the quoted amount — no slippage, no
 *   queue in front of the trade.
 * - The person checks every quote before taking it (`checkQuote`): the same pair and amount it asked, the network, a desk
 *   address, something to receive, a firm window not longer than believable.
 *
 * `config.ts` leaves them empty, and the devnet probe (`scripts/privacy/desk-probe.mjs`) brings its own.
 */

/** How long a quote's price stands for the person to take it. */
export const FIRM_MS = 8_000;
/** Once taken: the person's proof (up to 20 s), the desk's, the join and the wallet's signature. */
export const FILL_MS = 45_000;
/** A quote that says it is firm for longer than this is not believed: its price would be stale by then. */
export const FIRM_MAX_MS = 15_000;
/** The highest spread the desk may set — a guard against a typo in the terms, not the owner's number. */
export const SPREAD_MAX_BPS = 500;

export type Pair = Readonly<{ inMint: string; outMint: string }>;

/** What the person asks: pay exactly `inRaw` of `inMint` (smallest units), get `outMint`. */
export type Ask = Readonly<{ owner: string; inMint: string; outMint: string; inRaw: bigint }>;

/** The desk's middle price: `inRaw` of the coin given buys `outRaw` of the coin got, read at `at` (ms). */
export type Mid = Readonly<{ inRaw: bigint; outRaw: bigint; at: number }>;

export type Terms = Readonly<{
  spreadBps: number;
  /** The least the desk takes, in the coin given: dust costs more in proofs than it earns. */
  minInRaw: bigint;
  firmMs: number;
  fillMs: number;
  /** A middle price older than this is not quoted on. */
  midMaxAgeMs: number;
}>;

export type Quote = Readonly<{
  id: string;
  /** The network the quote's legs are signed for, as `solana:devnet`. */
  chain: string;
  /** The desk's one-time address for this quote: the person pays it, it pays the person. */
  desk: string;
  owner: string;
  inMint: string;
  outMint: string;
  inRaw: bigint;
  outRaw: bigint;
  spreadBps: number;
  at: number;
  firmUntil: number;
  fillUntil: number;
}>;

/** Why the desk quotes nothing — the Swap then goes the route's way (`way.ts`). */
export type QuoteRefusal = 'SAME' | 'PAIR' | 'SMALL' | 'NO_PRICE' | 'STALE_PRICE' | 'NO_STOCK' | 'TERMS';

/** Why the person does not take a quote. */
export type QuoteProblem = 'ASK' | 'CHAIN' | 'DESK' | 'NOTHING' | 'EXPIRED' | 'LONG';

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const pairKey = (pair: Pair) => `${pair.inMint}>${pair.outMint}`;

export function quotesPair(pairs: readonly Pair[], pair: Pair): boolean {
  return pair.inMint !== pair.outMint && pairs.some((p) => p.inMint === pair.inMint && p.outMint === pair.outMint);
}

/** What `inRaw` buys at the middle price less the spread, rounded down: the desk never pays a unit more than quoted. */
export function outFor(inRaw: bigint, mid: Mid, spreadBps: number): bigint {
  if (inRaw <= 0n || mid.inRaw <= 0n || mid.outRaw <= 0n) return 0n;
  const keep = 10_000n - BigInt(Math.round(spreadBps));
  return (inRaw * mid.outRaw * keep) / (mid.inRaw * 10_000n);
}

export function termsOk(terms: Terms): boolean {
  return (
    Number.isInteger(terms.spreadBps) &&
    terms.spreadBps >= 0 &&
    terms.spreadBps <= SPREAD_MAX_BPS &&
    terms.minInRaw > 0n &&
    terms.firmMs > 0 &&
    terms.firmMs <= FIRM_MAX_MS &&
    terms.fillMs >= terms.firmMs &&
    terms.midMaxAgeMs > 0
  );
}

export type QuoteInput = Readonly<{
  ask: Ask;
  pairs: readonly Pair[];
  terms: Terms;
  mid: Mid | null;
  /** The one-time address picked for this quote and what it holds of the coin the person gets; null — none holds enough. */
  slot: Readonly<{ address: string; holds: bigint }> | null;
  id: string;
  chain: string;
  now: number;
}>;

export type Made = Readonly<{ ok: true; quote: Quote }> | Readonly<{ ok: false; code: QuoteRefusal }>;

/** The desk's side: a firm quote for this ask, or why there is none. */
export function makeQuote(input: QuoteInput): Made {
  const { ask, pairs, terms, mid, slot, now } = input;
  if (!termsOk(terms)) return { ok: false, code: 'TERMS' };
  if (ask.inMint === ask.outMint) return { ok: false, code: 'SAME' };
  if (!quotesPair(pairs, ask)) return { ok: false, code: 'PAIR' };
  if (ask.inRaw < terms.minInRaw) return { ok: false, code: 'SMALL' };
  if (!mid) return { ok: false, code: 'NO_PRICE' };
  if (now - mid.at > terms.midMaxAgeMs || mid.at > now) return { ok: false, code: 'STALE_PRICE' };
  const outRaw = outFor(ask.inRaw, mid, terms.spreadBps);
  if (outRaw <= 0n) return { ok: false, code: 'SMALL' };
  if (!slot || slot.holds < outRaw) return { ok: false, code: 'NO_STOCK' };
  return {
    ok: true,
    quote: {
      id: input.id,
      chain: input.chain,
      desk: slot.address,
      owner: ask.owner,
      inMint: ask.inMint,
      outMint: ask.outMint,
      inRaw: ask.inRaw,
      outRaw,
      spreadBps: terms.spreadBps,
      at: now,
      firmUntil: now + terms.firmMs,
      fillUntil: now + terms.fillMs,
    },
  };
}

/** The person's side, before taking a quote: is it the one asked for, and still firm? */
export function checkQuote(quote: Quote, ask: Ask, chain: string, now: number): QuoteProblem | null {
  if (quote.owner !== ask.owner || quote.inMint !== ask.inMint || quote.outMint !== ask.outMint || quote.inRaw !== ask.inRaw) return 'ASK';
  if (quote.chain !== chain) return 'CHAIN';
  if (!ADDRESS.test(quote.desk) || quote.desk === ask.owner) return 'DESK';
  if (quote.outRaw <= 0n) return 'NOTHING';
  if (quote.firmUntil - quote.at > FIRM_MAX_MS || quote.fillUntil < quote.firmUntil) return 'LONG';
  if (now > quote.firmUntil) return 'EXPIRED';
  return null;
}

/** Milliseconds the price still stands to be taken. */
export function firmLeft(quote: Quote, now: number): number {
  return Math.max(0, quote.firmUntil - now);
}

/** Can both legs still be joined and signed under this quote? */
export function canFill(quote: Quote, now: number): boolean {
  return now <= quote.fillUntil;
}

/** A quote as it travels between the desk and the browser: amounts as decimal text. */
export type QuoteWire = Readonly<Omit<Quote, 'inRaw' | 'outRaw'> & { inRaw: string; outRaw: string }>;

export function quoteToWire(quote: Quote): QuoteWire {
  return { ...quote, inRaw: quote.inRaw.toString(), outRaw: quote.outRaw.toString() };
}

const DIGITS = /^\d{1,30}$/;

/** A quote read from the desk's answer; null when any field is not what a quote is. */
export function quoteFromWire(value: unknown): Quote | null {
  const v = value as Partial<Record<keyof QuoteWire, unknown>> | null;
  if (!v || typeof v !== 'object') return null;
  const text = (x: unknown) => typeof x === 'string' && x.length > 0 && x.length <= 128;
  const time = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x > 0;
  if (![v.id, v.chain, v.desk, v.owner, v.inMint, v.outMint].every(text)) return null;
  if (typeof v.inRaw !== 'string' || typeof v.outRaw !== 'string' || !DIGITS.test(v.inRaw) || !DIGITS.test(v.outRaw)) return null;
  if (typeof v.spreadBps !== 'number' || !Number.isInteger(v.spreadBps) || v.spreadBps < 0 || v.spreadBps > SPREAD_MAX_BPS) return null;
  if (![v.at, v.firmUntil, v.fillUntil].every(time)) return null;
  return {
    id: v.id as string,
    chain: v.chain as string,
    desk: v.desk as string,
    owner: v.owner as string,
    inMint: v.inMint as string,
    outMint: v.outMint as string,
    inRaw: BigInt(v.inRaw),
    outRaw: BigInt(v.outRaw),
    spreadBps: v.spreadBps,
    at: v.at as number,
    firmUntil: v.firmUntil as number,
    fillUntil: v.fillUntil as number,
  };
}
