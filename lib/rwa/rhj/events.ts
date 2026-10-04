/**
 * The twelve material-change events these sources can raise, and the honest
 * accounting of which of them can actually fire here.
 *
 * **A kind that cannot fire is registered carrying the exact thing that would
 * end that, and cannot be armed.** The Scanner registers three conditions
 * that way and the Watchlist refuses to arm a condition with no source,
 * because arming it would be a promise. The same rule applies here and it
 * bites harder, because the split is not about missing endpoints — it is
 * about *time*.
 *
 * Eight of these twelve are **transitions**: a status that changed, a halt that
 * started, a tradability that moved, an action that was added. A transition is
 * a statement about two moments, and this product has one — it deliberately
 * keeps no persistence, so nothing here remembers the previous read. The
 * remaining four are **derivable from a single read**, because both sides of
 * the comparison are values a source states in the same response:
 *
 *   `MULTIPLIER_CHANGED` — `/assets` states `currentMultiplier` and
 *   `pendingMultiplier` together. A pending multiplier is the issuer declaring
 *   its own future change; no memory is required to read a declaration.
 *
 *   `REFERENCE_EXECUTABLE_DIVERGENCE` — a REST reference quote and a venue's
 *   executable quote are two sources answering at once, and the whole product
 *   thesis is that they are not the same number.
 *
 *   `SOURCE_STALE` — `generatedAt` against the moment of receipt.
 *
 *   `SOURCE_CONFLICT` — two sources, one fact, now.
 *
 * The engine implements all twelve and is tested on all twelve, so the day a
 * baseline exists nothing here needs rewriting. What is missing is the
 * baseline, and `armable` says so per kind rather than leaving eight quiet
 * conditions that a reader would reasonably assume are watching.
 */

import type { AttentionSeverity } from "../../home/portfolio/attention.ts";
import type { ChangeKind } from "../../home/research/change.ts";
import { basisOf, type PriceRole, type SourceIdentity } from "./identity.ts";
import { comparePrices, convertThenCompare, sameDecimal, type Multiplier, type RoledPrice } from "./price.ts";
import type { RhjAsset, RhjCorporateAction, RhjQuote, TradingCapabilities } from "./parse.ts";

export const RHJ_EVENT_KINDS = [
  "ASSET_STATUS_CHANGED",
  "TRADING_HALT_STARTED",
  "TRADING_HALT_ENDED",
  "TRADABILITY_CHANGED",
  "MULTIPLIER_CHANGED",
  "CORPORATE_ACTION_ADDED",
  "CONTRACT_DEPLOYMENT_CHANGED",
  "VENUE_MARKET_LISTED",
  "VENUE_MARKET_REMOVED",
  "REFERENCE_EXECUTABLE_DIVERGENCE",
  "SOURCE_STALE",
  "SOURCE_CONFLICT",
] as const;

export type RhjEventKind = (typeof RHJ_EVENT_KINDS)[number];

export type DerivationMode = "SINGLE_READ" | "BASELINE_REQUIRED";

export type EventDefinition = Readonly<{
  kind: RhjEventKind;
  derivation: DerivationMode;
  /** How it reads on the Radar, using the vocabulary the change engine already has. */
  changeKind: ChangeKind;
  severity: AttentionSeverity;
  label: string;
  /** For a baseline-required kind: the one thing that would let it fire. */
  requires: string | null;
}>;

/**
 * `requires` is not a roadmap note. It is the sentence a reader is owed when a
 * condition is visible but silent, and a test asserts every unarmable kind has
 * one.
 */
const BASELINE_SENTENCE =
  "a stored snapshot of the previous read; this product deliberately persists nothing";

export const RHJ_EVENT_CATALOGUE: readonly EventDefinition[] = Object.freeze([
  {
    kind: "ASSET_STATUS_CHANGED",
    derivation: "BASELINE_REQUIRED",
    changeKind: "STATE_CHANGE",
    severity: "CRITICAL",
    label: "Asset status changed",
    requires: BASELINE_SENTENCE,
  },
  {
    kind: "TRADING_HALT_STARTED",
    derivation: "BASELINE_REQUIRED",
    changeKind: "STATE_CHANGE",
    severity: "CRITICAL",
    label: "Trading halt started",
    requires: BASELINE_SENTENCE,
  },
  {
    kind: "TRADING_HALT_ENDED",
    derivation: "BASELINE_REQUIRED",
    changeKind: "STATE_CHANGE",
    severity: "MEDIUM",
    label: "Trading halt ended",
    requires: BASELINE_SENTENCE,
  },
  {
    kind: "TRADABILITY_CHANGED",
    derivation: "BASELINE_REQUIRED",
    changeKind: "STATE_CHANGE",
    severity: "HIGH",
    label: "Tradability changed",
    requires: BASELINE_SENTENCE,
  },
  {
    kind: "MULTIPLIER_CHANGED",
    derivation: "SINGLE_READ",
    changeKind: "VALUE_MOVE",
    severity: "CRITICAL",
    label: "Multiplier change scheduled",
    requires: null,
  },
  {
    kind: "CORPORATE_ACTION_ADDED",
    derivation: "BASELINE_REQUIRED",
    changeKind: "NEW_OBSERVATION",
    severity: "HIGH",
    label: "Corporate action added",
    requires: BASELINE_SENTENCE,
  },
  {
    kind: "CONTRACT_DEPLOYMENT_CHANGED",
    derivation: "BASELINE_REQUIRED",
    changeKind: "STATE_CHANGE",
    severity: "CRITICAL",
    label: "Contract deployment changed",
    requires: BASELINE_SENTENCE,
  },
  {
    kind: "VENUE_MARKET_LISTED",
    derivation: "BASELINE_REQUIRED",
    changeKind: "NEW_OBSERVATION",
    severity: "LOW",
    label: "Venue market listed",
    requires: BASELINE_SENTENCE,
  },
  {
    kind: "VENUE_MARKET_REMOVED",
    derivation: "BASELINE_REQUIRED",
    changeKind: "STATE_CHANGE",
    severity: "HIGH",
    label: "Venue market removed",
    requires: BASELINE_SENTENCE,
  },
  {
    kind: "REFERENCE_EXECUTABLE_DIVERGENCE",
    derivation: "SINGLE_READ",
    changeKind: "VALUE_MOVE",
    severity: "HIGH",
    label: "Reference and executable diverge",
    requires: null,
  },
  {
    kind: "SOURCE_STALE",
    derivation: "SINGLE_READ",
    changeKind: "SOURCE_DEGRADED",
    severity: "MEDIUM",
    label: "Source stale",
    requires: null,
  },
  {
    kind: "SOURCE_CONFLICT",
    derivation: "SINGLE_READ",
    changeKind: "EVIDENCE_CONFLICT",
    severity: "HIGH",
    label: "Sources conflict",
    requires: null,
  },
]);

const BY_KIND: ReadonlyMap<RhjEventKind, EventDefinition> = new Map(
  RHJ_EVENT_CATALOGUE.map(function (definition) {
    return [definition.kind, definition] as const;
  }),
);

export function eventDefinition(kind: RhjEventKind): EventDefinition {
  const definition = BY_KIND.get(kind);
  /* Unreachable while the catalogue covers the union, which a test pins. */
  if (definition === undefined) throw new Error("unregistered event kind: " + kind);
  return definition;
}

/**
 * Whether a kind can fire given what this deployment supplies.
 *
 * A single-read kind is always armable. A transition is armable only when a
 * baseline is genuinely present — not when one is merely expected.
 */
export function armable(kind: RhjEventKind, hasBaseline: boolean): boolean {
  return eventDefinition(kind).derivation === "SINGLE_READ" || hasBaseline;
}

export type RhjEvent = Readonly<{
  kind: RhjEventKind;
  changeKind: ChangeKind;
  severity: AttentionSeverity;
  subjectRef: string;
  subjectLabel: string;
  /** One plain sentence. The number and the state live in their own fields. */
  summary: string;
  previous: string | null;
  current: string | null;
  measuredBps: number | null;
  /** Every source that contributed, so no event is anonymous. */
  identities: readonly SourceIdentity[];
  /** Populated only on a conflict: each source's own value, never reconciled. */
  conflict: readonly Readonly<{ sourceId: string; value: string }>[];
  dedupeKey: string;
}>;

/** What a previous read stated. Absent here; the engine accepts it regardless. */
export type RhjBaseline = Readonly<{
  tokenSymbol: string;
  status: string | null;
  isTradingHalt: boolean | null;
  tradingCapabilities: TradingCapabilities | null;
  currentMultiplier: string | null;
  corporateActionIds: readonly string[] | null;
  contractAddresses: readonly string[] | null;
  venueMarkets: readonly string[] | null;
}>;

/** A venue quote for the same instrument, which RHJ itself never supplies. */
export type ExecutableQuote = Readonly<{
  tokenSymbol: string;
  value: string;
  currency: string;
  identity: SourceIdentity;
}>;

/** An on-chain multiplier reading, for the cross-source check against `/assets`. */
export type OnchainMultiplier = Readonly<{
  tokenSymbol: string;
  value: string;
  sourceId: string;
}>;

export type DeriveInput = Readonly<{
  asOf: string;
  assets: readonly RhjAsset[];
  quotes: readonly RhjQuote[];
  corporateActions: readonly RhjCorporateAction[];
  executable: readonly ExecutableQuote[];
  onchainMultipliers: readonly OnchainMultiplier[];
  /** Names of the markets the venue currently lists, when a venue answered. */
  venueMarkets: readonly string[] | null;
  baselines: readonly RhjBaseline[];
  /** A divergence at or beyond this many basis points is material. */
  divergenceBps: number;
}>;

function keyOf(kind: RhjEventKind, subject: string, discriminator: string): string {
  return [kind, subject, discriminator].join("|");
}

function multiplierEvents(asset: RhjAsset, out: RhjEvent[]): void {
  /* The issuer declaring its own future change: two values in one response, so
     no memory is needed and none is pretended. */
  if (asset.pendingMultiplier === null) return;
  if (sameDecimal(asset.pendingMultiplier, asset.currentMultiplier)) return;

  const definition = eventDefinition("MULTIPLIER_CHANGED");
  const effective = asset.pendingMultiplierEffectiveTime;
  out.push(
    Object.freeze({
      kind: definition.kind,
      changeKind: definition.changeKind,
      severity: definition.severity,
      subjectRef: "rhj:" + asset.tokenSymbol,
      subjectLabel: asset.tokenSymbol,
      summary:
        effective === null
          ? "The issuer has scheduled a multiplier change; no effective time was published."
          : "The issuer has scheduled a multiplier change effective " + effective + ".",
      previous: asset.currentMultiplier,
      current: asset.pendingMultiplier,
      measuredBps: null,
      identities: Object.freeze([asset.identity]),
      conflict: Object.freeze([]),
      dedupeKey: keyOf(definition.kind, asset.tokenSymbol, asset.pendingMultiplier),
    }),
  );
}

function conflictEvent(
  subject: string,
  factLabel: string,
  entries: readonly Readonly<{ sourceId: string; value: string }>[],
  identities: readonly SourceIdentity[],
): RhjEvent {
  const definition = eventDefinition("SOURCE_CONFLICT");
  return Object.freeze({
    kind: definition.kind,
    changeKind: definition.changeKind,
    severity: definition.severity,
    subjectRef: "rhj:" + subject,
    subjectLabel: subject,
    /* Both values are carried and neither is chosen. Averaging them would
       produce a figure no source reported that looks exactly like a fact. */
    summary: "Two sources disagree about " + factLabel + ". Both values are shown; neither is reconciled.",
    previous: null,
    current: null,
    measuredBps: null,
    identities: Object.freeze([...identities]),
    conflict: Object.freeze(entries.map(function (entry) { return Object.freeze({ ...entry }); })),
    dedupeKey: keyOf(definition.kind, subject, factLabel),
  });
}

function referencePrice(quote: RhjQuote): RoledPrice {
  /* The midpoint of the issuer's own bid/ask, which is a REFERENCE on the raw
     underlying share — not an executable price and never labelled one. */
  return { role: "REFERENCE" as PriceRole, value: quote.bid, currency: quote.currency, identity: quote.identity };
}

export function deriveRhjEvents(input: DeriveInput): readonly RhjEvent[] {
  const out: RhjEvent[] = [];
  const baselineBySymbol = new Map(input.baselines.map(function (b) { return [b.tokenSymbol, b] as const; }));
  const assetBySymbol = new Map(input.assets.map(function (a) { return [a.tokenSymbol, a] as const; }));
  const executableBySymbol = new Map(input.executable.map(function (e) { return [e.tokenSymbol, e] as const; }));

  for (const asset of input.assets) {
    multiplierEvents(asset, out);

    /* `/assets` states the multiplier off-chain; the token states it on-chain.
       When they disagree the difference is carried, not resolved — one of them
       is stale and this layer cannot know which. */
    const onchain = input.onchainMultipliers.find(function (m) { return m.tokenSymbol === asset.tokenSymbol; });
    if (onchain !== undefined && !sameDecimal(onchain.value, asset.currentMultiplier)) {
      out.push(
        conflictEvent(
          asset.tokenSymbol,
          "the current multiplier",
          [
            { sourceId: asset.identity.surfaceId, value: asset.currentMultiplier },
            { sourceId: onchain.sourceId, value: onchain.value },
          ],
          [asset.identity],
        ),
      );
    }

    const baseline = baselineBySymbol.get(asset.tokenSymbol);
    if (baseline !== undefined) {
      statusEvents(asset, baseline, out);
      tradabilityEvents(asset, baseline, out);
      deploymentEvents(asset, baseline, out);
    }
  }

  for (const quote of input.quotes) {
    if (quote.identity.freshnessState === "STALE") {
      const definition = eventDefinition("SOURCE_STALE");
      out.push(
        Object.freeze({
          kind: definition.kind,
          changeKind: definition.changeKind,
          severity: definition.severity,
          subjectRef: "rhj:" + quote.tokenSymbol,
          subjectLabel: quote.tokenSymbol,
          summary: "The quote is older than this rule's freshness policy allows.",
          previous: null,
          current: quote.generatedAt,
          measuredBps: null,
          identities: Object.freeze([quote.identity]),
          conflict: Object.freeze([]),
          dedupeKey: keyOf(definition.kind, quote.tokenSymbol, quote.generatedAt),
        }),
      );
    }

    haltEvents(quote, baselineBySymbol.get(quote.tokenSymbol), out);
    divergenceEvent(quote, assetBySymbol.get(quote.tokenSymbol), executableBySymbol.get(quote.tokenSymbol), input.divergenceBps, out);
  }

  corporateActionEvents(input, baselineBySymbol, out);
  venueMarketEvents(input, baselineBySymbol, out);

  return Object.freeze(out);
}

function statusEvents(asset: RhjAsset, baseline: RhjBaseline, out: RhjEvent[]): void {
  if (baseline.status === null || baseline.status === asset.status) return;
  const definition = eventDefinition("ASSET_STATUS_CHANGED");
  out.push(
    Object.freeze({
      kind: definition.kind,
      changeKind: definition.changeKind,
      severity: definition.severity,
      subjectRef: "rhj:" + asset.tokenSymbol,
      subjectLabel: asset.tokenSymbol,
      summary: "The issuer's asset status changed.",
      previous: baseline.status,
      current: asset.status,
      measuredBps: null,
      identities: Object.freeze([asset.identity]),
      conflict: Object.freeze([]),
      dedupeKey: keyOf(definition.kind, asset.tokenSymbol, asset.status),
    }),
  );
}

function capabilityText(capabilities: TradingCapabilities | null): string {
  if (capabilities === null) return "unresolved";
  /* `null` and `""` are rendered as themselves rather than folded together,
     because the provider gives them different meanings. */
  const show = function (value: string | boolean | null): string {
    if (value === null) return "unset";
    if (value === "") return "blank";
    return String(value);
  };
  return [
    "fractional=" + show(capabilities.fractionalTradability),
    "allDay=" + show(capabilities.allDayTradability),
    "extendedHoursFractional=" + show(capabilities.extendedHoursFractionalTradability),
  ].join(" · ");
}

function tradabilityEvents(asset: RhjAsset, baseline: RhjBaseline, out: RhjEvent[]): void {
  /*
   * `null` on a baseline field means *the previous read did not record this*,
   * exactly as it does on every other field of `RhjBaseline`. It does not mean
   * "the previous read saw an unresolvable underlier".
   *
   * The earlier shape only returned when both sides were null, so the first
   * read after a baseline was captured without this field reported a
   * tradability change from "unresolved" that nobody had observed — a
   * transition invented by the absence of a record rather than by anything
   * moving. Under-reporting an unresolved→resolved move is the safe direction;
   * distinguishing the two needs a baseline that stores the state explicitly,
   * which is the same persistence the eight transitions are already waiting on.
   */
  if (baseline.tradingCapabilities === null) return;
  const before = capabilityText(baseline.tradingCapabilities);
  const after = capabilityText(asset.tradingCapabilities);
  if (before === after) return;
  const definition = eventDefinition("TRADABILITY_CHANGED");
  out.push(
    Object.freeze({
      kind: definition.kind,
      changeKind: definition.changeKind,
      severity: definition.severity,
      subjectRef: "rhj:" + asset.tokenSymbol,
      subjectLabel: asset.tokenSymbol,
      summary: "The underlying equity's tradability changed.",
      previous: before,
      current: after,
      measuredBps: null,
      identities: Object.freeze([asset.identity]),
      conflict: Object.freeze([]),
      dedupeKey: keyOf(definition.kind, asset.tokenSymbol, after),
    }),
  );
}

function deploymentEvents(asset: RhjAsset, baseline: RhjBaseline, out: RhjEvent[]): void {
  if (baseline.contractAddresses === null) return;
  const before = [...baseline.contractAddresses].map(function (a) { return a.toLowerCase(); }).sort();
  const after = asset.deployments.map(function (d) { return d.contractAddress.toLowerCase(); }).sort();
  if (before.join(",") === after.join(",")) return;
  const definition = eventDefinition("CONTRACT_DEPLOYMENT_CHANGED");
  out.push(
    Object.freeze({
      kind: definition.kind,
      changeKind: definition.changeKind,
      severity: definition.severity,
      subjectRef: "rhj:" + asset.tokenSymbol,
      subjectLabel: asset.tokenSymbol,
      summary: "The token's contract deployments changed.",
      previous: before.join(", ") || "none",
      current: after.join(", ") || "none",
      measuredBps: null,
      identities: Object.freeze([asset.identity]),
      conflict: Object.freeze([]),
      dedupeKey: keyOf(definition.kind, asset.tokenSymbol, after.join(",")),
    }),
  );
}

function haltEvents(quote: RhjQuote, baseline: RhjBaseline | undefined, out: RhjEvent[]): void {
  if (baseline === undefined || baseline.isTradingHalt === null) return;
  if (baseline.isTradingHalt === quote.isTradingHalt) return;
  const definition = eventDefinition(quote.isTradingHalt ? "TRADING_HALT_STARTED" : "TRADING_HALT_ENDED");
  out.push(
    Object.freeze({
      kind: definition.kind,
      changeKind: definition.changeKind,
      severity: definition.severity,
      subjectRef: "rhj:" + quote.tokenSymbol,
      subjectLabel: quote.tokenSymbol,
      summary: quote.isTradingHalt
        ? "The issuer reports an active trading halt on this asset."
        : "The issuer no longer reports a trading halt on this asset.",
      previous: String(baseline.isTradingHalt),
      current: String(quote.isTradingHalt),
      measuredBps: null,
      identities: Object.freeze([quote.identity]),
      conflict: Object.freeze([]),
      dedupeKey: keyOf(definition.kind, quote.tokenSymbol, String(quote.isTradingHalt)),
    }),
  );
}

function divergenceEvent(
  quote: RhjQuote,
  asset: RhjAsset | undefined,
  executable: ExecutableQuote | undefined,
  thresholdBps: number,
  out: RhjEvent[],
): void {
  if (executable === undefined) return;

  const reference = referencePrice(quote);
  const venue: RoledPrice = {
    role: "EXECUTABLE",
    value: executable.value,
    currency: executable.currency,
    identity: executable.identity,
  };

  /* The two sit on different bases by construction — the REST quote is the raw
     underlying share and a venue quote is the token — so the comparison is only
     legal after the multiplier is applied. Without it, this reports nothing. */
  const multiplier: Multiplier =
    asset === undefined ? null : { value: asset.currentMultiplier, source: "rhj-assets currentMultiplier" };

  const result =
    basisOf(reference.role) === basisOf(venue.role)
      ? comparePrices(reference, venue)
      : convertThenCompare(reference, venue, multiplier);

  if (result.ok !== true) {
    /* A refusal is evidence too: it says the divergence could not be measured
       and why, rather than leaving a silent gap where a number belongs. */
    out.push(
      conflictEvent(
        quote.tokenSymbol,
        "the price basis, so reference and executable cannot be compared (" + result.reason + ")",
        [
          { sourceId: quote.identity.surfaceId, value: quote.bid },
          { sourceId: executable.identity.surfaceId, value: executable.value },
        ],
        [quote.identity, executable.identity],
      ),
    );
    return;
  }
  if (Math.abs(result.differenceBps) < thresholdBps) return;

  const definition = eventDefinition("REFERENCE_EXECUTABLE_DIVERGENCE");
  out.push(
    Object.freeze({
      kind: definition.kind,
      changeKind: definition.changeKind,
      severity: definition.severity,
      subjectRef: "rhj:" + quote.tokenSymbol,
      subjectLabel: quote.tokenSymbol,
      summary:
        "The issuer's reference quote and the venue's executable quote differ by more than the threshold, " +
        "compared on the " +
        (result.basis === "TOKEN" ? "token" : "underlying share") +
        (result.conversion === null ? "." : " after " + result.conversion + "."),
      previous: reference.value,
      current: venue.value,
      measuredBps: result.differenceBps,
      identities: Object.freeze([quote.identity, executable.identity]),
      conflict: Object.freeze([]),
      dedupeKey: keyOf(definition.kind, quote.tokenSymbol, String(result.differenceBps)),
    }),
  );
}

function corporateActionEvents(
  input: DeriveInput,
  baselines: ReadonlyMap<string, RhjBaseline>,
  out: RhjEvent[],
): void {
  for (const action of input.corporateActions) {
    const baseline = baselines.get(action.tokenSymbol);
    if (baseline === undefined || baseline.corporateActionIds === null) continue;
    if (baseline.corporateActionIds.includes(action.id)) continue;
    const definition = eventDefinition("CORPORATE_ACTION_ADDED");
    out.push(
      Object.freeze({
        kind: definition.kind,
        changeKind: definition.changeKind,
        severity: definition.severity,
        subjectRef: "rhj:" + action.tokenSymbol,
        subjectLabel: action.tokenSymbol,
        summary:
          "A corporate action appeared that the previous read did not carry: " +
          action.type.replace("CORPORATE_ACTION_TYPE_", "").replace(/_/g, " ").toLowerCase() +
          ".",
        previous: null,
        current: action.status,
        measuredBps: null,
        identities: Object.freeze([action.identity]),
        conflict: Object.freeze([]),
        dedupeKey: keyOf(definition.kind, action.tokenSymbol, action.id),
      }),
    );
  }
}

function venueMarketEvents(
  input: DeriveInput,
  baselines: ReadonlyMap<string, RhjBaseline>,
  out: RhjEvent[],
): void {
  if (input.venueMarkets === null) return;
  const current = new Set(input.venueMarkets);

  for (const [symbol, baseline] of baselines) {
    if (baseline.venueMarkets === null) continue;
    const before = new Set(baseline.venueMarkets);
    for (const market of current) {
      if (!market.startsWith(symbol) || before.has(market)) continue;
      out.push(marketEvent("VENUE_MARKET_LISTED", symbol, market, "The venue now lists this market."));
    }
    for (const market of before) {
      if (!market.startsWith(symbol) || current.has(market)) continue;
      out.push(marketEvent("VENUE_MARKET_REMOVED", symbol, market, "The venue no longer lists this market."));
    }
  }
}

function marketEvent(kind: RhjEventKind, symbol: string, market: string, summary: string): RhjEvent {
  const definition = eventDefinition(kind);
  return Object.freeze({
    kind: definition.kind,
    changeKind: definition.changeKind,
    severity: definition.severity,
    subjectRef: "rhj:" + symbol,
    subjectLabel: symbol,
    summary,
    previous: null,
    current: market,
    measuredBps: null,
    /* A venue listing is the venue's fact, and no RHJ identity is attached to
       it — borrowing the issuer's provenance for a venue observation would
       misattribute it. */
    identities: Object.freeze([]),
    conflict: Object.freeze([]),
    dedupeKey: keyOf(definition.kind, symbol, market),
  });
}
