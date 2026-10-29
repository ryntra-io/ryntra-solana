import { networkShareBps, type NetworkRules } from "./network-rules.ts";
import { FIRST_TEN_CEILING_BPS, REWARD_RANKS, type RewardRules } from "./rules.ts";

/**
 * What Rewards pays, as a guest reads it (Ріст 19, UX-750 and UX-752): every share from the rules in force — never a
 * figure written on the page — and, beside each, whether it is money paid in USDC, money counted but not paid yet,
 * or status with no cash value.
 *
 * Pure: the caller reads the rules in force, the partner rules, whether partner payouts are open and whether
 * rewards have started, and this turns them into whole percents. A share that differs by rank reads as its range,
 * Bronze to Diamond; the inviter's window and «First $10 back» appear only while the rules in force have them.
 */

/** Partner payouts: open after the first test payout, paused by the owner, or not open yet. */
export type PartnerPayouts = "OPEN" | "PAUSED" | "CLOSED";

/** Money paid in USDC; money counted and kept until payouts open (or resume); status with no cash value. */
export type PaidAs = "USDC" | "COUNTED" | "PAUSED" | "STATUS";

export type ProgrammeFacts = Readonly<{
  /** False before the owner starts rewards: nothing earns yet, and the card says so. */
  started: boolean;
  cashbackPercent: number;
  /** The inviter's share by rank, Bronze → Diamond; equal when the rules have one share for every rank. */
  friends: Readonly<{ from: number; to: number }>;
  /** Each friend's first days at one share for any rank (rules 2.1.0); null when the rules have no window. */
  friendWindow: Readonly<{ percent: number; days: number }> | null;
  theirFriendsPercent: number;
  /** «First $10 back» for a new wallet (rules 2.1.0); null when the rules have none. */
  firstTen: Readonly<{ percent: number; capUsd: number; days: number; walletsPerMonth: number }> | null;
  /** A standard creator partner's first share of Ryntra's part of a creator's pool. Founding seats (their own steps)
   *  are left to the partner Terms, which state every step — a single figure here would read as permanent. */
  partnerPercent: number;
  /** When the first share steps down, and to what; null when it never does. */
  partnerThen: Readonly<{ afterDays: number; percent: number }> | null;
  partnerPaidAs: Exclude<PaidAs, "STATUS">;
}>;

const percent = (bps: number): number => Math.round(bps) / 100;

export function programmeFacts(input: Readonly<{ rules: RewardRules; network: NetworkRules; payouts: PartnerPayouts; started: boolean }>): ProgrammeFacts {
  const { rules, network, payouts, started } = input;
  const byRank = REWARD_RANKS.map((rank) => rules.referralL1BpsByRank[rank]);
  return {
    started,
    cashbackPercent: percent(rules.cashbackBps),
    friends: { from: percent(Math.min(...byRank)), to: percent(Math.max(...byRank)) },
    friendWindow: rules.inviterWindow ? { percent: percent(rules.inviterWindow.bps), days: rules.inviterWindow.days } : null,
    theirFriendsPercent: percent(rules.referralL2Bps),
    firstTen: rules.firstTen ? { percent: percent(FIRST_TEN_CEILING_BPS), capUsd: Number(rules.firstTen.capUsdMicros / 1_000_000n), days: rules.firstTen.days, walletsPerMonth: rules.firstTen.walletsPerMonth } : null,
    partnerPercent: percent(networkShareBps(network, "STANDARD", 1)),
    partnerThen: (() => {
      const [first, next] = network.schedules.STANDARD;
      return first?.untilDay != null && next ? { afterDays: first.untilDay, percent: percent(next.bps) } : null;
    })(),
    partnerPaidAs: payouts === "OPEN" ? "USDC" : payouts === "PAUSED" ? "PAUSED" : "COUNTED",
  };
}
