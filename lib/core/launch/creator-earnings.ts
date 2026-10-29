/**
 * What a creator earned on a launch — «Мої лаунчі».
 *
 * Every figure is a program's own counter, read from the chain:
 * - **on the curve** — the curve's total trading fee (after Meteora's part)
 *   times the creator's share in the config; what is not claimed yet is the
 *   curve's own `creator_quote_fee`. The program splits each trade rounding the
 *   creator's part down, so the total is at most one raw unit a trade above the
 *   exact sum — invisible at any figure a page draws;
 * - **at graduation** — the config's graduation fee on the threshold, the
 *   creator's part of it, withdrawn or not by the curve's own flag;
 * - **from the locked LP** — the creator's position in the graduated pool:
 *   what it has claimed by its own metrics, and what it holds unclaimed;
 * - **the curve's surplus** — what the last purchase raised above the
 *   threshold: once the curve is full, 80 % of it goes to the partner and the
 *   creator, the creator's part by its trading share (Meteora's formula),
 *   withdrawn or not by the curve's own flag.
 *
 * With «Спільнота» sharing the creator's fees, the role's earnings are the
 * vault's, and each wallet's part is its share of them; what a wallet has
 * already taken out of the vault is the vault's own record.
 *
 * Pure and client-safe; the chain is read by `../venues/meteora-dbc/claim.server.ts`.
 */

import { FEE_SHARE_TOTAL_BPS } from "./fee-shares.ts";

export const FEE_SOURCES = ["curve", "graduation", "lp", "surplus"] as const;
export type FeeSource = (typeof FEE_SOURCES)[number];

/** The chain's counters for the creator's role on one launch, raw in the pair currency. */
export type CreatorFeesRead = Readonly<{
  /** Who holds the curve's creator role: the creator's wallet, or the vault sharing its fees. */
  roleOwner: string;
  curve: Readonly<{ totalTradingRaw: string; creatorPct: number; unclaimedRaw: string }>;
  graduation: Readonly<{ migrated: boolean; thresholdRaw: string; feePct: number; creatorPct: number; withdrawn: boolean }>;
  /** The creator's role's position in the graduated pool, its pair side; null before graduation or when the pool holds none. */
  lp: Readonly<{ claimedRaw: string; unclaimedRaw: string }> | null;
  /**
   * The curve's surplus: whether the curve is full (only then is there one), the reserve above the threshold, the
   * creator's trading share that sets its part, and whether the creator withdrew it.
   */
  surplus: Readonly<{ full: boolean; reserveRaw: string; thresholdRaw: string; creatorPct: number; withdrawn: boolean }>;
  /**
   * The vault holding the creator's role, when the creator's fees are shared: its cumulative fee per share (Q64.64)
   * and each wallet's checkpoint — the program pays ⌊share × (feePerShare − checkpoint) / 2⁶⁴⌋.
   */
  sharing: Readonly<{
    vault: string;
    totalShare: number;
    fundedRaw: string;
    feePerShare: string;
    users: readonly Readonly<{ address: string; share: number; claimedRaw: string; checkpoint: string }>[];
  }> | null;
}>;

export type SourceEarnings = Readonly<{ earnedRaw: string; unclaimedRaw: string }>;

export type CreatorEarnings = Readonly<{
  /** The creator's role — everything the creator's side of the launch earned, whoever it is shared with. */
  role: Readonly<Record<FeeSource, SourceEarnings> & { earnedRaw: string; unclaimedRaw: string }>;
  /** One wallet's part: its share, what it earned, what it can take now and what it took — nothing for a wallet without a part. */
  mine: Readonly<{ shareBps: number; earnedRaw: string; unclaimedRaw: string; claimedRaw: string }>;
}>;

const big = (raw: string) => BigInt(raw);
const max = (a: bigint, b: bigint) => (a > b ? a : b);

/** The graduation fee the creator's role earns once the curve has graduated: the fee on the threshold, the creator's part of it. */
export function creatorGraduationFeeRaw(graduation: CreatorFeesRead["graduation"]): bigint {
  if (!graduation.migrated) return 0n;
  const threshold = big(graduation.thresholdRaw);
  /* The program keeps the threshold less its fee for the pool, rounding the pool's amount down: the fee is the rest. */
  const fee = threshold - (threshold * BigInt(100 - graduation.feePct)) / 100n;
  return (fee * BigInt(graduation.creatorPct)) / 100n;
}

/**
 * The creator's part of the curve's surplus once the curve is full (DBC `get_creator_surplus`): the reserve above the
 * threshold, 80 % of it to the partner and the creator, the creator's part of that by its trading share, rounded down.
 */
export function creatorSurplusRaw(surplus: CreatorFeesRead["surplus"]): bigint {
  if (!surplus.full) return 0n;
  const total = big(surplus.reserveRaw) - big(surplus.thresholdRaw);
  if (total <= 0n) return 0n;
  return (((total * 80n) / 100n) * BigInt(surplus.creatorPct)) / 100n;
}

/** The role's earnings by source, and one wallet's part of them. */
export function creatorEarnings(read: CreatorFeesRead, wallet: string): CreatorEarnings {
  const curveUnclaimed = big(read.curve.unclaimedRaw);
  const curveEarned = max((big(read.curve.totalTradingRaw) * BigInt(read.curve.creatorPct)) / 100n, curveUnclaimed);
  const graduationEarned = creatorGraduationFeeRaw(read.graduation);
  const graduationUnclaimed = read.graduation.migrated && !read.graduation.withdrawn ? graduationEarned : 0n;
  const lpUnclaimed = read.lp ? big(read.lp.unclaimedRaw) : 0n;
  const lpEarned = read.lp ? big(read.lp.claimedRaw) + lpUnclaimed : 0n;
  /* A read without the surplus (stored before it was read) counts none. */
  const surplusEarned = read.surplus ? creatorSurplusRaw(read.surplus) : 0n;
  const surplusUnclaimed = read.surplus?.withdrawn ? 0n : surplusEarned;
  const earned = curveEarned + graduationEarned + lpEarned + surplusEarned;
  const unclaimed = curveUnclaimed + graduationUnclaimed + lpUnclaimed + surplusUnclaimed;
  const role = {
    curve: { earnedRaw: curveEarned.toString(), unclaimedRaw: curveUnclaimed.toString() },
    graduation: { earnedRaw: graduationEarned.toString(), unclaimedRaw: graduationUnclaimed.toString() },
    lp: { earnedRaw: lpEarned.toString(), unclaimedRaw: lpUnclaimed.toString() },
    surplus: { earnedRaw: surplusEarned.toString(), unclaimedRaw: surplusUnclaimed.toString() },
    earnedRaw: earned.toString(),
    unclaimedRaw: unclaimed.toString(),
  };
  const none = { role, mine: { shareBps: 0, earnedRaw: "0", unclaimedRaw: "0", claimedRaw: "0" } };
  const sharing = read.sharing;
  if (!sharing) {
    /* Unshared, the whole of it is the role owner's — and nobody else's. */
    if (wallet !== read.roleOwner) return none;
    return { role, mine: { shareBps: FEE_SHARE_TOTAL_BPS, earnedRaw: earned.toString(), unclaimedRaw: unclaimed.toString(), claimedRaw: (earned - unclaimed).toString() } };
  }
  const user = sharing.users.find((entry) => entry.address === wallet);
  if (!user) return none;
  /*
   * As the program counts it: each source a claim funds the vault from raises the fee per share by
   * ⌊amount × 2⁶⁴ / total share⌋, one funding after another; the wallet is then paid
   * ⌊share × (fee per share − its checkpoint) / 2⁶⁴⌋. What the rounding keeps back is never shown as something to take.
   */
  let feePerShare = big(sharing.feePerShare);
  const totalShare = BigInt(sharing.totalShare);
  if (totalShare > 0n) for (const pending of [curveUnclaimed, graduationUnclaimed, lpUnclaimed, surplusUnclaimed]) if (pending > 0n) feePerShare += (pending << 64n) / totalShare;
  const delta = feePerShare - big(user.checkpoint);
  const mineUnclaimed = delta > 0n ? (BigInt(user.share) * delta) >> 64n : 0n;
  const claimed = big(user.claimedRaw);
  return {
    role,
    mine: {
      shareBps: Math.round((user.share * FEE_SHARE_TOTAL_BPS) / sharing.totalShare),
      /* What it took and what waits for it — both the program's own figures. */
      earnedRaw: (claimed + mineUnclaimed).toString(),
      unclaimedRaw: mineUnclaimed.toString(),
      claimedRaw: user.claimedRaw,
    },
  };
}
