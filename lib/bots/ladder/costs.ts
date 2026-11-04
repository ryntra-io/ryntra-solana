/**
 * The one line of costs before the signature (spec «Чесність і безпека»):
 * the rent that comes back, the network's fees, the protocol's minimum and the
 * SOL kept in the wallet — and whether the costs eat so much of the amount
 * that the bot is not advised.
 *
 * Exact from the plan and the pool's bin arrays that already exist: the order
 * account's rent is a known size (returned on cancel), a bin array the ladder
 * opens is a fixed rent the pool keeps (not returned), each transaction pays
 * the base fee for its two signatures — the wallet's and the order account's.
 * The server's simulation confirms the same figures before the wallet sees the
 * transactions (`build.server.ts`).
 *
 * Pure: no network, no clock.
 */

import { arraysOf, chunkRungs, needsBitmapExtension, type LegPlan } from "./plan.ts";

export const LAMPORTS_PER_SOL = 1_000_000_000;
/** Base fee per signature. */
export const SIGNATURE_LAMPORTS = 5_000;
/** The wallet's and the order account's. */
export const SIGNATURES_PER_TX = 2;
/** Rent-exempt lamports per byte, the account's 128-byte header included: 3 480 × 2 years. */
export const RENT_LAMPORTS_PER_BYTE = 6_960;
const ACCOUNT_HEADER_BYTES = 128;
/** A limit order account: 112 bytes and 32 per bin (lb_clmm 0.12.0, `LIMIT_ORDER_MIN_SIZE`, `LIMIT_ORDER_BIN_DATA_SIZE`). */
export const LIMIT_ORDER_BASE_BYTES = 112;
export const LIMIT_ORDER_BIN_BYTES = 32;
/** A new bin array's rent, kept by the pool (`BIN_ARRAY_FEE`, 0.07143744 SOL). */
export const BIN_ARRAY_RENT_LAMPORTS = 71_437_440;
/** The pool's bitmap extension, when a bin array lies beyond the default bitmap (`BIN_ARRAY_BITMAP_FEE`). */
export const BITMAP_EXTENSION_RENT_LAMPORTS = 11_804_160;
/** SOL left in the wallet after the start: enough to cancel every order and pay a few fees. */
export const SOL_RESERVE_LAMPORTS = 10_000_000;
/** Costs that never come back above this share of the amount: the bot is not advised. */
export const COST_SHARE_LIMIT_PCT = 3;
/** Jupiter Trigger V1's minimum per order, dollars — the fallback's protocol minimum. A DLMM limit order has none. */
export const TRIGGER_MIN_ORDER_USD = 5;

export const orderAccountRent = (bins: number): number => (LIMIT_ORDER_BASE_BYTES + LIMIT_ORDER_BIN_BYTES * bins + ACCOUNT_HEADER_BYTES) * RENT_LAMPORTS_PER_BYTE;

export type LadderCosts = Readonly<{
  transactions: number;
  /** Base fees of every signature, lamports. */
  networkLamports: number;
  /** The order accounts' rent: back on cancel. */
  rentBackLamports: number;
  /** New bin arrays and a bitmap extension the ladder opens: the pool keeps them. */
  rentKeptLamports: number;
  newArrays: number;
  /** Dollars per order the protocol asks at least; 0 — none. */
  minimumUsd: number;
  reserveLamports: number;
}>;

/**
 * Costs of placing legs, given which of the pool's bin arrays exist (`existing` — their indexes) and whether its
 * bitmap extension does. A bin array two legs both need is opened once.
 */
export function ladderCosts(
  plans: readonly LegPlan[],
  pool: Readonly<{ existingArrays: ReadonlySet<number>; bitmapExtension: boolean }>,
): LadderCosts {
  let transactions = 0;
  let rentBack = 0;
  const opened = new Set<number>();
  let extension = false;
  for (const plan of plans) {
    for (const chunk of chunkRungs(plan.rungs)) {
      transactions += 1;
      rentBack += orderAccountRent(chunk.length);
    }
    for (const index of arraysOf(plan.rungs)) {
      if (!pool.existingArrays.has(index)) opened.add(index);
      if (needsBitmapExtension(index) && !pool.bitmapExtension) extension = true;
    }
  }
  return {
    transactions,
    networkLamports: transactions * SIGNATURES_PER_TX * SIGNATURE_LAMPORTS,
    rentBackLamports: rentBack,
    rentKeptLamports: opened.size * BIN_ARRAY_RENT_LAMPORTS + (extension ? BITMAP_EXTENSION_RENT_LAMPORTS : 0),
    newArrays: opened.size,
    minimumUsd: 0,
    reserveLamports: SOL_RESERVE_LAMPORTS,
  };
}

/** SOL the wallet needs on top of the amount: fees, every rent (the returned one is held until cancel) and the reserve. */
export const solNeededLamports = (costs: LadderCosts): number => costs.networkLamports + costs.rentBackLamports + costs.rentKeptLamports + costs.reserveLamports;

export type CostVerdict = Readonly<{
  /** What never comes back — fees and the rent the pool keeps — in dollars. */
  spentUsd: number;
  sharePct: number;
  advised: boolean;
}>;

/** Whether the costs that never come back stay under the limit's share of the amount; unknown SOL price — not advised. */
export function costVerdict(costs: LadderCosts, amountUsd: number, solUsd: number, limitPct = COST_SHARE_LIMIT_PCT): CostVerdict {
  if (!(solUsd > 0) || !(amountUsd > 0)) return { spentUsd: Number.NaN, sharePct: Number.NaN, advised: false };
  const spentUsd = ((costs.networkLamports + costs.rentKeptLamports) / LAMPORTS_PER_SOL) * solUsd;
  const sharePct = (spentUsd / amountUsd) * 100;
  return { spentUsd, sharePct, advised: sharePct <= limitPct };
}

/** Two cost readings agree when the person would see the same line: the server's against the one shown. */
export function sameCosts(a: LadderCosts, b: LadderCosts): boolean {
  return a.transactions === b.transactions && a.networkLamports === b.networkLamports && a.rentBackLamports === b.rentBackLamports && a.rentKeptLamports === b.rentKeptLamports && a.minimumUsd === b.minimumUsd;
}

/** Whether a newer reading costs the person more than the line they saw: then the line is shown again before the wallet. */
export function costsRose(shown: LadderCosts, now: LadderCosts): boolean {
  return now.networkLamports + now.rentKeptLamports > shown.networkLamports + shown.rentKeptLamports || now.rentBackLamports > shown.rentBackLamports;
}
