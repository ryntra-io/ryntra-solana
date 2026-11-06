/**
 * CITY-203 — what the agent does with a position it looks after, now. Pure: a snapshot of the position read from the
 * chain and the person's terms in, one action out. The policies (`./terms.ts`) hold what the agent may do at all; this
 * file only picks the moment, so that it neither churns the range nor pays a network fee for a claim worth less.
 *
 * In order:
 * 1. **the stop** — the price under the person's stop: everything out to their wallet, fees too, the position closed;
 * 2. **the range** (DLMM, when the person asked): the price has stayed outside the range for a while — the same width put
 *    back around the price in one instruction, the fees claimed in it;
 * 3. **the fees** — enough of them waiting, and not too soon after the last: to the wallet, or back into the position;
 * 4. **wait** — with the reason, for the day's report.
 */

import type { CarePoolKind, FeeMode } from "./terms.ts";

/** The price has to stay outside the range this long before the agent moves it (no churn on a wick). */
export const OUT_OF_RANGE_PATIENCE_MS = 30 * 60_000;
/** At most one rebalance in this window. */
export const REBALANCE_COOLDOWN_MS = 6 * 60 * 60_000;
/** At most one claim in this window. */
export const CLAIM_COOLDOWN_MS = 12 * 60 * 60_000;
/** A claim is worth its network fee when the fees are at least this many times the fee it costs. */
export const CLAIM_FEE_MULTIPLE = 20;

export type PositionSnapshot = Readonly<{
  kind: CarePoolKind;
  /** X's price in Y now, per whole coin. */
  price: number;
  /** DLMM: the active bin and the position's range (inclusive); DAMM v2 — null. */
  activeBin: number | null;
  lowerBin: number | null;
  upperBin: number | null;
  /** The fees waiting in the position, valued in Y (decimal). */
  feesInY: number;
  /** What one transaction of the agent costs, in Y (decimal) — the network fee and priority. */
  txCostInY: number;
  /** Whether the position holds any liquidity. */
  hasLiquidity: boolean;
  /** When the agent first saw the price outside the range, ms; null — inside, or never seen out. */
  outOfRangeSince: number | null;
  lastRebalanceAt: number | null;
  lastClaimAt: number | null;
}>;

export type CareChoice = Readonly<{ fees: FeeMode; rebalance: boolean; stopBelow: number | null }>;

export type CareAction =
  | Readonly<{ kind: "exit"; reason: "stop" }>
  | Readonly<{ kind: "rebalance"; lowerBin: number; upperBin: number }>
  | Readonly<{ kind: "claim"; to: FeeMode }>
  | Readonly<{ kind: "wait"; reason: "empty" | "in-range" | "patience" | "cooldown" | "fees-small" | "nothing" }>;

/** Whether the active bin is inside the range. DAMM v2 has no range of its own: always inside. */
export function inRange(snapshot: PositionSnapshot): boolean {
  if (snapshot.kind !== "dlmm" || snapshot.activeBin === null || snapshot.lowerBin === null || snapshot.upperBin === null) return true;
  return snapshot.activeBin >= snapshot.lowerBin && snapshot.activeBin <= snapshot.upperBin;
}

/** The same width, centred on the active bin. */
export function recentred(snapshot: PositionSnapshot): Readonly<{ lowerBin: number; upperBin: number }> {
  const width = (snapshot.upperBin ?? 0) - (snapshot.lowerBin ?? 0);
  const lowerBin = (snapshot.activeBin ?? 0) - Math.floor(width / 2);
  return { lowerBin, upperBin: lowerBin + width };
}

/** The one action for now. */
export function decide(snapshot: PositionSnapshot, choice: CareChoice, now: number): CareAction {
  if (!snapshot.hasLiquidity && snapshot.feesInY <= 0) return { kind: "wait", reason: "empty" };
  if (choice.stopBelow !== null && snapshot.price > 0 && snapshot.price < choice.stopBelow) return { kind: "exit", reason: "stop" };

  if (choice.rebalance && snapshot.kind === "dlmm" && snapshot.hasLiquidity && !inRange(snapshot)) {
    if (snapshot.outOfRangeSince === null || now - snapshot.outOfRangeSince < OUT_OF_RANGE_PATIENCE_MS) return { kind: "wait", reason: "patience" };
    if (snapshot.lastRebalanceAt !== null && now - snapshot.lastRebalanceAt < REBALANCE_COOLDOWN_MS) return { kind: "wait", reason: "cooldown" };
    return { kind: "rebalance", ...recentred(snapshot) };
  }

  if (snapshot.feesInY > 0) {
    if (snapshot.feesInY < snapshot.txCostInY * CLAIM_FEE_MULTIPLE) return { kind: "wait", reason: "fees-small" };
    if (snapshot.lastClaimAt !== null && now - snapshot.lastClaimAt < CLAIM_COOLDOWN_MS) return { kind: "wait", reason: "cooldown" };
    return { kind: "claim", to: choice.fees };
  }
  return { kind: "wait", reason: inRange(snapshot) ? "in-range" : "nothing" };
}

/** When the agent should next read this position, ms from now: sooner while the price is out of its range. */
export function nextLookIn(snapshot: PositionSnapshot, action: CareAction): number {
  if (action.kind === "wait" && action.reason === "patience") return 5 * 60_000;
  if (!inRange(snapshot)) return 10 * 60_000;
  return 30 * 60_000;
}

/* ------------------------------------------------------------------ the day's report */

/** One thing the agent did for the person, as the journal keeps it. Public data only. */
export type CareEvent = Readonly<{
  at: number;
  kind: "open" | "claim" | "reinvest" | "rebalance" | "exit" | "refused";
  /** What reached the person's wallet or went back into the position, in Y (decimal). */
  valueInY: number;
  signature: string | null;
}>;

export type CareDay = Readonly<{
  /** Fees the agent brought to the wallet. */
  claimedInY: number;
  /** Fees the agent put back into the position. */
  reinvestedInY: number;
  rebalances: number;
  exits: number;
  refusals: number;
  /** Whether the position is in its range at the report's time. */
  inRange: boolean;
  /** The position's value now and a day ago, in Y; null — not read. */
  valueNowInY: number | null;
  valueDayAgoInY: number | null;
}>;

/** The last day of the journal, summed — the numbers the city's report card shows. No promise, only what happened. */
export function careDay(events: readonly CareEvent[], snapshot: PositionSnapshot | null, now: number, values: Readonly<{ now: number | null; dayAgo: number | null }>): CareDay {
  const day = events.filter((event) => now - event.at <= 86_400_000 && event.at <= now);
  const sum = (kind: CareEvent["kind"]) => day.filter((event) => event.kind === kind).reduce((total, event) => total + event.valueInY, 0);
  return {
    claimedInY: sum("claim"),
    reinvestedInY: sum("reinvest"),
    rebalances: day.filter((event) => event.kind === "rebalance").length,
    exits: day.filter((event) => event.kind === "exit").length,
    refusals: day.filter((event) => event.kind === "refused").length,
    inRange: snapshot ? inRange(snapshot) : true,
    valueNowInY: values.now,
    valueDayAgoInY: values.dayAgo,
  };
}
