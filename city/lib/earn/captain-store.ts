import { isPierStyle } from './pier.ts';
import { isAddress, readRecipeId, type CopyEntry, type CopyRecord, type CopyResult, type StrategyPoint } from './captain.ts';

/**
 * What «Like the Captain» keeps (CITY-99): the copies the city reported and what the chain made of them, and one point
 * a day per strategy. A deployment keeps it in the database (`captain-db.ts`,
 * `supabase/migrations/20261031120000_city_earn_captain_v1.sql`) so every server instance and the daily pass see one
 * ledger. This file also has the memory store — tests and a developer's machine only: it lives as long as one warm
 * instance, so production never counts on it (`captainReady`).
 */

export type ReportState = 'added' | 'known' | 'limit';

export interface CaptainStore {
  /** True for a store every server instance shares (the database); false for one instance's memory. */
  readonly durable: boolean;
  /** A copy the city reported; a position already known keeps its first report. Refused past a wallet's daily limit. */
  report(copy: CopyRecord, now: number): Promise<ReportState>;
  /** Every copy kept: the pass's work and the record's wallets. */
  copies(): Promise<CopyRecord[]>;
  /** A pass's work: copies as the chain left them, and unconfirmed ones dropped. Who, where and which recipe never change. */
  save(updated: readonly CopyRecord[], dropped: readonly string[], now: number): Promise<void>;
  /** Points of the day; a later pass on the same day replaces its strategy's point. */
  putPoints(points: readonly StrategyPoint[]): Promise<void>;
  /** Points from this day on (YYYY-MM-DD). */
  points(since: string): Promise<StrategyPoint[]>;
}

export class CaptainStoreUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaptainStoreUnavailable';
  }
}

/** Reports a wallet may make in a day: a person copies a few strategies, not hundreds. */
export const REPORTS_PER_DAY = 12;
/** Unconfirmed copies the ledger holds at once, across wallets. */
export const PENDING_MAX = 2_000;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

function entryOf(value: unknown): CopyEntry | null {
  const v = record(value);
  if (!v || !finite(v.x) || !finite(v.y) || !finite(v.usd) || !finite(v.at) || typeof v.lamports !== 'string' || !/^\d{1,30}$/.test(v.lamports)) return null;
  if (v.x < 0 || v.y < 0 || !(v.usd > 0)) return null;
  return { x: v.x, y: v.y, usd: v.usd, lamports: v.lamports, at: v.at };
}

function resultOf(value: unknown): CopyResult | null {
  const v = record(value);
  return v && finite(v.holdUsd) && finite(v.netUsd) && finite(v.feesUsd) && finite(v.at) ? { holdUsd: v.holdUsd, netUsd: v.netUsd, feesUsd: v.feesUsd, at: v.at } : null;
}

/** A copy as stored, checked field by field; anything else is no copy and is left out. */
export function copyOfRow(value: unknown): CopyRecord | null {
  const v = record(value);
  if (!v || !isAddress(v.position) || !isAddress(v.owner) || !isAddress(v.pool) || !isPierStyle(v.style) || !finite(v.addedAt)) return null;
  const fees = record(v.seenFees);
  return {
    position: v.position,
    owner: v.owner,
    pool: v.pool,
    style: v.style,
    addedAt: v.addedAt,
    entry: entryOf(v.entry),
    claimedUsd: finite(v.claimedUsd) && v.claimedUsd >= 0 ? v.claimedUsd : 0,
    seenFees: fees && finite(fees.x) && finite(fees.y) ? { x: fees.x, y: fees.y } : null,
    closedAt: finite(v.closedAt) ? v.closedAt : null,
    last: resultOf(v.last),
  };
}

/** A point as stored; anything else is left out. */
export function pointOfRow(value: unknown): StrategyPoint | null {
  const v = record(value);
  if (!v || !readRecipeId(v.strategy) || typeof v.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v.day)) return null;
  if (!finite(v.copies) || !finite(v.holdUsd) || !finite(v.netUsd) || !finite(v.feesUsd) || !finite(v.at)) return null;
  return { strategy: v.strategy as string, day: v.day, copies: v.copies, holdUsd: v.holdUsd, netUsd: v.netUsd, feesUsd: v.feesUsd, at: v.at };
}

const DAY_MS = 86_400_000;

/** One instance's memory: the same rules the database keeps, for tests and a developer's machine. */
export function createMemoryCaptainStore(): CaptainStore {
  const copies = new Map<string, CopyRecord>();
  const points = new Map<string, StrategyPoint>();
  return {
    durable: false,
    async report(copy, now) {
      if (copies.has(copy.position)) return 'known';
      const today = [...copies.values()].filter((c) => c.owner === copy.owner && now - c.addedAt < DAY_MS).length;
      const pending = [...copies.values()].filter((c) => c.entry === null).length;
      if (today >= REPORTS_PER_DAY || pending >= PENDING_MAX) return 'limit';
      copies.set(copy.position, copy);
      return 'added';
    },
    async copies() {
      return [...copies.values()];
    },
    async save(updated, dropped) {
      for (const next of updated) {
        const known = copies.get(next.position);
        if (!known) continue;
        copies.set(next.position, { ...next, position: known.position, owner: known.owner, pool: known.pool, style: known.style, addedAt: known.addedAt });
      }
      for (const position of dropped) if (copies.get(position)?.entry === null) copies.delete(position);
    },
    async putPoints(list) {
      for (const point of list) points.set(`${point.strategy}|${point.day}`, point);
    },
    async points(since) {
      return [...points.values()].filter((point) => point.day >= since);
    },
  };
}

type Env = Record<string, string | undefined>;

/**
 * The database wherever a deployment runs; on a developer's machine the memory store, unless
 * `RYNTRA_CITY_CAPTAIN_STORE=database` asks for the database there too. Without the database's settings it is memory
 * everywhere — and then production does not count (`captainReady`).
 */
export function captainStoreKind(env: Env): 'database' | 'memory' {
  const configured = !!(env.SUPABASE_URL && env.SUPABASE_ANON_KEY && env.BETA_APP_SECRET);
  const wanted = env.NODE_ENV === 'production' || env.RYNTRA_CITY_CAPTAIN_STORE === 'database';
  return configured && wanted ? 'database' : 'memory';
}

/**
 * Whether copies are counted: Earn must be open (`NEXT_PUBLIC_RYNTRA_CITY_EARN`), and in production the store must be
 * the database — one instance's memory would give each instance its own ledger and the daily pass none of it.
 */
export function captainReady(store: Pick<CaptainStore, 'durable'>, earn: string | undefined, mode: string | undefined): boolean {
  return earn?.trim() === 'open' && (store.durable || mode !== 'production');
}
