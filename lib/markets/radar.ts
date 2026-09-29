/*
 * The Tokenized Markets universe, as data.
 *
 * This module exists because of one number pair the live venue API returns:
 * **231 instruments are listed on Robinhood Chain, and 3 of them are
 * executable here.** A Radar that renders 231 tradable-looking rows on the only
 * Ryntra surface where a person can move real funds would be the most expensive
 * lie this product could tell, and it is the easy one to tell by accident —
 * every row has a price, a name and a logo.
 *
 * So three rules are held by the types rather than by discipline:
 *
 *   1. There is no `tradable` field. Tradability is *derived* from evidence —
 *      an executable route and a live price — and cannot be written down.
 *   2. A value that is not known is `Unknown` with a reason. A number is only
 *      ever a number that was observed; there is no path for a missing figure
 *      to arrive as `0`.
 *   3. When two venue endpoints disagree about what an instrument is, the
 *      disagreement is carried rather than resolved. One real case exists
 *      today, and silently picking a winner is how a surface stops being
 *      evidence.
 */

/** A value that was observed, or an explicit absence. Never a zero standing in for absence. */
export type Observed<T> =
  | Readonly<{ known: true; value: T; source: string }>
  | Readonly<{ known: false; reason: string }>;

export function observed<T>(value: T, source: string): Observed<T> {
  return Object.freeze({ known: true as const, value, source });
}

export function unknown<T>(reason: string): Observed<T> {
  return Object.freeze({ known: false as const, reason });
}

/**
 * The product's three instrument classes.
 *
 * The venue reports five categories; the canon works in three. Indices and
 * commodities join equities because they share what actually decides the
 * outcome — a real-world underlying, market hours, and a reference price that
 * can diverge from the token. The venue's own category is preserved beside the
 * class rather than discarded, so nothing is lost in the mapping.
 */
export type InstrumentClass = "STOCK_TOKEN" | "GENERIC_ERC20" | "COMMUNITY_TOKEN";

const CLASS_OF_VENUE_CATEGORY: Readonly<Record<string, InstrumentClass>> = Object.freeze({
  stock: "STOCK_TOKEN",
  index: "STOCK_TOKEN",
  commodity: "STOCK_TOKEN",
  crypto: "GENERIC_ERC20",
  meme: "COMMUNITY_TOKEN",
  EQUITIES: "STOCK_TOKEN",
  INDICES: "STOCK_TOKEN",
  COMMODITIES: "STOCK_TOKEN",
  CRYPTO: "GENERIC_ERC20",
  MEME: "COMMUNITY_TOKEN",
});

export function classOfVenueCategory(category: string): InstrumentClass | null {
  return CLASS_OF_VENUE_CATEGORY[category] ?? null;
}

/**
 * Where an instrument's class came from, including when the sources disagree.
 *
 * `CASHCAT` is `meme` in the token list and `CRYPTO` in the overview. That is
 * not a bug to smooth over — a venue that cannot agree with itself about what
 * an asset is has told the reader something, and the safest class wins while
 * the conflict stays visible.
 */
export type ClassOrigin =
  | Readonly<{ agreed: true; venueCategory: string }>
  | Readonly<{ agreed: false; tokenCategory: string; overviewCategory: string }>;

/**
 * Everything tradability is allowed to depend on. There is deliberately no
 * boolean here: `isTradable` is the only way to get one, and it needs both.
 */
export type TradabilityEvidence = Readonly<{
  /** Symbols this repository can actually execute, from the pre-sign allowlist. */
  executableRoutes: readonly string[];
  price: Observed<number>;
}>;

export function isTradable(evidence: TradabilityEvidence): boolean {
  return evidence.executableRoutes.length > 0 && evidence.price.known;
}

/**
 * The venue's own fundamentals block, per figure.
 *
 * `spot/overview` returns a `financials` object on **all 231** rows and this
 * module discarded every field of it, because Radar had no use for them. A
 * Screener does — most of what a person screens *on* lives here.
 *
 * Every figure is `Observed` for the reason the whole file exists: coverage is
 * uneven and real. Measured 2026-08-19: `marketCap` on 228 rows, `peRatio`,
 * `dividendYield`, `priceToBook` on 180 each, `revenue` on 178. The 51 rows
 * without a P/E are the crypto and community tokens, which do not have one —
 * a condition over P/E must be unable to judge them, not silently score them 0.
 */
export type Fundamentals = Readonly<{
  marketCap: Observed<number>;
  peRatio: Observed<number>;
  dividendYield: Observed<number>;
  priceToBook: Observed<number>;
  revenue: Observed<number>;
  currency: Observed<string>;
}>;

export type RadarRow = Readonly<{
  symbol: string;
  name: string;
  address: string;
  instrumentClass: InstrumentClass;
  origin: ClassOrigin;
  /** The venue's own verification flag. The strongest safety signal available here. */
  venueVerified: boolean;
  price: Observed<number>;
  changePercent24h: Observed<number>;
  volume24h: Observed<number>;
  tradability: TradabilityEvidence;
  /**
   * When the venue's token registry says this token appeared, in epoch ms.
   *
   * Present on 211 of 231 (measured 2026-08-19). It is what makes *a new Stock
   * Token was detected* answerable **without a baseline snapshot** — the venue
   * already stamps it, so nothing here has to remember yesterday's list. The
   * twenty without one are `Unknown`; a listing date is not inferred from
   * anything else.
   */
  listedAt: Observed<number>;
  /** The token registry's own provenance word — `server` or `admin`. */
  registrySource: Observed<string>;
  fundamentals: Fundamentals;
}>;

export type VenueToken = Readonly<{
  symbol: string;
  name?: string;
  address: string;
  category: string;
  verified: boolean;
  /** Epoch seconds or milliseconds — the venue has used both; `epochMs` normalises. */
  addedTimestamp?: number;
  source?: string;
}>;

export type VenueOverview = Readonly<{
  ticker: string;
  name?: string;
  category: string;
  quote?: Readonly<{ price?: unknown; changePercent24h?: unknown; volume24h?: unknown }>;
  financials?: Readonly<{
    marketCap?: unknown;
    peRatio?: unknown;
    dividendYield?: unknown;
    priceToBook?: unknown;
    revenue?: unknown;
    currency?: unknown;
  }>;
}>;

/** A finite number, or an explicit absence carrying why. */
function numberOrUnknown(raw: unknown, source: string, missing: string): Observed<number> {
  return typeof raw === "number" && Number.isFinite(raw) ? observed(raw, source) : unknown(missing);
}

/** A non-empty string, or an explicit absence. */
function textOrUnknown(raw: unknown, source: string, missing: string): Observed<string> {
  return typeof raw === "string" && raw.trim().length > 0 ? observed(raw, source) : unknown(missing);
}

/**
 * A venue timestamp in epoch **milliseconds**.
 *
 * The registry has returned both seconds and milliseconds for this field. A
 * ten-digit value is seconds; anything smaller is not a date this product will
 * guess at. Getting the unit wrong here would date a token to 1970 and make
 * every listing look ancient, which is a silent wrong answer rather than a
 * loud one — so the boundary is explicit and tested.
 */
export function epochMs(raw: unknown): Observed<number> {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
    return unknown("the venue's token registry carries no listing timestamp for this token");
  }
  const ms = raw > 1e12 ? raw : raw * 1000;
  return observed(ms, "arcus:spot-tokens.addedTimestamp");
}

/**
 * The venue's fundamentals for one row, each figure carrying its own absence.
 *
 * A token the overview does not carry at all yields six `Unknown`s with the
 * same reason, rather than an empty object a caller could read as zeroes.
 */
function fundamentalsOf(match: VenueOverview | undefined): Fundamentals {
  const absent = "this token is not in the venue's priced overview";
  const f = match?.financials;
  const num = (raw: unknown, name: string) =>
    numberOrUnknown(
      raw,
      "arcus:spot-overview.financials",
      match ? `the venue reports no ${name} for this token` : absent,
    );
  return Object.freeze({
    marketCap: num(f?.marketCap, "market capitalisation"),
    peRatio: num(f?.peRatio, "price/earnings ratio"),
    dividendYield: num(f?.dividendYield, "dividend yield"),
    priceToBook: num(f?.priceToBook, "price/book ratio"),
    revenue: num(f?.revenue, "revenue"),
    currency: textOrUnknown(
      f?.currency,
      "arcus:spot-overview.financials",
      match ? "the venue reports no reporting currency for this token" : absent,
    ),
  });
}

/**
 * Build the universe from the two venue endpoints.
 *
 * Every row is produced from the token list, because that is the list of
 * things that exist on the chain. The overview contributes prices. A token the
 * overview does not price is still a row — with `Unknown` where the number
 * would be, which is the whole point.
 */
export function buildRadar(
  tokens: readonly VenueToken[],
  overview: readonly VenueOverview[],
  executableSymbols: readonly string[],
): readonly RadarRow[] {
  const priced = new Map(overview.map((entry) => [entry.ticker, entry]));
  const executable = new Set(executableSymbols);
  const rows: RadarRow[] = [];

  for (const token of tokens) {
    const match = priced.get(token.symbol);
    const tokenClass = classOfVenueCategory(token.category);
    const overviewClass = match ? classOfVenueCategory(match.category) : tokenClass;
    if (!tokenClass) continue; // a category this product has no class for is not invented into one

    const agreed = !match || tokenClass === overviewClass;
    /* The safest class wins a disagreement: a community token misread as
       generic crypto loses the caution the class carries, and the reverse
       costs nothing. */
    const instrumentClass: InstrumentClass = agreed
      ? tokenClass
      : tokenClass === "COMMUNITY_TOKEN" || overviewClass === "COMMUNITY_TOKEN"
        ? "COMMUNITY_TOKEN"
        : tokenClass;

    const price = match
      ? numberOrUnknown(match.quote?.price, "arcus:spot-overview", "the venue returns no price for this token")
      : unknown<number>("this token is not in the venue's priced overview");

    rows.push(
      Object.freeze({
        symbol: token.symbol,
        name: token.name ?? match?.name ?? token.symbol,
        address: token.address,
        instrumentClass,
        origin: agreed
          ? Object.freeze({ agreed: true as const, venueCategory: token.category })
          : Object.freeze({
              agreed: false as const,
              tokenCategory: token.category,
              overviewCategory: match!.category,
            }),
        venueVerified: token.verified === true,
        price,
        changePercent24h: match
          ? numberOrUnknown(match.quote?.changePercent24h, "arcus:spot-overview", "no 24-hour change reported")
          : unknown<number>("not in the priced overview"),
        volume24h: match
          ? numberOrUnknown(match.quote?.volume24h, "arcus:spot-overview", "no 24-hour volume reported")
          : unknown<number>("not in the priced overview"),
        tradability: Object.freeze({
          executableRoutes: executable.has(token.symbol) ? Object.freeze([token.symbol]) : Object.freeze([]),
          price,
        }),
        listedAt: epochMs(token.addedTimestamp),
        registrySource: textOrUnknown(
          token.source,
          "arcus:spot-tokens.source",
          "the token registry states no provenance for this token",
        ),
        fundamentals: fundamentalsOf(match),
      }),
    );
  }

  return Object.freeze(rows);
}

export type RadarSummary = Readonly<{
  listed: number;
  executable: number;
  unverified: number;
  withoutPrice: number;
  conflicted: number;
  byClass: Readonly<Record<InstrumentClass, number>>;
}>;

export function summarise(rows: readonly RadarRow[]): RadarSummary {
  const byClass: Record<InstrumentClass, number> = { STOCK_TOKEN: 0, GENERIC_ERC20: 0, COMMUNITY_TOKEN: 0 };
  let executable = 0;
  let unverified = 0;
  let withoutPrice = 0;
  let conflicted = 0;

  for (const row of rows) {
    byClass[row.instrumentClass] += 1;
    if (isTradable(row.tradability)) executable += 1;
    if (!row.venueVerified) unverified += 1;
    if (!row.price.known) withoutPrice += 1;
    if (!row.origin.agreed) conflicted += 1;
  }

  return Object.freeze({
    listed: rows.length,
    executable,
    unverified,
    withoutPrice,
    conflicted,
    byClass: Object.freeze(byClass),
  });
}

/**
 * The analytics this Radar does not have, and what would end that.
 *
 * Kept as data so the surface states them rather than omitting them. The
 * product strategy marks this set `PROPOSED`: Robinhood, Arcus and 0x publish
 * no Pump/BullX-style dataset, and the canon's anti-scope names *full meme
 * analytics before data coverage exists*.
 */
export const ABSENT_ANALYTICS: readonly Readonly<{ name: string; gate: string }>[] = Object.freeze([
  Object.freeze({
    name: "Holder concentration",
    gate: "No indexer provides holder distribution for these tokens. It needs its own provider decision.",
  }),
  Object.freeze({
    name: "Creator and admin wallet activity",
    gate: "No venue endpoint reports deployer or admin behaviour, and inferring it from transfers alone would be a guess.",
  }),
  Object.freeze({
    name: "Large-wallet and buy/sell flow",
    gate: "Requires a trade-level indexer this product does not run and no provider supplies.",
  }),
  Object.freeze({
    name: "Liquidity depth and its history",
    gate: "The venue reports 24-hour volume, which is not depth. Depth needs the pool state and a source for it.",
  }),
]);
