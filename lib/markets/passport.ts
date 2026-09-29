/*
 * The Asset Passport's price model.
 *
 * This file exists for one defect. A Stock Token on Robinhood Chain carries an
 * on-chain `uiMultiplier`, and two of the numbers a reader sees are **not
 * measuring the same thing**:
 *
 *   token price          what one token is worth — the Chainlink feed already
 *                        bakes the multiplier in
 *   underlying share     what one share of the company is worth — the venue's
 *                        REST quote, and the per-share equivalent derived from
 *                        the token price by dividing the multiplier back out
 *
 * Subtracting across those two and calling the result a premium is wrong by
 * exactly the accumulated corporate actions. It is not hypothetical: `AAPL`
 * reads `1.000566080061` today, and five of forty sampled equities are already
 * off unity. After a split it would be wrong by a factor.
 *
 * So the basis is part of the value's type, and `divergence()` refuses to
 * compare two figures that are not on the same one. The mistake this module
 * guards is not a wrong formula — it is a correct formula applied to a pair
 * nobody checked.
 */

import { perShareEquivalentPrice, uiMultiplierToNumber } from "../token/ui-multiplier.ts";
import { observed, unknown, type Observed } from "./radar.ts";

/** What a price measures. Not a label — the thing that decides what may be compared. */
export type PriceBasis = "token" | "underlying-share";

export type BasedPrice = Readonly<{
  basis: PriceBasis;
  value: number;
  /** Where it came from, stated per fact. The canon forbids a composite score. */
  source: string;
}>;

export function basedPrice(basis: PriceBasis, value: number, source: string): BasedPrice {
  return Object.freeze({ basis, value, source });
}

export type Divergence =
  | Readonly<{ comparable: true; basis: PriceBasis; percent: number; a: BasedPrice; b: BasedPrice }>
  | Readonly<{ comparable: false; reason: string; a: BasedPrice; b: BasedPrice }>;

/**
 * Compare two prices, or refuse.
 *
 * The refusal is the feature. A caller that hands this a token price and an
 * underlying quote gets a stated reason rather than a number, because the
 * number would be the multiplier's effect dressed up as a market signal.
 */
export function divergence(a: BasedPrice, b: BasedPrice): Divergence {
  if (a.basis !== b.basis) {
    return Object.freeze({
      comparable: false,
      reason: `A ${a.basis} price and a ${b.basis} price measure different things. The difference between them would be the corporate-action multiplier, not a market divergence.`,
      a,
      b,
    });
  }
  if (!Number.isFinite(a.value) || !Number.isFinite(b.value) || b.value === 0) {
    return Object.freeze({ comparable: false, reason: "One of the two prices is missing or zero.", a, b });
  }
  return Object.freeze({
    comparable: true,
    basis: a.basis,
    percent: ((a.value - b.value) / b.value) * 100,
    a,
    b,
  });
}

/**
 * The economic representation of a Stock Token, restated so both bases are
 * visible at once.
 *
 * `drift` is deliberately not called a premium. A multiplier above 1.0 means
 * the token has absorbed dividends or a split; the token price standing above
 * the share price is the design working, and naming it a premium invites a
 * reader to trade the difference.
 */
export type EconomicRepresentation = Readonly<{
  multiplierX: number;
  /** Whether the multiplier has moved off 1.0 at all. */
  hasDrift: boolean;
  tokenPrice: Observed<BasedPrice>;
  perShareEquivalent: Observed<BasedPrice>;
  venueQuote: Observed<BasedPrice>;
  /** Underlying-share against underlying-share. The only pair that means anything. */
  underlyingDivergence: Divergence | null;
}>;

export type EconomicInput = Readonly<{
  uiMultiplier: string | bigint | null;
  /** The Chainlink feed reading. Multiplier-adjusted at source. */
  oracleTokenPrice: number | null;
  /** The venue's REST quote. The raw underlying share. */
  venueQuotePrice: number | null;
}>;

export function economicRepresentation(input: EconomicInput): EconomicRepresentation {
  const multiplierX = input.uiMultiplier == null ? 1 : uiMultiplierToNumber(input.uiMultiplier);

  const tokenPrice: Observed<BasedPrice> =
    input.oracleTokenPrice != null && Number.isFinite(input.oracleTokenPrice)
      ? observed(basedPrice("token", input.oracleTokenPrice, "chainlink:oracle-feed"), "chainlink:oracle-feed")
      : unknown("the oracle feed for this token could not be read");

  /* Derived, and only when the multiplier was actually read. Assuming 1.0 for
     an unread multiplier would silently publish the token price as a share
     price — the exact error this file exists for. */
  const perShareEquivalent: Observed<BasedPrice> =
    tokenPrice.known && input.uiMultiplier != null
      ? observed(
          basedPrice(
            "underlying-share",
            perShareEquivalentPrice(tokenPrice.value.value, input.uiMultiplier),
            "derived: oracle token price ÷ uiMultiplier",
          ),
          "derived: oracle token price ÷ uiMultiplier",
        )
      : unknown(
          input.uiMultiplier == null
            ? "the multiplier could not be read, so a per-share equivalent cannot be derived"
            : "no oracle price to restate per share",
        );

  const venueQuote: Observed<BasedPrice> =
    input.venueQuotePrice != null && Number.isFinite(input.venueQuotePrice)
      ? observed(basedPrice("underlying-share", input.venueQuotePrice, "arcus:spot-overview"), "arcus:spot-overview")
      : unknown("the venue returned no quote for this asset");

  return Object.freeze({
    multiplierX,
    hasDrift: multiplierX !== 1,
    tokenPrice,
    perShareEquivalent,
    venueQuote,
    underlyingDivergence:
      perShareEquivalent.known && venueQuote.known
        ? divergence(perShareEquivalent.value, venueQuote.value)
        : null,
  });
}

/**
 * One fact with its own source, which is the canon's rule for a Passport:
 * *every fact carries its own source and status; no 92/100 green score.*
 */
export type PassportFact = Readonly<{
  label: string;
  value: string;
  source: string;
}>;

export type PassportGroup = Readonly<{ title: string; facts: readonly PassportFact[] }>;

export function fact(label: string, value: string, source: string): PassportFact {
  return Object.freeze({ label, value, source });
}

/** The corporate-action wording, kept in one place because each state is a different claim. */
export const CORPORATE_ACTION_WORDING: Readonly<Record<"none" | "pending" | "paused" | "unknown", string>> =
  Object.freeze({
    none: "None scheduled. The chain reports the same multiplier now and next.",
    pending: "One is scheduled. Pricing will adjust when it takes effect.",
    paused: "Its effective time has passed and the change is not applied yet. Trading usually halts in this window.",
    unknown: "Could not be read. This is not the same as none scheduled, and is not treated as one.",
  });
