/**
 * A route, normalized — and never one Ryntra produced.
 *
 * **Ryntra does not route.** It reads what a provider says a swap would do, puts
 * it in one shape, and states which provider said it and when. That distinction
 * is the whole reason this file exists: a normalized quote from somebody else is
 * evidence, and a number this product computed itself would be a
 * recommendation wearing evidence's clothes.
 *
 * The shape is deliberately the one a person has to argue with:
 *
 * ```text
 * expectedOut   what the provider thinks you get
 * minimumOut    what you are guaranteed at the stated slippage
 * priceImpact   what your own size does to the price
 * fees          what is taken, and by whom
 * expiresAt     when this stops being a quote and becomes a memory
 * hops          every venue the value passes through
 * ```
 *
 * `minimumOut` is not optional and is never inferred. A quote that states an
 * expected output without a floor is a number that can move against you between
 * reading it and signing it, and a past swap receipt already recorded what that
 * costs: a delivered amount below the authorized minimum has to be reportable as
 * a deviation, which requires the minimum to have been recorded in the first
 * place.
 */

import type { AssetIdentity } from "../asset.ts";

/** One venue the value passes through on its way. */
export type RouteHop = Readonly<{
  /** The protocol that would execute this leg, in the provider's own words. */
  protocol: string;
  from: AssetIdentity;
  to: AssetIdentity;
  /** The provider's share of the route through this leg, 0–1, or null if unstated. */
  share: number | null;
}>;

/** Something taken out of the trade, and by whom. */
export type RouteFee = Readonly<{
  /** Who takes it: a protocol, the aggregator, the network. */
  taker: string;
  /** In the asset it is actually charged in, never converted for presentation. */
  amount: string;
  assetCode: string;
  /** What it is for, in plain words. */
  reason: string;
}>;

export type RoutePlan = Readonly<{
  provider: string;
  assetIn: AssetIdentity;
  assetOut: AssetIdentity;
  amountIn: string;
  /** What the provider expects to deliver. Not a promise. */
  expectedOut: string;
  /** The floor at the stated slippage. Never inferred, never absent. */
  minimumOut: string;
  /** Slippage the quote was requested at, in basis points. */
  slippageBps: number;
  /** What this trade's own size does to the price, as a fraction, or null. */
  priceImpact: number | null;
  fees: readonly RouteFee[];
  hops: readonly RouteHop[];
  /** After this, the quote is history rather than a quote. */
  expiresAt: string | null;
  /** The provider's own identifier for this quote, for support and for receipts. */
  quoteId: string | null;
}>;

/**
 * Two providers disagreeing about the same trade.
 *
 * Registered in the shape now even though only one provider is integrated,
 * because the disagreement is the point of comparing at all — and a comparison
 * that can only ever hold one entry teaches a reader that there is nothing to
 * compare.
 */
export type RouteComparison = Readonly<{
  plans: readonly RoutePlan[];
  /** The best expected output, and by how much, or null when fewer than two answered. */
  spread: Readonly<{ bestProvider: string; worstProvider: string; differenceRatio: number }> | null;
}>;

/** Compare what two or more providers said about one trade. Pure. */
export function compareRoutes(plans: readonly RoutePlan[]): RouteComparison {
  if (plans.length < 2) return { plans, spread: null };

  const numeric = plans
    .map((plan) => ({ plan, out: Number(plan.expectedOut) }))
    .filter((entry) => Number.isFinite(entry.out) && entry.out > 0);
  if (numeric.length < 2) return { plans, spread: null };

  const sorted = [...numeric].sort((a, b) => b.out - a.out);
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];

  return {
    plans,
    spread: {
      bestProvider: best.plan.provider,
      worstProvider: worst.plan.provider,
      differenceRatio: (best.out - worst.out) / best.out,
    },
  };
}

/** Whether a quote is still one. A quote with no expiry is treated as expired. */
export function routeIsLive(plan: RoutePlan, nowIso: string): boolean {
  if (!plan.expiresAt) return false;
  return Date.parse(plan.expiresAt) > Date.parse(nowIso);
}
