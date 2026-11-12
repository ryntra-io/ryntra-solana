/**
 * A placed ladder as the chain and the relay say it, and what the window shows
 * for it: placing, not finished (some transactions of the bundle landed, some
 * did not — finish or cancel), working, filled, due (its exit policy proposes
 * something), closed.
 *
 * Pure: the order reads come from `build.server.ts` through the orders route.
 */

import { exitProposal, exitTrigger, type ExitPolicy, type ExitProposal, type LadderProgress } from "./exit.ts";
import type { LadderSide, Rung } from "./plan.ts";

export type LadderOrderState = "open" | "partial" | "filled" | "closed";

export type LadderOrderRead = Readonly<{
  limitOrder: string;
  pool: string | null;
  state: LadderOrderState;
  rungs: number;
  filled: number;
  partial: number;
}>;

/**
 * One transaction of a placed ladder: its order account, how it stands — `sent` from the moment it is signed, before
 * the relay is even asked (CITY-231), then `confirmed` or `failed` by the chain's own word — its signature, read from
 * the signed bytes, and the steps it holds.
 */
export type PlacedLeg = Readonly<{
  limitOrder: string;
  side: LadderSide;
  state: "confirmed" | "sent" | "failed";
  signature: string | null;
  rungs: readonly Rung[];
  /** When this leg was handed on to be sent; a leg the chain still does not show long after never landed. */
  sentAt?: number;
}>;

export type LiveState = "placing" | "failed" | "incomplete" | "working" | "filled" | "due" | "closed";

export type LiveView = Readonly<{
  state: LiveState;
  progress: LadderProgress;
  proposal: ExitProposal | null;
  /** Order accounts that still hold something: what «Cancel orders» takes back. */
  holding: readonly string[];
  /** Legs that never landed: what «Finish» places again. */
  missing: readonly PlacedLeg[];
}>;

/**
 * The view of a placed ladder from its legs, the latest reads of their order accounts and the price now (quote per
 * base). A leg without a read yet counts as it was placed: open.
 */
export function liveView(
  args: Readonly<{
    legs: readonly PlacedLeg[];
    reads: Readonly<Record<string, LadderOrderRead | undefined>>;
    band: Readonly<{ lower: number; upper: number }> | null;
    price: number | null;
    policy: ExitPolicy;
    closed: boolean;
  }>,
): LiveView {
  const landed = args.legs.filter((leg) => leg.state === "confirmed");
  const missing = args.legs.filter((leg) => leg.state === "failed");
  const readOf = (leg: PlacedLeg): LadderOrderRead => args.reads[leg.limitOrder] ?? { limitOrder: leg.limitOrder, pool: null, state: "open", rungs: leg.rungs.length, filled: 0, partial: 0 };
  const reads = landed.map(readOf);
  const holding = reads.filter((read) => read.state !== "closed").map((read) => read.limitOrder);
  const progress: LadderProgress = {
    rungs: reads.reduce((n, read) => n + (read.state === "closed" ? 0 : read.rungs), 0),
    filled: reads.reduce((n, read) => n + (read.state === "closed" ? 0 : read.filled), 0),
    partial: reads.reduce((n, read) => n + (read.state === "closed" ? 0 : read.partial), 0),
  };
  const base = { progress, holding, missing } as const;
  if (args.closed || (landed.length > 0 && holding.length === 0 && missing.length === 0)) return { ...base, state: "closed", proposal: null };
  if (args.legs.some((leg) => leg.state === "sent")) return { ...base, state: "placing", proposal: null };
  if (landed.length === 0) return { ...base, state: "failed", proposal: null };
  if (missing.length > 0) return { ...base, state: "incomplete", proposal: null };
  const side = landed[0]!.side;
  const proposal = exitProposal(args.policy, exitTrigger(args.band, args.price, progress), side);
  if (proposal) return { ...base, state: "due", proposal };
  if (progress.rungs > 0 && progress.filled >= progress.rungs) return { ...base, state: "filled", proposal: null };
  return { ...base, state: "working", proposal: null };
}

/** Quote per base from a pool's own price (Y per X, whole tokens). */
export const quotePerBase = (poolPrice: number, baseIsX: boolean): number => (poolPrice > 0 ? (baseIsX ? poolPrice : 1 / poolPrice) : Number.NaN);

/**
 * The legs that finish a ladder whose bundle half-landed: the missing steps placed again from today's price, the same
 * percents and amounts they had.
 */
export function finishLegs(missing: readonly PlacedLeg[]): Readonly<{ side: LadderSide; steps: number; firstPct: number; lastPct: number; amountRaw: string }>[] {
  const bySide = new Map<LadderSide, Rung[]>();
  for (const leg of missing) bySide.set(leg.side, [...(bySide.get(leg.side) ?? []), ...leg.rungs]);
  return [...bySide.entries()].flatMap(([side, rungs]) => {
    const pcts = rungs.map((rung) => Math.abs(rung.pct)).sort((a, b) => a - b);
    const total = rungs.reduce((sum, rung) => sum + BigInt(rung.amountRaw), 0n);
    if (rungs.length < 2 || total <= 0n) return [];
    return [{ side, steps: rungs.length, firstPct: Math.round(pcts[0]! * 100) / 100, lastPct: Math.round(pcts[pcts.length - 1]! * 100) / 100, amountRaw: total.toString() }];
  });
}
