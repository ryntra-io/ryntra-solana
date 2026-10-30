import { wordsNow } from '../i18n/dict.ts';
import { basisOf, type Basis, type HistoryTrade } from '../trade/mine.ts';
import type { ChartLayer } from './layers.ts';
import { CHART_MARKS } from './words.ts';

/**
 * «Your entry» on a tower's chart: what the coins the wallet holds now cost on average, in dollars. It is the cost
 * «Mine» (CITY-7) measures — `basisOf` over the engine's record of the wallet's own Ryntra trades — and it is said only
 * when that record covers the whole balance; a coin that also came from elsewhere has no entry here, never a guessed
 * one. Reading only: the chart never asks the wallet to prove itself; without the proof there is no entry.
 */

/** The average price paid for the coins held: the dollars they cost over how many there are. Null without a basis. */
export function entryPrice(basis: Basis | null | undefined, decimals: number): number | null {
  if (!basis || !Number.isInteger(decimals) || decimals < 0 || decimals > 30) return null;
  const coins = Number(basis.quantityRaw) / 10 ** decimals;
  const dollars = Number(basis.costMicros) / 1e6;
  const price = dollars / coins;
  return Number.isFinite(price) && price > 0 ? price : null;
}

/** How far the price moved from the entry, per cent; null when either is missing. */
export function entryMove(entry: number | null, price: number | null): number | null {
  if (entry === null || price === null || !Number.isFinite(price) || price <= 0) return null;
  return (price / entry - 1) * 100;
}

/** The chart's «Entry» layer: the entry as a level across the candles; none without an entry. */
export function entryLayer(mint: string, entry: number | null): ChartLayer | null {
  if (entry === null) return null;
  const w = wordsNow(CHART_MARKS);
  return { id: 'entry', label: w.entry, mint, levels: [{ id: 'average', price: entry, label: w.yourEntry }] };
}

/**
 * The cost «Mine» already read, if it read it for this wallet and this very balance: a basis, `null` when the engine
 * said it cannot know, `undefined` when «Mine» has not read this coin (the chart then reads it itself).
 */
export function knownBasis(
  mine: Readonly<{ owner: string | null; status: string; against: string; bases: ReadonlyMap<string, Basis | null> }>,
  owner: string,
  mint: string,
  balanceRaw: string,
): Basis | null | undefined {
  if (mine.owner !== owner || mine.status !== 'ready' || !mine.against.split(',').includes(`${mint}:${balanceRaw}`)) return undefined;
  return mine.bases.has(mint) ? (mine.bases.get(mint) ?? null) : undefined;
}

export type EntryRead = Readonly<{ kind: 'basis'; basis: Basis | null } | { kind: 'proof' } | { kind: 'failed' }>;

type Answer = Readonly<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * One read of the wallet's trades of one coin — the engine's `/api/growth/cards`, the same read «Mine» makes — and the
 * cost of the balance it holds now. `proof` when the wallet has not proved itself to Ryntra in this browser.
 */
export async function readEntryBasis(owner: string, mint: string, balanceRaw: string, fetch: (url: string) => Promise<Answer>): Promise<EntryRead> {
  let answer: Answer;
  try {
    answer = await fetch(`/api/growth/cards?${new URLSearchParams({ address: owner, mint })}`);
  } catch {
    return { kind: 'failed' };
  }
  if (answer.status === 401) return { kind: 'proof' };
  if (!answer.ok) return { kind: 'failed' };
  let body: { trades?: unknown; complete?: unknown };
  try {
    body = ((await answer.json()) ?? {}) as typeof body;
  } catch {
    return { kind: 'failed' };
  }
  if (!Array.isArray(body.trades)) return { kind: 'failed' };
  return { kind: 'basis', basis: basisOf(body.trades as HistoryTrade[], mint, balanceRaw, body.complete === true) };
}
