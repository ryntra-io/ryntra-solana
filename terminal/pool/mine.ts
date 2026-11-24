import type { ProBoat } from '../../city/lib/earn/pro.ts';
import type { PositionView } from '../../lib/liquidity/catalog/positions.ts';
import type { PoolResult, ProLedger } from '../../lib/portfolio/pool-result.ts';
import type { PositionRow } from '../earn/rows.ts';
import type { MineRange } from './pool-view.ts';

/**
 * One of the person's own positions in the pool on the pool's page: its range over «Liquidity by price», in
 * range or not, what it is worth now, the fees it holds to collect, and — for a DLMM Pro position this device saw open —
 * its result against holding and its history. Every figure is the engine's read or this device's entry; nothing is
 * worked out that the venue did not state. Pure: the screen and the tests read it alike.
 */
export type MineEntry = Readonly<{
  key: string;
  /** The range in the pool's own terms, «1.2583 – 1.2623»; null on the plain curve. */
  mark: string | null;
  /** The range as the pool states it, Y per X; null on the plain curve (DAMM v2's whole range). */
  range: MineRange | null;
  /** Inside its range now; null where there is no range. */
  inRange: boolean | null;
  nowUsd: number | null;
  /** The fees it holds to collect now, dollars; null where they were not read. */
  unclaimedUsd: number | null;
  /** A DLMM Pro position's whole result, in SOL; null where not known. */
  result: PoolResult | null;
  /** What this device saw of it: when it opened, what went in, the fees taken and put back; null where it saw nothing. */
  history: Readonly<{ openedAt: number; inUsd: number | null; collectedUsd: number | null; addedUsd: number | null }> | null;
}>;

type Mark = (lower: number | null, upper: number | null) => string | null;
type Usd = (lamports: bigint) => number | null;

const RAW = /^\d{1,30}$/;
const lamportsOf = (value: string): bigint | null => (RAW.test(value) ? BigInt(value) : null);

const rangeOf = (lower: number | null, upper: number | null): MineRange | null => (lower !== null && upper !== null && lower > 0 && upper >= lower ? { lower, upper } : null);

/** A DLMM Pro position: the engine's pier read, the row «My positions» draws, and this device's entry where it has one. */
export function mineEntryOfPro(boat: ProBoat, row: PositionRow, ledger: ProLedger | null, usd: Usd, mark: Mark): MineEntry {
  const fees = lamportsOf(boat.fees.lamports);
  const usable = ledger !== null && !ledger.lost && ledger.nftMint === boat.nftMint;
  const sum = (value: string) => {
    const lamports = lamportsOf(value);
    return lamports === null ? null : usd(lamports);
  };
  return {
    key: `pro:${boat.nftMint}`,
    mark: mark(boat.lowerPrice, boat.upperPrice),
    range: rangeOf(boat.lowerPrice, boat.upperPrice),
    inRange: boat.inRange,
    nowUsd: row.nowUsd,
    unclaimedUsd: fees === null ? null : usd(fees),
    result: row.result ?? null,
    history: usable ? { openedAt: ledger.openedAt, inUsd: sum(ledger.in.lamports), collectedUsd: sum(ledger.collectedLamports), addedUsd: sum(ledger.addedLamports) } : null,
  };
}

/** A DLMM or DAMM v2 position from the wallet's positions: the venue's dollars, its range and its state. */
export function mineEntryOfView(view: PositionView, mark: Mark): MineEntry {
  const range = rangeOf(view.lower, view.upper);
  return {
    key: `pool:${view.address}`,
    mark: mark(view.lower, view.upper),
    range,
    inRange: range ? view.rangeState === 'in_range' : null,
    nowUsd: view.valueUsd,
    unclaimedUsd: view.unclaimedUsd,
    result: null,
    history: null,
  };
}
