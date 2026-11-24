import { careShown, type CareRow, type CareStop } from '../../city/lib/earn/care.ts';

/**
 * «Your agent looks after it» on a pool's ticket: the person turns it on, picks the stop and gives the SOL to her agent
 * with one signature; the agent opens the position, claims the fees, keeps the range around the price and leaves at
 * her stop. The logic is the city's as it is (`city/lib/earn/care.ts`, the engine `lib/care/**`); here is only what the
 * ticket decides from it. Pure: the ticket and the tests read it as it is.
 */

/** The widths the agent keeps, in steps of the price (the engine's own bounds, `lib/care/service.server.ts`). */
export const CARE_WIDTH_MIN = 6;
export const CARE_WIDTH_MAX = 69;

/** The range's width the agent is given: the ticket's half on each side of the price and the price's own step. */
export const careWidthOf = (half: number): number => half * 2 + 1;

export const careWidthFits = (width: number): boolean => Number.isInteger(width) && width >= CARE_WIDTH_MIN && width <= CARE_WIDTH_MAX;

/** The stops as the segment names them. */
export const CARE_STOP_IDS = ['0', '10', '25'] as const satisfies readonly `${CareStop}`[];
export type CareStopId = (typeof CARE_STOP_IDS)[number];

export const careStopOf = (id: CareStopId): CareStop => Number(id) as CareStop;

/**
 * Why giving the SOL to the agent cannot go yet, or null when it can. The pool's own ceiling for a plain deposit is not
 * the care's: the care is its own door.
 */
export function careBlock(input: Readonly<{ lamports: bigint | null; problem: string | null; width: number }>): 'amount' | 'width' | null {
  if (input.problem && input.problem !== 'ceiling') return 'amount';
  if (!input.lamports || input.lamports <= 0n) return 'amount';
  if (!careWidthFits(input.width)) return 'width';
  return null;
}

/**
 * The cares on this pool for the wallet, as the engine answered: each at work stands on the ticket with its «Stop»; one
 * stopped whose rules or money the chain still carries stands with «Withdraw», until everything is back.
 */
export function caredHere(cares: readonly CareRow[] | null, pool: string): CareRow[] {
  return (cares ?? []).filter((care) => careShown(care) && care.pool === pool);
}

/** What the agent took and put back today, in SOL; null — nothing yet. */
export function careDaySol(care: Pick<CareRow, 'day'>): number | null {
  const sol = care.day.claimedInY + care.day.reinvestedInY;
  return Number.isFinite(sol) && sol > 0 ? sol : null;
}
