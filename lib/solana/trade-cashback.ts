/**
 * The cashback each trade of a wallet earned, keyed by the trade's signature — what a receipt's execution truth
 * (SOL-X1) reads beside its own facts.
 *
 * Read-only over the Rewards ledger (the Growth line's): the rows are the wallet's own CASHBACK accruals, valued the way
 * the ledger values them (`effectiveRewardEntries`), summed per operation. A «First $10 back» rest that a cancelled
 * window took back is not the wallet's, unless an appeal gave it back — the same rule the Rewards view lists by. Nothing
 * here computes a reward: a trade with no row has none on record.
 *
 * Pure: the caller reads the entries.
 */

import type { CashbackByTrade } from "../core/execution-truth.ts";
import { effectiveRewardEntries } from "../rewards/ledger.ts";
import type { RewardEntry } from "../rewards/model.ts";

/**
 * Every trade of the wallet that has a cashback row, newest first — no cap: a trade left out would read «none on
 * record» on its receipt, which would be false. The bound is the contract's ceiling, as for the activity's actions.
 */
export function cashbackByTrade(entries: readonly RewardEntry[], wallet: string): readonly CashbackByTrade[] {
  /* A rest is held only while the wallet's «First $10 back» check is open: neither the pass, nor the refusal, nor an
     appeal's reinstatement is on the ledger — the fold `firstTenHeldUsdMicros` (lib/rewards/first-ten.ts) makes. */
  const stillHeld = !entries.some((entry) => entry.window === "FIRST_TEN_PASSED" || entry.window === "FIRST_TEN_VOID" || entry.window === "FIRST_TEN_REINSTATED");
  const voided = entries.some((entry) => entry.window === "FIRST_TEN_VOID") && !entries.some((entry) => entry.window === "FIRST_TEN_REINSTATED");
  const byTrade = new Map<string, { usdMicros: bigint | null; held: boolean; at: string }>();
  for (const entry of effectiveRewardEntries(entries)) {
    if (entry.type !== "CASHBACK" || entry.recipient !== wallet || !entry.source) continue;
    if (voided && entry.window === "FIRST_TEN_REST") continue;
    const signature = entry.source.operationRef;
    const previous = byTrade.get(signature);
    const micros = entry.usdMicros === null ? null : BigInt(entry.usdMicros);
    byTrade.set(signature, {
      /* An unvalued row leaves the sum unvalued: a dollar figure that left part of the cashback out would understate it. */
      usdMicros: previous === undefined ? micros : previous.usdMicros === null || micros === null ? null : previous.usdMicros + micros,
      held: stillHeld && ((previous?.held ?? false) || entry.window === "FIRST_TEN_REST"),
      at: previous && previous.at > entry.createdAt ? previous.at : entry.createdAt,
    });
  }
  return [...byTrade.entries()]
    .sort((left, right) => right[1].at.localeCompare(left[1].at))
    .map(([signature, row]) => ({ signature, usdMicros: row.usdMicros === null ? null : row.usdMicros.toString(), held: row.held }));
}
