/* Route quotes + comparison (STEP 4). Several routes can quote the SAME instrument
   (Arcus RFQ vs Uniswap AMM on Robinhood Chain). Ryntra shows the quotes side by side with
   fees, impact and freshness — a COMPARISON, not a selector: today execution runs through
   Arcus only; if/when a second route becomes executable, selection becomes an explicit user
   action, never automatic. INVARIANTS (tested):
     - every quote carries a non-empty fee disclosure line, even when the fee is zero
     - comparison never auto-selects: it ranks and annotates only
     - a quote with non-fresh data can never rank "best" */

import type { DataState, ExecutionMode } from "./capability.ts";
import { combineDataStates } from "./capability.ts";
import type { RouteId } from "./ids.ts";
import type { InstrumentKey } from "./instrument.ts";

export type RouteQuote = {
  route: RouteId;
  instrument: InstrumentKey;
  side: "buy" | "sell";
  /** Input size, decimal string in base units. */
  size: string;
  /** Expected output amount (quote units), decimal string; null when the route can't quote. */
  expectedOut: string | null;
  /** Effective unit price implied by the quote; null when unquotable. */
  price: string | null;
  /** Route fee in basis points when known; null = unknown (shown as unknown, never as 0). */
  feeBps: number | null;
  /** Mandatory human disclosure line: venue fee, integrator fee, referral — spelled out. */
  feeNote: string;
  /** AMM price impact %; null = not applicable (RFQ/CLOB) or unknown. */
  priceImpactPct: number | null;
  freshness: DataState;
  observedAt: number | null;
  /** Machine warning codes, e.g. "off-hours", "oracle-stale", "high-impact". */
  warnings: string[];
  executionMode: ExecutionMode;
};

export type RankedQuote = {
  quote: RouteQuote;
  /** Rank among comparable (fresh, quotable) quotes; null when excluded from ranking. */
  rank: number | null;
  /** Why the quote was excluded from ranking, when it was. */
  excluded?: "no-quote" | "not-fresh";
};

const DECIMAL_RE = /^-?(\d+)(?:\.(\d+))?$/;

/** Compare two decimal amount strings at FULL precision: both sides are scaled to a common
    fraction length and compared as BigInt — integers and decimals alike never round through
    Number. Only a non-decimal input (exponent notation etc.) falls back to Number as a last
    resort. */
export function compareAmounts(a: string, b: string): number {
  const ma = DECIMAL_RE.exec(a);
  const mb = DECIMAL_RE.exec(b);
  if (ma && mb) {
    const fa = ma[2] ?? "";
    const fb = mb[2] ?? "";
    const scale = Math.max(fa.length, fb.length);
    const ia = BigInt(ma[1] + fa.padEnd(scale, "0")) * (a.startsWith("-") ? -1n : 1n);
    const ib = BigInt(mb[1] + fb.padEnd(scale, "0")) * (b.startsWith("-") ? -1n : 1n);
    return ia === ib ? 0 : ia > ib ? 1 : -1;
  }
  const na = Number(a);
  const nb = Number(b);
  return na === nb ? 0 : na > nb ? 1 : -1;
}

/**
 * Rank quotes by expected output (more out = better for the user). Quotes that are not fresh
 * or could not quote are annotated and EXCLUDED from ranking rather than silently dropped.
 * This function ranks — it never selects; ranking is display information, not routing.
 */
export function rankQuotes(quotes: readonly RouteQuote[]): RankedQuote[] {
  const eligible = quotes
    .filter((q) => q.expectedOut != null && q.freshness === "fresh")
    .sort((a, b) => compareAmounts(b.expectedOut as string, a.expectedOut as string));
  const rankOf = new Map(eligible.map((q, i) => [q, i + 1]));
  return quotes.map((q) => {
    const rank = rankOf.get(q) ?? null;
    if (rank != null) return { quote: q, rank };
    return { quote: q, rank: null, excluded: q.expectedOut == null ? "no-quote" : "not-fresh" };
  });
}

/** Overall freshness of a comparison view — any stale/unknown leg makes the view say so. */
export function comparisonFreshness(quotes: readonly RouteQuote[]): DataState {
  return combineDataStates(quotes.map((q) => q.freshness));
}

/** A quote is renderable only when its disclosure line is present. */
export function hasFeeDisclosure(q: RouteQuote): boolean {
  return q.feeNote.trim().length > 0;
}
