import { rewardBalance, type RewardBalance, type RewardReserve } from "./balance.ts";
import { claimStatusText, type RewardClaim } from "./claim.ts";
import { dollars, usdText } from "./format.ts";
import type { RewardEntry } from "./model.ts";
import { effectiveRewardEntries } from "./ledger.ts";

/**
 * What the Rewards page is allowed to know.
 *
 * ## Nothing internal crosses this boundary
 *
 * Canon §0.5 and the owner's instruction agree: a customer surface carries no
 * internal identifiers, no provider vocabulary and no evidence bureaucracy. So
 * the projection drops the operation reference, the mechanism name, the raw fee
 * amount, the valuation source and the treasury address, and keeps the four
 * things a person actually reads — what it was for, how much, when, and whether
 * it is theirs yet.
 *
 * The dropped fields are not secrets and they are not lost. They are in the
 * ledger, they are what an operator reads, and the row a person opens can grow
 * a detail view later. They are simply not the first thing somebody sees when
 * they want to know what they earned.
 *
 * ## Other people's wallets never appear
 *
 * A referral row says `Referral L1` and an amount. It does not say who traded,
 * how much they traded, or what they bought. That is somebody else's financial
 * activity, and a referral programme that leaks it has invented a surveillance
 * feature by accident. The aggregate counts are the whole of what is shown
 * about other people.
 */

export type RewardRowKind = "CASHBACK" | "REFERRAL_L1" | "REFERRAL_L2" | "CLAIM";

export type RewardRow = Readonly<{
  kind: RewardRowKind;
  /**
   * Ready to print, sign and currency included.
   *
   * Assembled here rather than by each surface, because two of them were doing
   * it and one got it wrong: prefixing a currency symbol to an already-signed
   * figure renders a claim as `$-1.00`, with the minus inside the amount. The
   * sign belongs in front of the whole quantity, and an em-dash stands for a
   * reward that has no figure yet rather than for a zero.
   */
  display: string;
  /** The unsigned figure, for a caller that needs the number without dressing. */
  amount: string;
  /** Null when the reward has no dollar figure yet. */
  valued: boolean;
  /** The pair it came from, when the source names one. Never an address. */
  detail: string | null;
  at: string;
}>;

export type RewardsView = Readonly<{
  balance: RewardBalance;
  available: string;
  pending: string;
  lifetime: string;
  cashback: string;
  referralL1: string;
  referralL2: string;
  rows: readonly RewardRow[];
  referrals: Readonly<{ level1: number; level2: number }>;
  referral: Readonly<{ code: string; link: string }> | null;
  claim: Readonly<{ state: string; text: string; signature: string | null }> | null;
}>;

/** A row's human detail: the assets, when they are known, and nothing else. */
function detailOf(entry: RewardEntry): string | null {
  if (entry.type === "CLAIM") return null;
  return entry.source?.symbol ?? null;
}

export function rewardsView(
  args: Readonly<{
    entries: readonly RewardEntry[];
    reserve: RewardReserve;
    /** What open claims already hold out of the same treasury. */
    heldUsdMicros: bigint;
    /** How many people chose this wallet, from its own account record. */
    referrals: Readonly<{ level1: number; level2: number }>;
    referral: Readonly<{ code: string; link: string }> | null;
    claim: RewardClaim | null;
    locale: "en" | "uk";
    /** How many history rows to project. The page shows a compact list. */
    limit?: number;
  }>,
): RewardsView {
  const balance = rewardBalance({ entries: args.entries, reserve: args.reserve, heldUsdMicros: args.heldUsdMicros, locale: args.locale });
  const rows: RewardRow[] = [];
  for (const entry of effectiveRewardEntries(args.entries)) {
    if (entry.type === "ADJUSTMENT") continue;
    const micros = entry.usdMicros === null ? null : BigInt(entry.usdMicros);
    const magnitude = micros === null ? null : usdText(micros < 0n ? -micros : micros);
    rows.push({
      kind: entry.type,
      display: magnitude === null ? "—" : `${micros! < 0n ? "−" : "+"}${dollars(magnitude)}`,
      amount: magnitude ?? "—",
      valued: micros !== null,
      detail: detailOf(entry),
      at: entry.createdAt,
    });
    if (rows.length >= (args.limit ?? 20)) break;
  }
  return {
    balance,
    available: usdText(balance.availableUsdMicros),
    pending: usdText(balance.pendingUsdMicros),
    lifetime: usdText(balance.lifetimeUsdMicros),
    cashback: usdText(balance.bySource.CASHBACK),
    referralL1: usdText(balance.bySource.REFERRAL_L1),
    referralL2: usdText(balance.bySource.REFERRAL_L2),
    rows,
    referrals: args.referrals,
    referral: args.referral,
    claim: args.claim
      ? {
          state: args.claim.state,
          text: claimStatusText(args.claim, args.locale) ?? "",
          signature: args.claim.signature,
        }
      : null,
  };
}

