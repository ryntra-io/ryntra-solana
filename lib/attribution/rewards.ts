/**
 * Rewards by operation — what the reward ledger credited for each operation,
 * in dollars, keyed by the reference the reward names (a signature, or a
 * bridge's source transaction).
 *
 * Pure: the reward rows are read by the caller. The ledger is the growth
 * module's; this module only reads it, through its own rule for a later
 * valuation (`effectiveRewardEntries`), so a figure here is the figure the
 * person's own Rewards page adds up.
 */

import type { OperationRewards } from "../analytics/operations.ts";
import { effectiveRewardEntries } from "../rewards/ledger.ts";
import type { RewardEntry } from "../rewards/model.ts";

/**
 * Every operation's rewards, from the reward ledger: cashback, and the two
 * levels of friends' rewards together, in dollars, by the reference each
 * reward names. A claim is a payout, not an earning, and is not here.
 */
export function rewardsByOperation(entries: readonly RewardEntry[]): ReadonlyMap<string, OperationRewards> {
  const totals = new Map<string, { cashback: bigint; friends: bigint; unvalued: number; feeMicros: bigint | null }>();
  /* `unvalued` counts the cashback alone: how many friends' rewards an operation carries would say how many inviters its trader has. */
  for (const entry of effectiveRewardEntries(entries)) {
    if (!entry.source || (entry.type !== "CASHBACK" && entry.type !== "REFERRAL_L1" && entry.type !== "REFERRAL_L2")) continue;
    const ref = entry.source.operationRef;
    const total = totals.get(ref) ?? { cashback: 0n, friends: 0n, unvalued: 0, feeMicros: null };
    totals.set(ref, total);
    if (entry.usdMicros === null) {
      if (entry.type === "CASHBACK") total.unvalued += 1;
      continue;
    }
    if (entry.type === "CASHBACK") {
      total.cashback += BigInt(entry.usdMicros);
      /* The cashback is a known share of the gross fee: the ledger's valuation of that fee at settlement. */
      if (entry.rateBps > 0) total.feeMicros = (BigInt(entry.usdMicros) * 10_000n) / BigInt(entry.rateBps);
    } else total.friends += BigInt(entry.usdMicros);
  }
  const result = new Map<string, OperationRewards>();
  for (const [ref, total] of totals) {
    result.set(ref, {
      cashbackUsd: Number(total.cashback) / 1_000_000,
      friendsUsd: Number(total.friends) / 1_000_000,
      unvalued: total.unvalued,
      feeUsd: total.feeMicros === null ? null : Number(total.feeMicros) / 1_000_000,
    });
  }
  return result;
}
