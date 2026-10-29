/**
 * Phoenix's perpetual's units for the ticket and the position's actions (B6b): the market's tick and lot when Phoenix
 * sent them whole, and a share of a position in lots. The ticket itself is the terminal's (`perp-ticket-form.tsx`, its
 * model `perp-order-model.ts`, PERP-2).
 *
 * Pure.
 */

import type { FuturesMarket } from "@/lib/phoenix/market-data";
import { lotsFromUnits, type PerpUnits } from "../../../../lib/phoenix/orders-model.ts";

/** The market's units when Phoenix sent them whole; null — no order on this market from the ticket. */
export function unitsOf(market: Pick<FuturesMarket, "tickSize" | "baseLotsDecimals">): PerpUnits | null {
  const { tickSize, baseLotsDecimals } = market;
  if (tickSize === null || baseLotsDecimals === null || !Number.isSafeInteger(tickSize) || tickSize <= 0 || !Number.isInteger(baseLotsDecimals)) return null;
  return { tickSize, baseLotsDecimals };
}

/** A share of a position, in lots, down to the lot and at least one. */
export function shareLots(sizeUnits: number, percent: number, units: PerpUnits): bigint {
  const lots = lotsFromUnits(((sizeUnits * percent) / 100).toFixed(12), units.baseLotsDecimals) ?? 0n;
  return lots > 0n ? lots : 1n;
}
