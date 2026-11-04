/**
 * Which venue a ladder's steps sit at (spec «Каталог етапу A»): DLMM limit
 * orders where the pool takes them; Jupiter Trigger V1 only as the fallback.
 *
 * | Venue           | One transaction holds | Who fills              | Minimum per order | Ryntra fee |
 * |-----------------|-----------------------|------------------------|-------------------|------------|
 * | DLMM limit bins | up to 50 steps        | the pool itself        | none              | none       |
 * | Trigger V1      | one step              | Jupiter's keeper       | 5 USD             | fee policy v2 |
 *
 * Trigger V1 is a mainnet service — Jupiter's API and keeper — so on devnet
 * the fallback is planned and refused, never improvised. Trigger V2 is not a
 * venue here at all: its vault is custodial (Privy) and pays no integrator fee.
 *
 * Pure.
 */

import { TRIGGER_MIN_ORDER_USD } from "./costs.ts";
import type { LadderNetwork } from "./network.ts";

export type VenueChoice =
  | Readonly<{ venue: "dlmm"; available: true }>
  | Readonly<{ venue: "trigger"; available: false; reason: "MAINNET_ONLY" | "BELOW_MINIMUM" }>
  | Readonly<{ venue: null; available: false; reason: "NO_POOL" }>;

export function chooseVenue(
  args: Readonly<{
    /** A pool of the pair exists. */
    pool: boolean;
    /** And takes limit orders (its function type, read on chain). */
    takesLimitOrders: boolean;
    network: LadderNetwork;
    /** Each step's dollars, for the fallback's minimum. */
    stepUsd: readonly number[];
  }>,
): VenueChoice {
  if (args.pool && args.takesLimitOrders) return { venue: "dlmm", available: true };
  if (args.stepUsd.some((usd) => !(usd >= TRIGGER_MIN_ORDER_USD))) return { venue: "trigger", available: false, reason: "BELOW_MINIMUM" };
  if (args.network === "devnet") return { venue: "trigger", available: false, reason: "MAINNET_ONLY" };
  return { venue: null, available: false, reason: "NO_POOL" };
}
