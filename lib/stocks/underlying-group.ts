/**
 * One underlying, several representations — the grouping rule.
 *
 * Two confirmed representations are the same underlying when they name the
 * same instrument, never merely the same company: the same underlying symbol
 * and, where both issuers state an ISIN, the same ISIN — a share class, an
 * ETF, an ADR or a private instrument has its own symbol and stays its own
 * group, and two issuers whose ISINs differ under one ticker are two
 * listings, not one. Where an issuer states no ISIN (the tag-only issuers,
 * whose underlying is implied by the token's symbol) the match is by symbol
 * alone and is labelled `implied`, so the reader sees which side of the
 * comparison rests on a catalogue and which on a naming pattern.
 *
 * Pure: rows in, the group out. The quotes that make the comparison are the
 * server's (`compare.server.ts`); nothing here asks the venue anything.
 */

import type { StockRepresentation } from "./representations.ts";
import type { StockRow } from "./universe.server.ts";

/** How firmly the representation's underlying is known. */
export type UnderlyingConfidence = "confirmed" | "implied";

export type UnderlyingGroup = Readonly<{
  /** The underlying symbol the group is keyed by, upper-case. */
  symbol: string;
  /** The ISIN the confirmed members agree on, when any states one. */
  isin: string | null;
  /** The representation the page is open on. */
  anchor: StockRow;
  /** Every other representation of the same underlying, the confirmed ones first, then by liquidity. */
  others: readonly StockRow[];
}>;

export function underlyingConfidence(representation: StockRepresentation): UnderlyingConfidence {
  return representation.issuerConfirmation === "issuer-catalogue" ? "confirmed" : "implied";
}

function normalizedSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

/**
 * Whether `candidate` represents the same underlying as `anchor`.
 *
 * - different underlying symbols → no (a share class is a different symbol);
 * - both state an ISIN and they differ → no (two listings under one ticker);
 * - otherwise yes — by ISIN when both state one, by symbol when one of them
 *   cannot say more.
 */
export function sameUnderlying(anchor: StockRepresentation, candidate: StockRepresentation): boolean {
  /* Two instruments priced in different units — a share and a token — are
     never one underlying, whatever company they name: a pre-IPO exposure
     token and a listed share (or two pre-IPO issuers' tokens) are compared
     nowhere in this product. */
  if ((anchor.instrument?.unitBasis ?? "share") !== (candidate.instrument?.unitBasis ?? "share") || (anchor.instrument?.class ?? "listed-equity") !== (candidate.instrument?.class ?? "listed-equity")) return false;
  if (normalizedSymbol(anchor.underlying.symbol) !== normalizedSymbol(candidate.underlying.symbol)) return false;
  const a = anchor.underlying.isin;
  const b = candidate.underlying.isin;
  if (a !== null && b !== null) return a.toUpperCase() === b.toUpperCase();
  return true;
}

/**
 * Other issuers' instruments on the same company that are **not** the same
 * underlying — a PreStocks token and a listed share's token on one company
 * that has gone public (SpaceX: SPACEX beside SPCXx).
 * Named on the page as separate instruments with separate rights, never
 * ranked against each other; the key is the normalized company name and the
 * match requires a different issuer.
 */
export function sameCompanyOtherIssuer(rows: readonly StockRow[], anchor: StockRow): readonly StockRow[] {
  const key = anchor.representation.companyKey ?? null;
  if (key === null) return [];
  return rows.filter((row) => row.representation.mint !== anchor.representation.mint && row.representation.companyKey === key && row.representation.issuer.id !== anchor.representation.issuer.id && !sameUnderlying(anchor.representation, row.representation));
}

const liquidity = (row: StockRow): number => row.market.liquidityUsd ?? 0;

/** The group of `anchor` inside `rows`; the anchor itself is never among the others. */
export function groupUnderlying(rows: readonly StockRow[], anchor: StockRow): UnderlyingGroup {
  const others = rows
    .filter((row) => row.representation.mint !== anchor.representation.mint && sameUnderlying(anchor.representation, row.representation))
    .sort((a, b) => {
      const confidence = Number(underlyingConfidence(b.representation) === "confirmed") - Number(underlyingConfidence(a.representation) === "confirmed");
      return confidence !== 0 ? confidence : liquidity(b) - liquidity(a);
    });
  const isin = [anchor, ...others].map((row) => row.representation.underlying.isin).find((value): value is string => value !== null) ?? null;
  return { symbol: normalizedSymbol(anchor.representation.underlying.symbol), isin, anchor, others };
}
