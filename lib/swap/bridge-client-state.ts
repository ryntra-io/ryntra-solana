import type { SwapNetwork } from "./catalog.ts";

export type BridgeContext = Readonly<{
  from: { network: SwapNetwork; asset: string };
  to: { network: SwapNetwork; asset: string };
  amountRaw: string | null;
  source: string | null;
  destination: string;
}>;

export function bridgeTokenKey(network: SwapNetwork, asset: string): string {
  return `${network}:${network === "solana" ? asset : asset.toLowerCase()}`;
}

export function bridgeContextKey(context: BridgeContext): string {
  return JSON.stringify([bridgeTokenKey(context.from.network, context.from.asset), bridgeTokenKey(context.to.network, context.to.asset), context.amountRaw, context.source, context.destination]);
}

export function bridgeQuoteMatches(quote: { from: BridgeContext["from"] & { amountRaw: string }; to: BridgeContext["to"] }, context: BridgeContext): boolean {
  return context.amountRaw !== null && quote.from.amountRaw === context.amountRaw
    && bridgeTokenKey(quote.from.network, quote.from.asset) === bridgeTokenKey(context.from.network, context.from.asset)
    && bridgeTokenKey(quote.to.network, quote.to.asset) === bridgeTokenKey(context.to.network, context.to.asset);
}

export function bridgeReviewCurrent(review: { key: string; expiresAt: string } | null, key: string, now: number): boolean {
  return review !== null && review.key === key && Date.parse(review.expiresAt) - now >= 10_000;
}

/** An HTTP failure is not proof that the request stopped before broadcast. */
export function bridgeSubmitNeedsRecovery(failure: { code: string; extra?: Record<string, unknown> }): boolean {
  const state = failure.extra?.state;
  return failure.extra?.submitBoundary !== "NOT_CROSSED"
    || (typeof state === "string" && !["RESERVED", "EXPIRED_BEFORE_SUBMIT", "SOURCE_FAILED"].includes(state));
}
