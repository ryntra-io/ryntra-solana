import { epochApyPercent, LSTS, rateOf, type LstId, type SolRate } from './lst.ts';
import type { StakePool } from './stake-pool.ts';

/**
 * The SOL Saver's yield feed (CITY-94), read-only: for each LST its worth in SOL and the last epoch's yield as a year's
 * rate, each with where it came from and when. The server builds it (`feed.server.ts`, `GET /api/city/earn`); the
 * window only shows it. A figure that was not read is null and the window hides it — no rate is ever made up.
 */

export type LstRow = Readonly<{
  id: LstId;
  /** Worth in SOL now; null when it was not read. */
  rate: SolRate | null;
  /** The last epoch's yield as a year's rate, per cent; null when it was not read. */
  apyPct: number | null;
  /** The pool's share of staking rewards, per cent, already out of the yield above; null when not stated. */
  rewardsFeePct: number | null;
  /** What the pool keeps on a direct unstake, per cent; null when not stated. */
  unstakeFeePct: number | null;
  /** Where the figures were read: the stake pool on chain, or Sanctum's public figures. */
  source: 'chain' | 'sanctum' | null;
  /** The epoch the figures stand at, when known. */
  epoch: number | null;
}>;

export type LstFeed = Readonly<{
  lsts: readonly LstRow[];
  /** The epochs a year at the slot time measured lately; null when not measured. */
  epochsPerYear: number | null;
  /** When the server read it, ISO. */
  at: string;
}>;

export const EMPTY_ROW = (id: LstId): LstRow => ({ id, rate: null, apyPct: null, rewardsFeePct: null, unstakeFeePct: null, source: null, epoch: null });

/**
 * A stake pool read into a feed row. The pool must name the LST's own mint, and its last update must be this epoch or
 * the one before; anything else yields no figures rather than old ones called fresh.
 */
export function rowFromPool(id: LstId, mint: string, pool: StakePool | null, epoch: bigint | null, perYear: number | null): LstRow {
  if (!pool || pool.poolMint !== mint) return EMPTY_ROW(id);
  const fresh = epoch === null || pool.lastUpdateEpoch + 1n >= epoch;
  return {
    id,
    rate: fresh ? pool.now : null,
    apyPct: fresh ? epochApyPercent(pool.now, pool.before, perYear) : null,
    rewardsFeePct: pool.rewardsFeePct,
    unstakeFeePct: pool.solWithdrawalFeePct,
    source: 'chain',
    epoch: Number(pool.lastUpdateEpoch),
  };
}

const finite = (value: unknown): number | null => {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/**
 * Sanctum's public answers for one LST into a feed row: `apys` as a fraction of the latest epoch's yield over a year,
 * `solValues` as the lamports one whole token is worth. A missing or malformed figure stays null.
 */
export function rowFromSanctum(id: LstId, symbol: string, decimals: number, apys: unknown, solValues: unknown): LstRow {
  const apyMap = apys && typeof apys === 'object' ? (apys as Record<string, unknown>) : {};
  const valueMap = solValues && typeof solValues === 'object' ? (solValues as Record<string, unknown>) : {};
  const apy = finite(apyMap[symbol]);
  const value = valueMap[symbol];
  const lamports = typeof value === 'string' || typeof value === 'number' ? String(value).split('.')[0]! : '';
  const rate = /^\d{1,24}$/.test(lamports) ? rateOf(lamports, 10n ** BigInt(decimals)) : null;
  const apyPct = apy !== null && apy > -0.5 && apy < 1 ? apy * 100 : null;
  if (!rate && apyPct === null) return EMPTY_ROW(id);
  return { id, rate, apyPct, rewardsFeePct: null, unstakeFeePct: null, source: 'sanctum', epoch: null };
}

/** The feed as the window reads it from the route: every LST in the catalogue, in its order, each row checked. */
export function readFeed(raw: unknown): LstFeed | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.lsts) || typeof value.at !== 'string') return null;
  const rows = new Map<string, LstRow>();
  for (const entry of value.lsts) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    const lst = LSTS.find((l) => l.id === row.id);
    if (!lst) continue;
    const rateRaw = row.rate as Record<string, unknown> | null;
    const rate = rateRaw && typeof rateRaw === 'object' && typeof rateRaw.lamports === 'string' && typeof rateRaw.supply === 'string' ? rateOf(rateRaw.lamports, rateRaw.supply) : null;
    rows.set(lst.id, {
      id: lst.id,
      rate,
      apyPct: finite(row.apyPct),
      rewardsFeePct: finite(row.rewardsFeePct),
      unstakeFeePct: finite(row.unstakeFeePct),
      source: row.source === 'chain' || row.source === 'sanctum' ? row.source : null,
      epoch: finite(row.epoch),
    });
  }
  return { lsts: LSTS.map((lst) => rows.get(lst.id) ?? EMPTY_ROW(lst.id)), epochsPerYear: finite(value.epochsPerYear), at: value.at };
}

/** The LST with the highest rate that was read; the first of the catalogue when none was. */
export function bestLst(feed: LstFeed | null): LstId {
  const read = (feed?.lsts ?? []).filter((row) => row.apyPct !== null && row.rate !== null);
  read.sort((a, b) => (b.apyPct ?? 0) - (a.apyPct ?? 0));
  return read[0]?.id ?? LSTS[0]!.id;
}
