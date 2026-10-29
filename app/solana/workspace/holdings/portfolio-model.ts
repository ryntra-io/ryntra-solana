/**
 * Portfolio's blocks under the holdings (B5): the pools to take money
 * back from, the positions on Phoenix (SOL-C6), the receipts, and Rewards — as pure rules, so the page and its
 * tests read one answer. Pure: the reads in, what to draw out.
 */

import type { SolanaWalletAction } from "../../../../lib/solana/action-ledger.ts";
import type { LimitOrderView } from "../../../../lib/solana/limits/sync.server.ts";
import type { RankId } from "../rewards/rank-copy.ts";
import { isOpenLimit } from "../spot/limit-orders-view.ts";

/** «Квитанції»: the newest finished operations, as many as a block keeps. */
export const RECEIPT_ROWS = 5;

/**
 * Finished operations, newest first. A receipt is the record of something
 * that happened: an operation on its way or one that failed is History's and
 * the value panel's («У русі»), never a receipt.
 */
export function receiptRows(actions: readonly SolanaWalletAction[], count = RECEIPT_ROWS): readonly SolanaWalletAction[] {
  return actions
    .filter((action) => action.outcome === "DONE")
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    .slice(0, count);
}

/** What the pools read says, in the few shapes Portfolio cares about. */
export type PoolsRead =
  | Readonly<{ status: "idle" | "loading" }>
  | Readonly<{ status: "failed" }>
  | Readonly<{ status: "ready"; positions: number; complete: boolean }>;

/**
 * Portfolio draws the pools block when there is money in a pool to see and
 * take back, or when the read could not say — a read that failed, or one a
 * venue did not answer, is named rather than passed over as «no pools». A
 * wallet with no positions, read whole, gets no empty block: Пули is one
 * press away in the menu.
 */
export function poolsShown(read: PoolsRead): boolean {
  if (read.status === "failed") return true;
  if (read.status !== "ready") return false;
  return read.positions > 0 || !read.complete;
}

/**
 * «На Phoenix» (SOL-C6, UX-604): drawn when the wallet has an open position on
 * Phoenix — its entry, mark and result. Collateral alone stays a line of the
 * value, opening «Perps»; a wallet with no Phoenix account gets nothing.
 */
export function phoenixShown(account: Readonly<{ state: string; positions: readonly unknown[] }> | null): boolean {
  return account !== null && account.state !== "none" && account.positions.length > 0;
}

/** The rank's points over its window, as Rewards draws them in its ring. */
export type RewardsPoints = Readonly<{ points: string; rank: RankId; windowDays: number }>;

export type RewardsRead =
  | Readonly<{ status: "loading" }>
  /** The wallet has not proved itself: Rewards answers only to proof. */
  | Readonly<{ status: "proof" }>
  | Readonly<{ status: "failed" }>
  /** `points` null: the rank could not be read — unavailable, never zero. */
  | Readonly<{ status: "ready"; points: RewardsPoints | null; available: string | null }>;

const RANKS: ReadonlySet<string> = new Set(["BRONZE", "SILVER", "GOLD", "SAPPHIRE", "DIAMOND"]);
const GROUPED = /^\d{1,3}(?:[\s  ,]\d{3})*$/;

/** Anything but nothing. «<0.01» counts — it is money too (the header's rule). */
function some(amount: unknown): amount is string {
  if (typeof amount !== "string" || amount === "") return false;
  if (amount.startsWith("<")) return true;
  const value = Number(amount);
  return Number.isFinite(value) && value > 0;
}

/**
 * `/api/rewards`'s answer as Portfolio reads it: the rank's points — the very
 * figure the Rewards page shows in its ring, from the very same field — and
 * what is gathered to claim. Only for the address asked about: an answer for
 * another wallet is no answer.
 */
export function rewardsReadOf(httpStatus: number, body: unknown, address: string): RewardsRead {
  if (httpStatus === 401) return { status: "proof" };
  if (httpStatus < 200 || httpStatus >= 300 || typeof body !== "object" || body === null) return { status: "failed" };
  const answer = body as { address?: unknown; available?: unknown; rank?: unknown };
  if (answer.address !== address) return { status: "failed" };
  const rank = answer.rank as { points?: unknown; rank?: unknown; windowDays?: unknown } | null | undefined;
  const points: RewardsPoints | null =
    rank && typeof rank.points === "string" && GROUPED.test(rank.points) && typeof rank.rank === "string" && RANKS.has(rank.rank) && typeof rank.windowDays === "number"
      ? { points: rank.points, rank: rank.rank as RankId, windowDays: rank.windowDays }
      : null;
  return { status: "ready", points, available: some(answer.available) ? answer.available : null };
}

/** Where the wallet's proof stands, as the block needs it: `down` — the sign-in check itself did not answer. */
export type ProofPhase = "settling" | "proven" | "unproven" | "down";

/**
 * What «Винагороди» draws for the connected wallet: nothing without one; a
 * check that did not answer is named, never an endless skeleton; a wallet
 * that has not proved itself is asked to, in Rewards; a proven one shows its
 * own answer and never the last wallet's.
 */
export function rewardsShown(
  args: Readonly<{ address: string | null; proof: ProofPhase; read: Readonly<{ address: string; value: RewardsRead }> | null }>,
): RewardsRead | null {
  if (!args.address) return null;
  if (args.proof === "down") return { status: "failed" };
  if (args.proof === "settling") return { status: "loading" };
  if (args.proof === "unproven") return { status: "proof" };
  return args.read && args.read.address === args.address ? args.read.value : { status: "loading" };
}

/**
 * The points as the Rewards ring writes them: in full below 100 000, then
 * whole thousands («124k», «124 тис.»), then whole millions — the ring's own
 * rule, so the two places never read one figure two ways.
 */
export function pointsScale(grouped: string): Readonly<{ scale: "full" } | { scale: "thousands" | "millions"; value: number }> {
  const whole = Number(grouped.replace(/\D/g, ""));
  if (whole >= 1_000_000) return { scale: "millions", value: Math.floor(whole / 1_000_000) };
  if (whole >= 100_000) return { scale: "thousands", value: Math.floor(whole / 1000) };
  return { scale: "full" };
}

/** A re-read when the tab comes back waits this long after the last answer: the route behind it is heavy. */
export const REWARDS_REREAD_MS = 60_000;

/**
 * Where the money in open orders is taken back: the newest open order's
 * market in Spot, where «Ордери» cancels it — Home's rule for the same row.
 * No open order read: Spot itself.
 */
export function ordersHref(orders: readonly LimitOrderView[]): string {
  const newest = orders
    .filter(isOpenLimit)
    .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt))[0];
  return newest ? `/app/spot?mint=${encodeURIComponent(newest.baseMint)}` : "/app/spot";
}
