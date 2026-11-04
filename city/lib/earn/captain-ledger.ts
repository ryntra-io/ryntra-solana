import { positionView } from '../../../lib/liquidity/catalog/positions.ts';
import type { PoolRecordRead } from '../../../lib/liquidity/catalog/service.server.ts';
import type { LiquidityPosition } from '../../../lib/liquidity/studio/contract.ts';
import { harborPool } from '../districts/harbor/pools.ts';
import { dayPoints, isAddress, newCopy, passCopy, provenStrategies, type CaptainAnswer, type CopyRecord, type SeenPosition } from './captain.ts';
import type { CaptainStore, ReportState } from './captain-store.ts';
import { isPierStyle, pierOf, type PierStyle } from './pier.ts';

/**
 * «Like the Captain»'s ledger at work (CITY-99): the city's report of a copy, the daily pass that holds every copy to
 * the chain, and the record the window reads. The reads are passed in — on the server the engine's own and read-only
 * (`captain.server.ts`): the wallet's DLMM positions from the program's accounts and the venue's record of the pool with
 * its prices, seen through SOL-2b's view (`positionView`). Nothing here builds, signs or sends.
 */

export type CaptainDeps = Readonly<{
  /** Every position a wallet holds on DLMM; null when the chain did not answer. */
  positions: (owner: string) => Promise<readonly LiquidityPosition[] | null>;
  /** The venue's record of a pool, with its prices. */
  record: (pool: string) => Promise<PoolRecordRead>;
  now: () => number;
}>;

/** A pool the city calls a SOL pier now: DLMM, verified and deep, SOL against an LST of the Saver or USDC. */
export function isSolPier(read: PoolRecordRead): boolean {
  const pool = read.pool ? harborPool(read.pool) : null;
  return pool !== null && pierOf(pool) !== null;
}

/** A wallet's DLMM position as SOL-2b sees it, with its bins, for one copy's pass. */
export function seenOf(position: LiquidityPosition, read: PoolRecordRead): SeenPosition {
  const view = positionView(position, 'dlmm', read.pool, read.at);
  return { ...view, owner: position.owner, bins: position.range.kind === 'bins' ? { lower: position.range.lowerBin, upper: position.range.upperBin } : null };
}

export type ReportInput = Readonly<{ owner: string; position: string; pool: string; style: PierStyle }>;

export function readReport(body: unknown): ReportInput | null {
  if (!body || typeof body !== 'object') return null;
  const v = body as Record<string, unknown>;
  if (!isAddress(v.owner) || !isAddress(v.position) || !isAddress(v.pool) || !isPierStyle(v.style) || v.owner === v.position) return null;
  return { owner: v.owner, position: v.position, pool: v.pool, style: v.style };
}

export type ReportOutcome = Readonly<{ ok: true; state: ReportState | 'counted' }> | Readonly<{ ok: false; code: 'NOT_A_PIER' }>;

/**
 * The city's word that an add landed: kept only on a SOL pier, then held to the chain at once — a position the chain
 * already shows as the recipe counts from now; one it does not show yet (an endpoint a moment behind) waits for the pass.
 */
export async function reportCopy(store: CaptainStore, input: ReportInput, deps: CaptainDeps): Promise<ReportOutcome> {
  const read = await deps.record(input.pool);
  if (!isSolPier(read)) return { ok: false, code: 'NOT_A_PIER' };
  const now = deps.now();
  const state = await store.report(newCopy(input, now), now);
  if (state !== 'added') return { ok: true, state };
  const positions = await deps.positions(input.owner).catch(() => null);
  const found = positions?.find((p) => p.address === input.position) ?? null;
  const copy = found ? (await store.copies()).find((c) => c.position === input.position) : undefined;
  if (!copy || !found) return { ok: true, state };
  const pass = passCopy(copy, seenOf(found, read), true, deps.now());
  if (pass.kind === 'live') {
    await store.save([pass.copy], [], deps.now());
    return { ok: true, state: 'counted' };
  }
  if (pass.kind === 'drop') await store.save([], [copy.position], deps.now());
  return { ok: true, state };
}

export type PassSummary = Readonly<{ copies: number; owners: number; read: number; live: number; closed: number; dropped: number; points: number }>;

/** Wallets read at once in a pass, and how long a pass may read before it stops and leaves the rest for the next. */
const OWNERS_AT_ONCE = 3;
export const PASS_MS = 45_000;

/**
 * The daily pass: each wallet with an open copy read once from the chain; each copy confirmed, measured, closed or
 * dropped; today's point of every strategy written from its live copies. A wallet the chain did not answer for is left
 * as it was, and a pass cut short by time leaves the rest unread — never guessed.
 */
export async function runPass(store: CaptainStore, deps: CaptainDeps): Promise<PassSummary> {
  const started = deps.now();
  const copies = await store.copies();
  const open = copies.filter((c) => c.closedAt === null);
  const owners = [...new Set(open.map((c) => c.owner))];
  const pools = new Map<string, Promise<PoolRecordRead>>();
  const recordOf = (pool: string) => {
    const known = pools.get(pool) ?? deps.record(pool);
    pools.set(pool, known);
    return known;
  };
  const updated: CopyRecord[] = [];
  const dropped: string[] = [];
  let read = 0;
  let live = 0;
  let closed = 0;
  let next = 0;
  const worker = async () => {
    while (next < owners.length && deps.now() - started < PASS_MS) {
      const owner = owners[next++]!;
      const positions = await deps.positions(owner).catch(() => null);
      if (positions) read += 1;
      for (const copy of open.filter((c) => c.owner === owner)) {
        const found = positions?.find((p) => p.address === copy.position) ?? null;
        const seen = found ? seenOf(found, await recordOf(found.pool)) : null;
        const pass = passCopy(copy, seen, positions !== null, deps.now());
        if (pass.kind === 'drop') dropped.push(copy.position);
        else if (pass.copy !== copy) updated.push(pass.copy);
        if (pass.kind === 'live') live += 1;
        if (pass.kind === 'closed') closed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: OWNERS_AT_ONCE }, worker));
  const now = deps.now();
  await store.save(updated, dropped, now);
  const byPosition = new Map(updated.map((c) => [c.position, c]));
  const points = dayPoints(copies.map((c) => byPosition.get(c.position) ?? c), now);
  await store.putPoints(points);
  return { copies: copies.length, owners: owners.length, read, live, closed, dropped: dropped.length, points: points.length };
}

/** The record the window reads: the strategies with a proven record only, best first. */
export async function readRecord(store: CaptainStore, counting: boolean, now: number): Promise<CaptainAnswer> {
  if (!counting) return { strategies: [], counting, at: now };
  const [copies, points] = await Promise.all([store.copies(), store.points('2000-01-01')]);
  return { strategies: provenStrategies(copies, points, now), counting, at: now };
}
