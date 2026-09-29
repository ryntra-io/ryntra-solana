import {
  formatUsdMicros,
  REWARD_MINIMUM_CLAIM_USD_MICROS,
  type RewardEntry,
} from "./model.ts";
import { totalRewards, type RewardTotals } from "./ledger.ts";

/**
 * What a person may actually claim, which is not the same as what they earned.
 *
 * ## Available is bounded by money that is free, not merely money that exists
 *
 * The owner's instruction is that `Available` cannot exceed the payout reserve
 * that is actually funded. The first version of this module read that as *the
 * treasury balance* and was wrong across users: with $50 in the pot and two
 * people owed $40 each, both were shown $40 and the product had promised $80.
 * Per wallet the arithmetic was right, which is exactly why no single-user test
 * caught it.
 *
 * So the bound is the **free** reserve — the balance less everything currently
 * held by open claims, from `lib/rewards/reserve.ts` — and the same number is
 * re-checked atomically when a claim actually reserves. Two people reading at
 * the same instant can still both be shown the same free dollars; that is
 * unavoidable without pre-allocating money to people who have not asked for it,
 * and it is harmless because the hold, not the reading, is what decides. The
 * one who loses is told the treasury has not got it free right now, and is
 * never paid from money somebody else already holds.
 *
 * ## Three ways money is Pending, and they are different sentences
 *
 * A person is owed an explanation, not a lump. `pendingReasons` separates them:
 * a reward whose fee asset could not be priced yet, a reward that is priced and
 * simply waiting on the reserve, and — never merged with either — the ordinary
 * case of having earned less than the claim floor, which is not pending at all.
 */

export const REWARD_RESERVE_STATES = ["FUNDED", "PARTIAL", "EMPTY", "UNCONFIGURED", "UNREADABLE"] as const;

export type RewardReserveState = (typeof REWARD_RESERVE_STATES)[number];

export type RewardReserve =
  | Readonly<{ state: "FUNDED" | "PARTIAL" | "EMPTY"; usdMicros: bigint; treasury: string; observedAt: string }>
  | Readonly<{ state: "UNCONFIGURED" | "UNREADABLE"; usdMicros: 0n; treasury: string | null; reason: string }>;

export type RewardPendingReason = "AWAITING_VALUATION" | "AWAITING_RESERVE";

export type RewardBalance = Readonly<{
  /** Claimable right now, in USD micro-units. Never more than the reserve holds. */
  availableUsdMicros: bigint;
  /** Earned, and not yet claimable. The sum of both reasons below. */
  pendingUsdMicros: bigint;
  pendingReasons: readonly RewardPendingReason[];
  /** How many rewards have no dollar figure yet. They are in no total above. */
  unvaluedCount: number;
  lifetimeUsdMicros: bigint;
  claimedUsdMicros: bigint;
  bySource: RewardTotals["bySource"];
  /** True when Claim may be pressed: at or above the floor, and payable. */
  claimable: boolean;
  /** Why Claim is not offered, in one customer-readable sentence, or null. */
  claimBlockedReason: string | null;
}>;

export type RewardBalanceLocale = "en" | "uk";

const FLOOR_TEXT: Readonly<Record<RewardBalanceLocale, string>> = {
  en: `Claim available from $${formatUsdMicros(REWARD_MINIMUM_CLAIM_USD_MICROS)}`,
  uk: `Отримати можна від $${formatUsdMicros(REWARD_MINIMUM_CLAIM_USD_MICROS)}`,
};

/* The state and the condition that changes it — never a promise of when
   (canon v5.0 §0.0 rule 10: no «незабаром» on a customer screen). */
const RESERVE_TEXT: Readonly<Record<RewardBalanceLocale, string>> = {
  en: "Your rewards are recorded. Claiming is paused until the reward reserve covers them.",
  uk: "Ваші винагороди зафіксовані. Отримання призупинено, доки резерв винагород їх не покриє.",
};

/**
 * Fold a ledger and a reserve into the four figures a page shows.
 *
 * Deliberately pure and deliberately given the reserve rather than reading it:
 * the bound is the interesting rule, and a rule that needs a network call to
 * test is a rule that stops being tested.
 */
export function rewardBalance(
  args: Readonly<{
    entries: readonly RewardEntry[];
    reserve: RewardReserve;
    /**
     * What open claims are already holding out of the same treasury.
     *
     * Required rather than optional, and not defaulted to zero: a caller that
     * forgets it would silently reproduce the cross-user double promise this
     * parameter was added to close, and a missing argument is a compile error
     * where a defaulted one is a defect nobody sees.
     */
    heldUsdMicros: bigint;
    locale?: RewardBalanceLocale;
  }>,
): RewardBalance {
  const locale = args.locale ?? "en";
  const totals = totalRewards(args.entries);
  const owed = totals.entitledUsdMicros > 0n ? totals.entitledUsdMicros : 0n;
  const unheld = args.reserve.usdMicros - args.heldUsdMicros;
  /* Floored: a treasury drained below its outstanding holds offers nobody
     anything, rather than reporting a negative amount that would be subtracted
     again somewhere downstream. */
  const reserve = unheld > 0n ? unheld : 0n;
  const available = owed < reserve ? owed : reserve;
  const pending = owed - available;

  const reasons: RewardPendingReason[] = [];
  if (totals.unvaluedCount > 0) reasons.push("AWAITING_VALUATION");
  if (pending > 0n) reasons.push("AWAITING_RESERVE");

  const meetsFloor = available >= REWARD_MINIMUM_CLAIM_USD_MICROS;
  /*
   * Which sentence a person gets when Claim is off.
   *
   * The floor comes first when the *entitlement* is below it, because that is
   * the person's own situation and it is the honest thing to say — telling
   * somebody who has earned $0.40 that the treasury is not funded would be
   * true, irrelevant and slightly alarming. The reserve sentence appears only
   * when they have genuinely earned enough and the money is what is missing,
   * and it never blames them or explains Ryntra's internals.
   */
  let blocked: string | null = null;
  if (!meetsFloor) {
    blocked = owed < REWARD_MINIMUM_CLAIM_USD_MICROS ? FLOOR_TEXT[locale] : RESERVE_TEXT[locale];
  }

  return {
    availableUsdMicros: available,
    pendingUsdMicros: pending,
    pendingReasons: reasons,
    unvaluedCount: totals.unvaluedCount,
    lifetimeUsdMicros: totals.lifetimeUsdMicros,
    claimedUsdMicros: totals.claimedUsdMicros,
    bySource: totals.bySource,
    claimable: meetsFloor,
    claimBlockedReason: blocked,
  };
}

/** No treasury configured. The shape every caller can build without an RPC. */
export function unconfiguredReserve(reason: string): RewardReserve {
  return { state: "UNCONFIGURED", usdMicros: 0n, treasury: null, reason };
}
