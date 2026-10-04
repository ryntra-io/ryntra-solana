import type { RadarRow } from "./radar.ts";

/**
 * The Scanner: standing conditions that watch, and the events they raise.
 *
 * The third of the product's three discovery objects, and the one that stops
 * this being a market list. Radar pushes what is happening; the Screener
 * answers a question a person asked once; the Scanner keeps asking and tells
 * you **what changed and how it knows**.
 *
 * Two properties are held by the types rather than by discipline:
 *
 *   1. **An event cannot exist without its source.** `source` is a required
 *      field of `ScannerEvent` and `raise()` is the only constructor, so there
 *      is no path to an event whose provenance is added at render time or left
 *      out. The failure this prevents is the ordinary one: a scanner that says
 *      *NVDA: liquidity deteriorated* and cannot say which read produced it.
 *   2. **A Scanner has no result set.** There is no query, no filter and no
 *      table in this file, and `screen.ts` has no way to raise an event. That
 *      is what makes them two objects rather than two views over one query.
 *
 * And one property is held by data: every kind states its **coverage** — how
 * much of the universe it can actually see. Three of the conditions the
 * product lists have no source in any endpoint this product reads, so they are
 * registered here carrying the exact thing that would end each, in the same
 * shape `ABSENT_ANALYTICS` uses. Registering them is the point: dropping them
 * would make the Scanner read complete, which is the more expensive error.
 */

/* ------------------------------------------------------------------ events */

/**
 * Where an event came from. Required, and not a sentence — a feed, a field on
 * it, and when it was read.
 */
export type EventSource = Readonly<{
  /** The endpoint or contract call. */
  feed: string;
  /** The exact field on it that decided this. */
  field: string;
  /** Epoch ms the read was taken. */
  observedAt: number;
}>;

export type ScannerEventKind =
  | "new-listing"
  | "unverified-listing"
  | "underlying-closed"
  | "venue-market-offline"
  | "class-disagreement"
  | "price-unavailable"
  | "corporate-action-scheduled"
  | "spread-threshold"
  | "liquidity-deterioration"
  | "route-changed";

/** Whether the event asks for a look, or merely records a state. */
export type EventWeight = "attention" | "information";

export type ScannerEvent = Readonly<{
  kind: ScannerEventKind;
  symbol: string;
  name: string;
  /** One line stating what happened. Never advice, never a verdict. */
  headline: string;
  weight: EventWeight;
  source: EventSource;
}>;

/**
 * The only way to make an event.
 *
 * It takes the source as an argument rather than defaulting it, so an event
 * without provenance is not merely discouraged — it does not typecheck.
 */
export function raise(
  kind: ScannerEventKind,
  row: RadarRow,
  headline: string,
  weight: EventWeight,
  source: EventSource,
): ScannerEvent {
  return Object.freeze({ kind, symbol: row.symbol, name: row.name, headline, weight, source });
}

/* ------------------------------------------------------------------- kinds */

/**
 * What a kind reads, or the exact reason it cannot read anything yet.
 *
 * `source: null` is not "not implemented". It means no endpoint this product
 * reads carries the figure at all, and `gate` says what would change that.
 */
export type KindSpec = Readonly<{
  kind: ScannerEventKind;
  label: string;
  /** The standing question, in the person's words. */
  question: string;
  source: Readonly<{ feed: string; field: string }> | null;
  gate: string | null;
}>;

export const SCANNER_KINDS: readonly KindSpec[] = Object.freeze([
  Object.freeze({
    kind: "new-listing" as const,
    label: "A new token appeared",
    question: "What has been listed on the chain recently?",
    source: Object.freeze({ feed: "arcus:spot-tokens", field: "addedTimestamp" }),
    gate: null,
  }),
  Object.freeze({
    kind: "unverified-listing" as const,
    label: "Listed, and the venue has not verified it",
    question: "What is tradeable-looking that the venue itself has not vouched for?",
    source: Object.freeze({ feed: "arcus:spot-tokens", field: "verified" }),
    gate: null,
  }),
  Object.freeze({
    kind: "underlying-closed" as const,
    label: "The underlying market closed while the token keeps trading",
    question: "Which instruments are in the off-hours risk regime right now?",
    source: Object.freeze({ feed: "arcus:/v1/markets", field: "isOutsideRth" }),
    gate: null,
  }),
  Object.freeze({
    kind: "venue-market-offline" as const,
    label: "The venue took its market offline",
    question: "Which instruments has the venue itself stopped running a market for?",
    source: Object.freeze({ feed: "arcus:/v1/markets", field: "status" }),
    gate: null,
  }),
  Object.freeze({
    kind: "class-disagreement" as const,
    label: "The venue's two endpoints disagree about what this is",
    question: "Where does the venue contradict itself about an instrument's class?",
    source: Object.freeze({ feed: "arcus:spot-tokens + spot-overview", field: "category" }),
    gate: null,
  }),
  Object.freeze({
    kind: "price-unavailable" as const,
    label: "Listed with no price",
    question: "What is listed that nothing will price?",
    source: Object.freeze({ feed: "arcus:spot-overview", field: "quote.price" }),
    gate: null,
  }),
  Object.freeze({
    kind: "corporate-action-scheduled" as const,
    label: "A corporate action is scheduled",
    question: "Which tokens have a multiplier change coming?",
    /* The source is known and proven — the Asset Passport reads exactly this
       pair. What is missing is a way to sweep it: 231 separate `eth_call`s is
       a new venue call, and this wave adds none. */
    source: null,
    gate: "The signal exists on chain — newUIMultiplier() against uiMultiplier(), read per token by the Asset Passport — and there is no public JSON API for it. Sweeping 231 tokens needs a batched on-chain read this wave does not add.",
  }),
  Object.freeze({
    kind: "spread-threshold" as const,
    label: "The spread crossed a threshold",
    question: "Where has it become expensive to get in or out?",
    source: null,
    gate: "No endpoint this product reads returns a bid, an ask or a book. The spot overview carries a single price and the token registry carries none, so there is nothing to threshold. It needs a quote or depth source that does not exist today.",
  }),
  Object.freeze({
    kind: "liquidity-deterioration" as const,
    label: "Liquidity on a held instrument deteriorated",
    question: "Has it become harder to exit something I hold?",
    source: null,
    gate: "Needs two things this product does not have: order-book depth, which no endpoint returns, and a position model, which is not built yet.",
  }),
  Object.freeze({
    kind: "route-changed" as const,
    label: "A route changed venue",
    question: "Did the way an instrument would execute change?",
    source: null,
    gate: "There is one route provider and one allowlist, so a change here would be this repository editing its own configuration rather than an observation. It becomes real when a second adapter exists.",
  }),
]);

export function kindSpec(kind: ScannerEventKind): KindSpec | undefined {
  return SCANNER_KINDS.find((spec) => spec.kind === kind);
}

/* ------------------------------------------------------------------ inputs */

/**
 * The venue's perps market, as far as the Scanner needs it.
 *
 * Market hours live on the **perps** market list, not on the spot universe,
 * and only some spot tokens have a perps market at all. Measured 2026-08-19:
 * 33 of 47 perps `baseAsset`s are also spot tokens, so this join covers 33 of
 * 231 instruments and the surface says so.
 */
export type VenuePerpMarket = Readonly<{
  baseAsset: string;
  status: string;
  isOutsideRth?: boolean | null;
}>;

export type ScanPolicy = Readonly<{
  /** How recent counts as new. */
  newListingWithinDays: number;
}>;

export const DEFAULT_SCAN_POLICY: ScanPolicy = Object.freeze({ newListingWithinDays: 7 });

/** What each kind could see this run — measured, never assumed. */
export type KindCoverage = Readonly<{
  kind: ScannerEventKind;
  /** Rows this kind was able to judge. `0` with a gate means it has no source. */
  covered: number;
  total: number;
  fired: number;
}>;

export type ScanResult = Readonly<{
  events: readonly ScannerEvent[];
  coverage: readonly KindCoverage[];
  ranAt: number;
  /** Rows considered. */
  checked: number;
}>;

/* -------------------------------------------------------------------- scan */

const days = (ms: number) => ms / 86_400_000;

/**
 * Run every standing condition once.
 *
 * Zero events is a first-class answer. When nothing fires, `coverage` still
 * reports what was looked at, so the surface can say *nothing is firing, and
 * here is what was checked* rather than showing an empty box that reads as a
 * failure — or worse, filling it.
 */
export function runScan(
  rows: readonly RadarRow[],
  perps: readonly VenuePerpMarket[],
  now: number,
  policy: ScanPolicy = DEFAULT_SCAN_POLICY,
): ScanResult {
  const events: ScannerEvent[] = [];
  const byMarket = new Map(perps.map((market) => [market.baseAsset, market]));
  const counted = new Map<ScannerEventKind, { covered: number; fired: number }>();

  const tally = (kind: ScannerEventKind, covered: boolean, fired: boolean) => {
    const entry = counted.get(kind) ?? { covered: 0, fired: 0 };
    if (covered) entry.covered += 1;
    if (fired) entry.fired += 1;
    counted.set(kind, entry);
  };

  for (const row of rows) {
    /* New listings. The venue stamps the date, so no baseline is kept and
       nothing has to remember yesterday's universe. */
    const listedKnown = row.listedAt.known;
    const isNew = listedKnown && days(now - row.listedAt.value) <= policy.newListingWithinDays;
    tally("new-listing", listedKnown, Boolean(isNew));
    if (isNew && row.listedAt.known) {
      events.push(
        raise(
          "new-listing",
          row,
          `Listed ${Math.floor(days(now - row.listedAt.value))} day(s) ago`,
          "information",
          Object.freeze({ feed: "arcus:spot-tokens", field: "addedTimestamp", observedAt: now }),
        ),
      );
    }

    /* Listed and unvouched-for. Read on its own it is a state; read beside a
       new listing it is the pair that matters. */
    tally("unverified-listing", true, !row.venueVerified);
    if (!row.venueVerified) {
      events.push(
        raise(
          "unverified-listing",
          row,
          "The venue's own registry does not mark this token verified",
          "attention",
          Object.freeze({ feed: "arcus:spot-tokens", field: "verified", observedAt: now }),
        ),
      );
    }

    /* The market-hours join, on the instruments that have one. */
    const market = byMarket.get(row.symbol);
    const hoursKnown = market !== undefined && typeof market.isOutsideRth === "boolean";
    tally("underlying-closed", hoursKnown, hoursKnown && market.isOutsideRth === true);
    if (hoursKnown && market.isOutsideRth === true) {
      events.push(
        raise(
          "underlying-closed",
          row,
          "The underlying market is outside regular trading hours and the token still trades",
          "attention",
          Object.freeze({ feed: "arcus:/v1/markets", field: "isOutsideRth", observedAt: now }),
        ),
      );
    }

    const statusKnown = market !== undefined;
    tally("venue-market-offline", statusKnown, statusKnown && market.status !== "ONLINE");
    if (statusKnown && market.status !== "ONLINE") {
      events.push(
        raise(
          "venue-market-offline",
          row,
          `The venue reports this market ${market.status}`,
          "attention",
          Object.freeze({ feed: "arcus:/v1/markets", field: "status", observedAt: now }),
        ),
      );
    }

    tally("class-disagreement", true, !row.origin.agreed);
    if (!row.origin.agreed) {
      events.push(
        raise(
          "class-disagreement",
          row,
          `The token registry calls it ${row.origin.tokenCategory} and the overview calls it ${row.origin.overviewCategory}`,
          "attention",
          Object.freeze({ feed: "arcus:spot-tokens + spot-overview", field: "category", observedAt: now }),
        ),
      );
    }

    tally("price-unavailable", true, !row.price.known);
    if (!row.price.known) {
      events.push(
        raise(
          "price-unavailable",
          row,
          row.price.reason,
          "information",
          Object.freeze({ feed: "arcus:spot-overview", field: "quote.price", observedAt: now }),
        ),
      );
    }
  }

  const coverage = SCANNER_KINDS.map((spec) => {
    const entry = counted.get(spec.kind) ?? { covered: 0, fired: 0 };
    return Object.freeze({
      kind: spec.kind,
      covered: spec.source ? entry.covered : 0,
      total: rows.length,
      fired: spec.source ? entry.fired : 0,
    });
  });

  return Object.freeze({
    events: Object.freeze(events),
    coverage: Object.freeze(coverage),
    ranAt: now,
    checked: rows.length,
  });
}
