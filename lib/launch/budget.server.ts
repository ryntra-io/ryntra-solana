/**
 * A market's budget as this server can say it now — what Ryntra earned on a
 * market for its liquidity, what is in Ryntra's steps on it, what is left.
 *
 * Ryntra does not account any market's budget yet: what a market earned and
 * what is left of it are not counted — `NOT_COUNTED`, said as such and never
 * as zero. What stands in Ryntra's steps is read from their position on the
 * chain wherever the steps are placed; a position there and not read now is
 * `UNREAD`, never hidden.
 */

import type { LaunchMarketBudgetView } from "../api/v1/contract.ts";

/** Ryntra's steps on a market: none, placed with what they hold now, or placed and not read now. */
export type LadderRead =
  | Readonly<{ state: "NONE" }>
  | Readonly<{
      state: "PLACED";
      pool: string;
      position: string;
      pairRaw: string;
      tokensRaw: string;
      /** Each step: its price in the pair currency per token, and the pair currency it holds. */
      bins: readonly Readonly<{ price: number; pairRaw: string }>[];
      lowerPrice: number;
      upperPrice: number;
    }>
  | Readonly<{ state: "UNREAD"; pool: string; position: string | null }>;

export function marketBudget(ladder: LadderRead): LaunchMarketBudgetView {
  return {
    state: "NOT_COUNTED",
    earnedRaw: null,
    reserveRaw: null,
    ladder: ladder.state,
    deployed: ladder.state === "PLACED" ? { pairRaw: ladder.pairRaw, tokensRaw: ladder.tokensRaw } : null,
  };
}
