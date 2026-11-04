import { readEntry, type PositionEntry } from '../../../lib/liquidity/catalog/track.ts';
import { mergeSteps, readStep, type MultiplierStep } from './corporate.ts';
import { isProduct, type ProductId } from './flag.ts';
import { readLots, type SaverLot } from './mine.ts';
import { isClosePlan, type ClosePlan } from './stock-pier-hours.ts';
import { readRecord, type PlacedRecord } from './limit.ts';

/**
 * What Earn keeps on this device, every read and write in try/catch — a private window or blocked site data gives an
 * empty answer, never an error, and the window then says a figure is not measured rather than guessing it:
 *
 * - the SOL Saver's lots per wallet (the chain keeps no record of what a purchase cost);
 * - the Scaled UI multiplier steps seen for each stock, so the dividend history grows with every visit;
 * - the products the person asked to hear about when they open;
 * - SOL-2b's entries per wallet (`ryntra.pools.entries.v1:`), read only — written where the pool position was opened;
 * - the Stock Pier's plan for the exchange's close, per wallet and pier (CITY-98): stay, or step out before it.
 */

const LOTS = 'ryntra.city.earn.saver.v1:';
const STEPS = 'ryntra.city.earn.multipliers.v1';
const WISHES = 'ryntra.city.earn.notify.v1';
const ENTRIES = 'ryntra.pools.entries.v1:';
const PLANS = 'ryntra.city.earn.stockpier.v1:';
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

/** The Stock Pier's plans for the close of one wallet, by pier address. */
export function plansOf(owner: string): ReadonlyMap<string, ClosePlan> {
  const raw = read(PLANS + owner);
  const out = new Map<string, ClosePlan>();
  if (!raw || typeof raw !== 'object') return out;
  for (const [pool, plan] of Object.entries(raw as Record<string, unknown>)) if (isClosePlan(plan)) out.set(pool, plan);
  return out;
}

export function keepPlan(owner: string, pool: string, plan: ClosePlan): ReadonlyMap<string, ClosePlan> {
  const next = new Map(plansOf(owner));
  next.set(pool, plan);
  write(PLANS + owner, Object.fromEntries(next));
  return next;
}

const PLACED = 'ryntra.city.earn.limits.v1:';
/** The most order records a wallet keeps on the device. */
const MAX_PLACED = 100;

/**
 * Sell Higher's orders placed here (CITY-97), per wallet, by order: the target per unit and the multiplier they were
 * set at — the chain keeps neither, and «set it again» needs both once the multiplier moves.
 */
export function placedOf(owner: string): ReadonlyMap<string, PlacedRecord> {
  const raw = read(PLACED + owner);
  const out = new Map<string, PlacedRecord>();
  if (!Array.isArray(raw)) return out;
  for (const value of raw) {
    const record = readRecord(value);
    if (record) out.set(record.order, record);
  }
  return out;
}

export function keepPlaced(owner: string, record: PlacedRecord): void {
  const known = [...placedOf(owner).values()].filter((r) => r.order !== record.order);
  write(PLACED + owner, [...known, record].slice(-MAX_PLACED));
}
