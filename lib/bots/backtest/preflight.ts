/**
 * Before a bot is placed: what it costs to stand up, from the engine's own
 * figures — the rent of the accounts the build opens (the position's comes
 * back on close, a DLMM bin array's does not), the network's fee for the
 * transactions the Review built, the venue's minimum per order, and the SOL
 * the wallet must keep to pay for the next transaction. When what does not
 * come back is more than a share of the amount, the bot is «not worth it» at
 * this size.
 *
 * The figures come from the Review that already exists (Liquidity Studio's
 * preview `rent` and `networkFeeLamports`, the limits lane's
 * `depositLamports` and `networkFeeLamports`); this adds them up and judges.
 * Pure: it reads nothing and builds nothing.
 */

import type { RentCost } from "../../liquidity/studio/contract.ts";
import { DLMM_LIMIT_MAX_BINS, TRIGGER_V1_MIN_ORDER_USD } from "../../solana/limits/model.ts";
import { NATIVE_SOL_FEE_RESERVE_LAMPORTS } from "../../solana/send-inventory.ts";

/** By default a bot whose lost costs pass 2 % of its amount is not worth it. */
export const NOT_WORTH_SHARE = 0.02;

export type PreflightInput = Readonly<{
  /** What the bot puts to work, USD. */
  amountUsd: number;
  solUsd: number;
  rent: readonly RentCost[];
  networkFeeLamports: number | string;
  /** Each order's own amount, USD, where the venue has a minimum per order. */
  legsUsd?: readonly number[];
  venue?: "trigger" | "dlmm" | "pool";
  /** DLMM limits: the bins the orders take. */
  bins?: number;
  /** What the wallet holds in SOL, lamports; null — not read. */
  walletLamports?: number | string | null;
  /** SOL that leaves the wallet into the bot itself (a SOL-side deposit), lamports. */
  depositLamports?: number | string;
  reserveLamports?: number | string;
  notWorthShare?: number;
}>;

export type PreflightRefusal = "BELOW_VENUE_MINIMUM" | "TOO_MANY_BINS" | "SOL_SHORT";

export type Preflight = Readonly<{
  rentRefundableLamports: number;
  rentKeptLamports: number;
  networkLamports: number;
  reserveLamports: number;
  /** All the SOL the wallet needs for this, the deposit and the reserve in. */
  solNeededLamports: number;
  /** What does not come back, USD: kept rent and the network's fee. */
  lostUsd: number;
  /** Rent that comes back when the bot is closed, USD. */
  refundableUsd: number;
  /** lostUsd against the amount. */
  lostShare: number;
  notWorthIt: boolean;
  /** Orders under the venue's minimum, by index. */
  belowMinimum: readonly number[];
  refusals: readonly PreflightRefusal[];
}>;

const lamports = (value: number | string | null | undefined): number => {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function preflight(input: PreflightInput): Preflight {
  let refundable = 0;
  let kept = 0;
  for (const row of input.rent) {
    const amount = lamports(row.lamports) * (row.direction === "return" ? -1 : 1);
    if (row.refundable) refundable += amount;
    else kept += amount;
  }
  refundable = Math.max(0, refundable);
  kept = Math.max(0, kept);
  const network = lamports(input.networkFeeLamports);
  const reserve = input.reserveLamports === undefined ? Number(NATIVE_SOL_FEE_RESERVE_LAMPORTS) : lamports(input.reserveLamports);
  const solNeeded = refundable + kept + network + reserve + lamports(input.depositLamports);
  const toUsd = (value: number) => (value / 1e9) * (input.solUsd > 0 ? input.solUsd : 0);
  const lostUsd = toUsd(kept + network);
  const share = input.amountUsd > 0 ? lostUsd / input.amountUsd : Number.POSITIVE_INFINITY;
  const belowMinimum = input.venue === "trigger" ? (input.legsUsd ?? []).map((usd, index) => (usd < TRIGGER_V1_MIN_ORDER_USD ? index : -1)).filter((index) => index >= 0) : [];
  const refusals: PreflightRefusal[] = [];
  if (belowMinimum.length > 0) refusals.push("BELOW_VENUE_MINIMUM");
  if (input.venue === "dlmm" && (input.bins ?? 0) > DLMM_LIMIT_MAX_BINS) refusals.push("TOO_MANY_BINS");
  const wallet = input.walletLamports === null || input.walletLamports === undefined ? null : lamports(input.walletLamports);
  if (wallet !== null && wallet < solNeeded) refusals.push("SOL_SHORT");
  return {
    rentRefundableLamports: refundable,
    rentKeptLamports: kept,
    networkLamports: network,
    reserveLamports: reserve,
    solNeededLamports: solNeeded,
    lostUsd,
    refundableUsd: toUsd(refundable),
    lostShare: share,
    notWorthIt: share > (input.notWorthShare ?? NOT_WORTH_SHARE),
    belowMinimum,
    refusals,
  };
}
