/**
 * The cluster-aware counts a signal may rest on — the survival rings on a launch's tower, the city's «Маяк», anything
 * that lights up because people trade a coin. One wallet farm, or one dollar's trade, must not light it: every figure
 * here is the flow's (`GET /api/v1/launch/{mint}/flow`), where each funding cluster counts once, the creator's party
 * never, and a wallet whose start was not read is not counted at all.
 *
 * Client-safe: it reads the contract's answer and nothing else.
 */

import type { LaunchFlowResponse } from "../../api/v1/contract.ts";

/** A survival check as a signal shows it: `unproven` — alive only by a trade of the creator's own party. */
export type RingState = "young" | "alive" | "unproven" | "quiet" | "unread";

export type ClusterAwareCounts = Readonly<{
  /** Buyers above the floor, each funding cluster once — a floor when `atLeast`. */
  independentBuyers: number;
  atLeast: boolean;
  /** Wallets of the creator's party among the buyers: never counted as demand. */
  creatorLinked: number;
  /** How many independent buyers filled the curve; null before it graduated. */
  graduatedBy: number | null;
  /** It graduated on one buy, or with one independent buyer or none. */
  singleTrade: boolean;
  /** Days 7, 30 and 90. */
  rings: readonly [RingState, RingState, RingState];
}>;

/** One survival check as a ring: alive lights it only when its proof is not a trade of the creator's party. */
export function ringOf(check: Pick<LaunchFlowResponse["survival"][number], "state" | "independent">): RingState {
  if (check.state === "alive" && check.independent === false) return "unproven";
  return check.state;
}

/** The rings from a tower's own checks, each alive one read against the flow's proof where the flow was read. */
export function clusterAwareRings(checks: readonly [string, string, string], flow: Pick<LaunchFlowResponse, "survival"> | null): readonly [RingState, RingState, RingState] {
  const ring = (index: number): RingState => {
    const state = checks[index] as RingState;
    const entry = flow?.survival[index];
    return entry && state === "alive" ? ringOf({ state: "alive", independent: entry.independent }) : state;
  };
  return [ring(0), ring(1), ring(2)];
}

export function clusterAwareCounts(flow: Pick<LaunchFlowResponse, "buyers" | "graduation" | "survival">): ClusterAwareCounts {
  const rings = flow.survival.map(ringOf);
  return {
    independentBuyers: flow.buyers.independent,
    atLeast: flow.buyers.atLeast,
    creatorLinked: flow.buyers.creatorLinked,
    graduatedBy: flow.graduation.buyers?.independent ?? null,
    singleTrade: flow.graduation.singleTrade,
    rings: [rings[0] ?? "unread", rings[1] ?? "unread", rings[2] ?? "unread"],
  };
}
