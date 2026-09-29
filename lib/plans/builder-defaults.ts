/**
 * Where a new plan's starting price comes from — `RYN-UX-CLARITY-001` §3.2–3.3.
 *
 * The builder prefills the planned entry so a person does not retype a
 * figure the desk already knows. The figure must be a price per underlying
 * share, and the form must say which price it is: the issuer's reference
 * when there is one, else the token's own market price converted to a share
 * through the known multiplier. A token whose units are unknown has no
 * per-share price, so nothing is prefilled — a token price labelled as a
 * share price would be a false figure — and there is no invented number
 * (the old chain ended in `100` when every source was missing).
 *
 * Money is never prefilled: the budget and the planned risk are the person's
 * decision, not the platform's suggestion.
 */

/**
 * `token-price`: a token-priced instrument (the pre-IPO issuers) starts from
 * the token's own market price — the plan is per token, so the figure is on
 * the plan's own unit and no share is implied (`RYN-STOCKS-PROVIDERS-001`).
 */
export type StartingPriceSource = "reference" | "token-per-share" | "token-price";

export type StartingPrice = Readonly<{ perShare: number; source: StartingPriceSource }>;

type PricedRow = Readonly<{
  reference: Readonly<{ perShare: number | null }>;
  tokenPerShareUsd: number | null;
  /** The venue's price per token as the wallet shows it; read only for a token-priced instrument. */
  market?: Readonly<{ priceUsd: number | null }>;
  representation?: Readonly<{ instrument?: Readonly<{ unitBasis: "share" | "token" }> }>;
}>;

export function startingPrice(row: PricedRow): StartingPrice | null {
  if (row.representation?.instrument?.unitBasis === "token") {
    const price = row.market?.priceUsd ?? null;
    return price !== null && Number.isFinite(price) && price > 0 ? { perShare: price, source: "token-price" } : null;
  }
  if (row.reference.perShare !== null && Number.isFinite(row.reference.perShare) && row.reference.perShare > 0) {
    return { perShare: row.reference.perShare, source: "reference" };
  }
  if (row.tokenPerShareUsd !== null && Number.isFinite(row.tokenPerShareUsd) && row.tokenPerShareUsd > 0) {
    return { perShare: row.tokenPerShareUsd, source: "token-per-share" };
  }
  return null;
}

/** The bound the builder offers above the starting price: two per cent, a protective default the hint explains. */
export const MAX_PRICE_OVER_ENTRY = 1.02;

/** The example the invalidation's placeholder shows — ten per cent under the entry, an example and never the field's value. */
export const INVALIDATION_EXAMPLE_UNDER_ENTRY = 0.9;

/**
 * A budget carried from the asset page, only when the person chose it there.
 * A preset that was never pressed is an example, not a decision; the address
 * carries `budget=` only after a press, and the builder reads it once.
 */
export function carriedBudget(text: string | null): number | null {
  if (text === null) return null;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 1 ? value : null;
}

/**
 * A condition carried from the analysis card (`RYN-NANSEN-EVIDENCE-001`):
 * `metric:window:operator:figure`, the figure the card showed at the press.
 * The builder starts the row from it — the metric and the window as pressed,
 * the threshold rounded down to two significant figures so the person edits
 * a round number rather than the source's exact one, the mode *warn* until
 * the person chooses otherwise. Anything malformed is nothing: the address
 * bar is not a schema, and the registry judges the rest at save.
 */
export type CarriedCondition = Readonly<{ metric: string; window: string; operator: "gt" | "gte" | "lt" | "lte"; threshold: number }>;

export function carriedCondition(text: string | null): CarriedCondition | null {
  if (text === null) return null;
  const match = /^([a-z0-9_]{1,64}):(24h|7d|now):(gt|gte|lt|lte):(-?\d{1,15}(?:\.\d{1,6})?)$/.exec(text);
  if (!match) return null;
  const figure = Number(match[4]);
  if (!Number.isFinite(figure)) return null;
  const magnitude = Math.abs(figure);
  const rounded = magnitude >= 100 ? Math.floor(magnitude / 10 ** (Math.floor(Math.log10(magnitude)) - 1)) * 10 ** (Math.floor(Math.log10(magnitude)) - 1) : Math.floor(magnitude);
  return { metric: match[1], window: match[2], operator: match[3] as CarriedCondition["operator"], threshold: figure < 0 ? -rounded : rounded };
}
