import type { Leg } from './cards.ts';

/**
 * The wallet's own launch trades made in this browser (L8 · CITY-145): each the engine's own `filled` from the program's
 * event, kept by signature, so the round trip's card still finds the buy at birth once the market's newest rows have
 * moved past it. A fill only adds a trade the rows may be missing; the card is made only when the trades found add up
 * to the balance the chain shows (`roundTrip`), so a fill kept here can never make a round trip read better than it was.
 * Nothing here is sent anywhere.
 */

const KEY = 'ryntra:city:launch-fills';
/** Trades kept per wallet and coin, and wallet-coin pairs kept: the newest win. */
const PER_COIN = 40;
const COINS = 30;

type Kept = Record<string, Leg[]>;
export type FillStorage = Pick<Storage, 'getItem' | 'setItem'>;

const keyOf = (wallet: string, token: string) => `${wallet}:${token}`;

function browserStorage(): FillStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isLeg(value: unknown): value is Leg {
  const leg = value as Partial<Leg> | null;
  return (
    typeof leg?.signature === 'string' &&
    typeof leg.at === 'number' &&
    Number.isFinite(leg.at) &&
    (leg.side === 'buy' || leg.side === 'sell') &&
    (leg.venue === 'curve' || leg.venue === 'pool') &&
    typeof leg.tokensRaw === 'string' &&
    /^\d+$/.test(leg.tokensRaw) &&
    typeof leg.pairRaw === 'string' &&
    /^\d+$/.test(leg.pairRaw) &&
    leg.clock === 'device'
  );
}

function read(storage: FillStorage | null): Kept {
  try {
    const raw = JSON.parse(storage?.getItem(KEY) ?? '{}') as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const kept: Kept = {};
    for (const [key, legs] of Object.entries(raw)) if (Array.isArray(legs)) kept[key] = legs.filter(isLeg);
    return kept;
  } catch {
    return {};
  }
}

/** The fills this browser kept for a wallet on a coin, oldest first. */
export function fillsOf(wallet: string, token: string, storage: FillStorage | null = browserStorage()): readonly Leg[] {
  return read(storage)[keyOf(wallet, token)] ?? [];
}

/** Keep a fill; the same signature twice is kept once. */
export function keepFill(wallet: string, token: string, leg: Leg, storage: FillStorage | null = browserStorage()): void {
  if (!storage) return;
  const kept = read(storage);
  const key = keyOf(wallet, token);
  const legs = [...(kept[key] ?? []).filter((known) => known.signature !== leg.signature), leg].sort((a, b) => a.at - b.at).slice(-PER_COIN);
  delete kept[key];
  /* The pair just traded goes last, so the oldest pairs are the ones let go. */
  const pairs = [...Object.entries(kept), [key, legs] as const].slice(-COINS);
  try {
    storage.setItem(KEY, JSON.stringify(Object.fromEntries(pairs)));
  } catch {
    /* Not kept: the card then rests on the market's own rows alone. */
  }
}
