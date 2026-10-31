import { readEntry, type PositionEntry } from '../../../lib/liquidity/catalog/track.ts';
import { mergeSteps, readStep, type MultiplierStep } from './corporate.ts';
import { isProduct, type ProductId } from './flag.ts';
import { readLots, type SaverLot } from './mine.ts';

/**
 * What Earn keeps on this device, every read and write in try/catch — a private window or blocked site data gives an
 * empty answer, never an error, and the window then says a figure is not measured rather than guessing it:
 *
 * - the SOL Saver's lots per wallet (the chain keeps no record of what a purchase cost);
 * - the Scaled UI multiplier steps seen for each stock, so the dividend history grows with every visit;
 * - the products the person asked to hear about when they open;
 * - SOL-2b's entries per wallet (`ryntra.pools.entries.v1:`), read only — written where the pool position was opened.
 */

const LOTS = 'ryntra.city.earn.saver.v1:';
const STEPS = 'ryntra.city.earn.multipliers.v1';
const WISHES = 'ryntra.city.earn.notify.v1';
const ENTRIES = 'ryntra.pools.entries.v1:';
/** The most lots a wallet keeps on the device. */
const MAX_LOTS = 200;

function read(key: string): unknown {
  try {
    return JSON.parse(window.localStorage.getItem(key) ?? 'null') as unknown;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Without storage the figure is simply not measured on the next visit.
  }
}

export function lotsOf(owner: string): SaverLot[] {
  return readLots(read(LOTS + owner));
}

/** A purchase that landed: kept once by its signature. */
export function keepLot(owner: string, lot: SaverLot): SaverLot[] {
  const lots = lotsOf(owner).filter((known) => known.signature !== lot.signature);
  const next = [...lots, lot].slice(-MAX_LOTS);
  write(LOTS + owner, next);
  return next;
}

export function stepsSeen(): MultiplierStep[] {
  const raw = read(STEPS);
  return Array.isArray(raw) ? raw.map(readStep).filter((step): step is MultiplierStep => step !== null) : [];
}

export function keepSteps(fresh: readonly MultiplierStep[]): MultiplierStep[] {
  const merged = mergeSteps(stepsSeen(), fresh);
  if (fresh.length) write(STEPS, merged);
  return merged;
}

export function wishes(): Set<ProductId> {
  const raw = read(WISHES);
  return new Set(Array.isArray(raw) ? raw.filter(isProduct) : []);
}

export function keepWishes(next: ReadonlySet<ProductId>): void {
  write(WISHES, [...next]);
}

/** SOL-2b's entries for a wallet's positions, by position address. */
export function entriesOf(owner: string): ReadonlyMap<string, PositionEntry> {
  const raw = read(ENTRIES + owner);
  const out = new Map<string, PositionEntry>();
  if (!raw || typeof raw !== 'object') return out;
  for (const [position, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = readEntry(value);
    if (entry) out.set(position, entry);
  }
  return out;
}
