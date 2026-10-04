import { getMarkets, getPositions, type ArcusMarket, type ArcusPosition } from "@/lib/arcus/public";
import { paperList, type PaperTrade } from "@/lib/paper/rpc";
import { compileResearchMandate, type MandateScopeItem, type MandateSource, type ResearchMandate } from "@/lib/home/research/mandate";
import { compileMonitorRules } from "@/lib/home/research/monitor-rule";
import { detectMaterialChanges, type FactBaseline, type FactObservation, type SourceDegradation } from "@/lib/home/research/change";
import { projectRuleRun, type SchedulerRecord } from "@/lib/home/research/scheduler";
import { projectResearch, type ResearchProjection, type ResearchSourceState } from "@/lib/home/research/read-model";
import {
  fetchRhjAssets,
  fetchRhjCorporateActions,
  fetchRhjPrices,
  outcomeSentence,
  type SourceOutcome,
} from "@/lib/rwa/rhj/client";
import { deriveRhjEvents, type RhjEvent } from "@/lib/rwa/rhj/events";
import type { RhjAsset, RhjCorporateAction, RhjQuote } from "@/lib/rwa/rhj/parse";
import { RHJ_SCOPE_KIND, RHJ_SOURCE_ID, RHJ_SOURCE_LABEL, rhjFacts, rhjMateriality, rhjSubjectRef } from "@/lib/rwa/rhj/radar";

/**
 * Where the Radar's facts actually come from.
 *
 * Three reads, all of them already in this product, none of them new: the
 * reader's Arcus positions, the venue's own market list, and the local paper
 * book. The effects live in `loadResearchReads` and everything after it is
 * pure, so every state this surface can render is reachable in a test by
 * handing the pure half a literal.
 *
 * **The mandate is compiled, not stored.** Editing a mandate needs persistence
 * this surface deliberately does not add, so the mandate is derived
 * deterministically from configuration that already exists — the positions the
 * reader holds, the paper trades they opened, the markets those touch. That is
 * an honest read-only mandate rather than an editor over a table that is not
 * there, and the surface says so.
 *
 * **Every baseline is a recorded fact, never a remembered one.** There is no
 * price history in this product, so nothing here compares a reading to "the
 * last time we looked". A position's baseline is the venue's own
 * `averageEntryPrice`; a market's funding baseline is the venue's current
 * funding rate against the next one it declares. Both sides of every comparison
 * are values a source states in the same read.
 *
 * **No scheduler record exists yet.** The only real scheduler in this product
 * is account-level — declared Vercel crons — and it records watermarks
 * rather than run times, in a table this surface is not authorized to read. So
 * every rule reports `enrolled: false` and an `UNKNOWN` last run with the
 * reason, and its next run is `DECLARED` from the deployment's own cron
 * expression. That is exactly the rule — an unknown is reported as unknown —
 * applied rather than worked around.
 */

export const RESEARCH_POSITION_SOURCE = "arcus-positions";
export const RESEARCH_MARKET_SOURCE = "arcus-markets";
export const RESEARCH_PAPER_SOURCE = "paper-book";

/**
 * The cadence this mandate declares.
 *
 * Bound to the deployment's own `vercel.json` cron by a test, so the schedule a
 * reader sees on the Scheduled view cannot drift away from the schedule the
 * platform actually runs.
 */
export const RESEARCH_CADENCE_CRON = "0 7 * * *";

/** How long a venue observation is treated as current, matching the Portfolio read. */
const VENUE_MAX_AGE_SECONDS = 120;
const PAPER_MAX_AGE_SECONDS = 900;

/**
 * The direct Robinhood read.
 *
 * `/assets` and `/corporate-actions` are one call each. `/prices` is per-symbol
 * — the provider asks for that form — so it is bounded twice: only symbols that
 * already have something to say, and never more than this many. A Radar that
 * priced every Stock Token would be a screener, which the product keeps as a
 * separate object, and it would spend the documented 60 requests/second on
 * rows nobody asked about.
 */
const RHJ_MAX_PRICE_SYMBOLS = 12;
/** How long a direct issuer read is treated as current. */
const RHJ_MAX_AGE_SECONDS = 300;
/** A reference-against-executable gap at or beyond this is material. */
const RHJ_DIVERGENCE_BPS = 100;

/** A move of this size against a recorded baseline is material. */
const PRICE_MOVE_BPS = 500;
/** Funding is small in absolute terms and moves in relative steps. */
const FUNDING_MOVE_BPS = 1_000;

export type ResearchReads = Readonly<{
  wallet: string | null;
  /** `null` = not asked (no wallet). `"FAILED"` = asked and the venue did not answer. */
  positions: readonly ArcusPosition[] | "FAILED" | null;
  markets: readonly ArcusMarket[] | "FAILED";
  paper: readonly PaperTrade[] | "FAILED" | null;
  /** The direct issuer read: what answered, and what it said when it refused. */
  rhj: RhjReads;
}>;

export type RhjReads = Readonly<{
  assets: readonly RhjAsset[];
  quotes: readonly RhjQuote[];
  corporateActions: readonly RhjCorporateAction[];
  /** One outcome per endpoint, in the order they were called. */
  outcomes: readonly SourceOutcome[];
}>;

export async function loadResearchReads(input: Readonly<{
  wallet: string | null;
  telegramId: number | null; accountId?: string | null;
}>): Promise<ResearchReads> {
  let positions: readonly ArcusPosition[] | "FAILED" | null = null;
  if (input.wallet) {
    try {
      positions = await getPositions(input.wallet);
    } catch {
      positions = "FAILED";
    }
  }

  let markets: readonly ArcusMarket[] | "FAILED";
  try {
    markets = await getMarkets();
  } catch {
    markets = "FAILED";
  }

  let paper: readonly PaperTrade[] | "FAILED" | null = null;
  if (input.telegramId !== null || input.accountId) {
    const result = await paperList({ accountId: input.accountId ?? null, telegramId: input.telegramId });
    paper = result.ok ? result.data.open : "FAILED";
  }

  return { wallet: input.wallet, positions, markets, paper, rhj: await loadRhjReads(holdingSymbols(positions, paper)) };
}

/**
 * The underlying symbols this reader actually touches.
 *
 * An Arcus market is `TSLA-USD`; a Stock Token is `TSLA`. Taking the part
 * before the dash is the whole mapping, and it is deliberately not a lookup
 * table — a table would need maintaining and would silently miss a market the
 * venue added this morning.
 */
function holdingSymbols(
  positions: readonly ArcusPosition[] | "FAILED" | null,
  paper: readonly PaperTrade[] | "FAILED" | null,
): readonly string[] {
  const out = new Set<string>();
  if (Array.isArray(positions)) {
    for (const position of positions) out.add(position.marketDisplayName.split("-")[0]);
  }
  if (Array.isArray(paper)) {
    for (const trade of paper) out.add(trade.market.split("-")[0]);
  }
  return [...out].filter((symbol) => symbol.length > 0).sort();
}

/**
 * Which Stock Tokens are worth a price call.
 *
 * A token the issuer has something to say about — a scheduled multiplier, an
 * action in progress — plus anything this reader holds. That set is the
 * material one by construction, which is the Radar's own rule: the object is
 * a change, not a ranked asset.
 */
function rhjPriceSymbols(
  assets: readonly RhjAsset[],
  corporateActions: readonly RhjCorporateAction[],
  holdings: readonly string[],
): readonly string[] {
  const wanted = new Set<string>(holdings);
  for (const asset of assets) {
    if (asset.pendingMultiplier !== null) wanted.add(asset.tokenSymbol);
  }
  for (const action of corporateActions) {
    if (action.status === "CORPORATE_ACTION_STATUS_IN_PROGRESS") wanted.add(action.tokenSymbol);
  }
  const known = new Set(assets.map((asset) => asset.tokenSymbol));
  /* Only symbols the issuer actually lists. Asking for a price on a ticker the
     asset list does not carry would spend a call to learn nothing. */
  return [...wanted].filter((symbol) => known.has(symbol)).sort().slice(0, RHJ_MAX_PRICE_SYMBOLS);
}

async function loadRhjReads(holdings: readonly string[]): Promise<RhjReads> {
  const options = { now: () => new Date().toISOString(), maxAgeSeconds: RHJ_MAX_AGE_SECONDS };
  const [assetRead, corporateRead] = await Promise.all([
    fetchRhjAssets(options),
    fetchRhjCorporateActions(options),
  ]);

  const symbols = rhjPriceSymbols(assetRead.rows, corporateRead.rows, holdings);
  const priceReads = await Promise.all(symbols.map((symbol) => fetchRhjPrices(symbol, options)));

  return {
    assets: assetRead.rows,
    corporateActions: corporateRead.rows,
    quotes: priceReads.flatMap((read) => read.rows),
    /* Every endpoint that was called reports its own outcome. A price read that
       refused is not hidden behind an asset read that answered. */
    outcomes: [assetRead.outcome, corporateRead.outcome, ...priceReads.map((read) => read.outcome)],
  };
}

/** The events the direct read can raise on its own, with no memory of a previous one. */
export function rhjEvents(reads: ResearchReads, asOf: string): readonly RhjEvent[] {
  return deriveRhjEvents({
    asOf,
    assets: reads.rhj.assets,
    quotes: reads.rhj.quotes,
    corporateActions: reads.rhj.corporateActions,
    /* No venue quote is joined on this surface yet, and no chain read is swept
       here, so the two cross-source kinds have nothing to compare. They are
       registered and tested; what is absent is the second source, not the rule. */
    executable: [],
    onchainMultipliers: [],
    venueMarkets: null,
    /* Nothing is persisted, so no baseline exists and the eight transition
       kinds stay silent rather than reporting a first sighting as a change. */
    baselines: [],
    divergenceBps: RHJ_DIVERGENCE_BPS,
  });
}

function sources(reads: ResearchReads): readonly MandateSource[] {
  const list: MandateSource[] = [{
    sourceId: RESEARCH_MARKET_SOURCE,
    label: "Arcus markets",
    rights: { entitlement: "PROVIDER_PUBLIC", storage: true, aiProcessing: true, alerting: true, redistribution: false },
    freshnessPolicy: { maxAgeSeconds: VENUE_MAX_AGE_SECONDS },
  }];
  if (reads.positions !== null) {
    list.push({
      sourceId: RESEARCH_POSITION_SOURCE,
      label: "Arcus positions",
      rights: { entitlement: "OWN_ACCOUNT", storage: true, aiProcessing: true, alerting: true, redistribution: false },
      freshnessPolicy: { maxAgeSeconds: VENUE_MAX_AGE_SECONDS },
    });
  }
  if (reads.paper !== null) {
    list.push({
      sourceId: RESEARCH_PAPER_SOURCE,
      label: "Paper book",
      rights: { entitlement: "OWN_ACCOUNT", storage: true, aiProcessing: true, alerting: true, redistribution: false },
      freshnessPolicy: { maxAgeSeconds: PAPER_MAX_AGE_SECONDS },
    });
  }
  list.push({
    sourceId: RHJ_SOURCE_ID,
    label: RHJ_SOURCE_LABEL,
    /* A public issuer endpoint: no account, no key, and redistribution is not
       claimed, because nothing here was licensed to republish it. */
    rights: { entitlement: "PROVIDER_PUBLIC", storage: false, aiProcessing: false, alerting: true, redistribution: false },
    freshnessPolicy: { maxAgeSeconds: RHJ_MAX_AGE_SECONDS },
  });
  return list;
}

const positionRef = (market: string) => `arcus:perp:${market}`;
const paperRef = (id: string) => `paper:${id}`;
const marketRef = (market: string) => `arcus:market:${market}`;

function scope(reads: ResearchReads): readonly MandateScopeItem[] {
  const items: MandateScopeItem[] = [];
  const markets = new Set<string>();

  if (Array.isArray(reads.positions)) {
    for (const position of reads.positions) {
      items.push({ kind: "HOLDING", ref: positionRef(position.marketDisplayName), label: position.marketDisplayName });
      markets.add(position.marketDisplayName);
    }
  }
  if (Array.isArray(reads.paper)) {
    for (const trade of reads.paper) {
      items.push({ kind: "STRATEGY", ref: paperRef(trade.id), label: `${trade.market} paper ${trade.side}` });
      markets.add(trade.market);
    }
  }
  /* Only the markets this reader actually touches. A radar over every venue
     market would be a screener, and the Radar ranks changes rather than
     assets. */
  for (const market of [...markets].sort()) {
    items.push({ kind: "CHAIN", ref: marketRef(market), label: market });
  }
  /* The issuer's own instruments enter scope only where the issuer has said
     something about them on this read. Registering all two hundred would turn
     the Radar into the screener the product keeps separate. */
  for (const symbol of rhjScopeSymbols(reads)) {
    items.push({ kind: RHJ_SCOPE_KIND, ref: rhjSubjectRef(symbol), label: symbol });
  }
  return items;
}

function rhjScopeSymbols(reads: ResearchReads): readonly string[] {
  const symbols = new Set<string>();
  for (const asset of reads.rhj.assets) {
    if (asset.pendingMultiplier !== null) symbols.add(asset.tokenSymbol);
  }
  for (const action of reads.rhj.corporateActions) {
    if (action.status === "CORPORATE_ACTION_STATUS_IN_PROGRESS") symbols.add(action.tokenSymbol);
  }
  for (const quote of reads.rhj.quotes) {
    if (quote.isTradingHalt || quote.identity.freshnessState === "STALE") symbols.add(quote.tokenSymbol);
  }
  return [...symbols].sort();
}

export function buildResearchMandate(input: Readonly<{
  reads: ResearchReads;
  ownerRef: string;
  effectiveFrom: string;
}>): ResearchMandate | null {
  const items = scope(input.reads);
  if (items.length === 0) return null;
  const result = compileResearchMandate({
    mandateId: "home",
    ownerRef: input.ownerRef,
    scope: items,
    sources: sources(input.reads),
    freshness: { maxAgeSeconds: VENUE_MAX_AGE_SECONDS },
    materiality: [
      {
        factKey: "markPrice",
        comparison: "RELATIVE_BPS",
        value: PRICE_MOVE_BPS,
        severity: "MEDIUM",
        scopeKinds: ["HOLDING", "STRATEGY"],
      },
      {
        factKey: "nextFundingRate",
        comparison: "RELATIVE_BPS",
        value: FUNDING_MOVE_BPS,
        severity: "LOW",
        scopeKinds: ["CHAIN"],
      },
      {
        factKey: "marketStatus",
        comparison: "STATE_CHANGE",
        value: null,
        severity: "HIGH",
        scopeKinds: ["CHAIN"],
      },
      /* One threshold per Robinhood event kind, each carrying that kind's own
         severity rather than a shared default. */
      ...rhjMateriality(),
    ],
    cadence: {
      mode: "SCHEDULE",
      cron: RESEARCH_CADENCE_CRON,
      quietHours: { fromHourUtc: 22, toHourUtc: 6 },
      cooldownSeconds: 3_600,
    },
    /* AI calls per day is zero, and it is a real budget rather than a slogan:
       nothing on this path may call a model, and the number says so. */
    budgets: { dataReadsPerDay: 24, aiCallsPerDay: 0, maxAlertsPerDay: 6 },
    notificationChannels: ["surface"],
    effectiveFrom: input.effectiveFrom,
    reviewAt: null,
    expiresAt: null,
  });
  return result.ok ? result.mandate : null;
}

function marketBy(reads: ResearchReads): Map<string, ArcusMarket> {
  return Array.isArray(reads.markets)
    ? new Map(reads.markets.map((market) => [market.marketDisplayName, market]))
    : new Map();
}

function observations(input: Readonly<{ reads: ResearchReads; asOf: string }>): readonly FactObservation[] {
  const markets = marketBy(input.reads);
  const list: FactObservation[] = [];
  const push = (entry: Omit<FactObservation, "observedAt" | "effectiveAt" | "entitlement"> & {
    entitlement: FactObservation["entitlement"];
  }) => {
    list.push({ ...entry, observedAt: input.asOf, effectiveAt: null });
  };

  if (Array.isArray(input.reads.positions)) {
    for (const position of input.reads.positions) {
      const ref = positionRef(position.marketDisplayName);
      /* The venue reports the same fact twice — once on the position and once
         on the market row. When the two disagree that is a real conflict, and
         showing both is the whole point. */
      push({
        factKey: "markPrice",
        subjectRef: ref,
        subjectLabel: position.marketDisplayName,
        sourceId: RESEARCH_POSITION_SOURCE,
        value: position.markPrice ?? null,
        unit: "USD",
        evidenceRefs: [`evidence:${RESEARCH_POSITION_SOURCE}:${position.marketDisplayName}`],
        entitlement: "OWN_ACCOUNT",
      });
      const market = markets.get(position.marketDisplayName);
      if (market !== undefined) {
        push({
          factKey: "markPrice",
          subjectRef: ref,
          subjectLabel: position.marketDisplayName,
          sourceId: RESEARCH_MARKET_SOURCE,
          value: market.markPrice ?? null,
          unit: "USD",
          evidenceRefs: [`evidence:${RESEARCH_MARKET_SOURCE}:${position.marketDisplayName}`],
          entitlement: "PROVIDER_PUBLIC",
        });
      }
    }
  }

  if (Array.isArray(input.reads.paper)) {
    for (const trade of input.reads.paper) {
      const market = markets.get(trade.market);
      push({
        factKey: "markPrice",
        subjectRef: paperRef(trade.id),
        subjectLabel: `${trade.market} paper ${trade.side}`,
        sourceId: RESEARCH_MARKET_SOURCE,
        value: market?.markPrice ?? null,
        unit: "USD",
        evidenceRefs: [`evidence:${RESEARCH_MARKET_SOURCE}:${trade.market}`],
        entitlement: "PROVIDER_PUBLIC",
      });
    }
  }

  for (const market of markets.values()) {
    const ref = marketRef(market.marketDisplayName);
    push({
      factKey: "nextFundingRate",
      subjectRef: ref,
      subjectLabel: market.marketDisplayName,
      sourceId: RESEARCH_MARKET_SOURCE,
      value: market.nextFundingRate ?? null,
      unit: "rate",
      evidenceRefs: [`evidence:${RESEARCH_MARKET_SOURCE}:${market.marketDisplayName}:funding`],
      entitlement: "PROVIDER_PUBLIC",
    });
    push({
      factKey: "marketStatus",
      subjectRef: ref,
      subjectLabel: market.marketDisplayName,
      sourceId: RESEARCH_MARKET_SOURCE,
      value: market.status ?? null,
      unit: null,
      evidenceRefs: [`evidence:${RESEARCH_MARKET_SOURCE}:${market.marketDisplayName}:status`],
      entitlement: "PROVIDER_PUBLIC",
    });
  }

  list.push(...rhjFacts(rhjEvents(input.reads, input.asOf), input.asOf).observations);
  return list;
}

/**
 * Baselines, and where each one is recorded.
 *
 * `averageEntryPrice` is the venue's own record of what this position was
 * opened at; `entry_price` is the paper book's. A market's funding baseline is
 * the rate currently in force against the next one the venue declares. None of
 * these is a remembered reading, which is why none of them can be stale in a
 * way nobody notices.
 */
function baselines(reads: ResearchReads, asOf: string): readonly FactBaseline[] {
  const list: FactBaseline[] = [];
  if (Array.isArray(reads.positions)) {
    for (const position of reads.positions) {
      list.push({
        subjectRef: positionRef(position.marketDisplayName),
        factKey: "markPrice",
        value: position.averageEntryPrice ?? null,
        observedAt: null,
        source: "Arcus position entry price",
      });
    }
  }
  if (Array.isArray(reads.paper)) {
    for (const trade of reads.paper) {
      list.push({
        subjectRef: paperRef(trade.id),
        factKey: "markPrice",
        value: Number.isFinite(trade.entry_price) ? trade.entry_price.toFixed(2) : null,
        observedAt: trade.opened_at ?? null,
        source: "Paper book entry price",
      });
    }
  }
  if (Array.isArray(reads.markets)) {
    for (const market of reads.markets) {
      list.push({
        subjectRef: marketRef(market.marketDisplayName),
        factKey: "nextFundingRate",
        value: market.fundingRate ?? null,
        observedAt: null,
        source: "Arcus funding rate in force",
      });
    }
  }
  /* The issuer's own declared "before" — a current multiplier against the
     pending one it published in the same response. Still a recorded fact rather
     than a remembered reading, which is the rule this whole file follows. */
  list.push(...rhjFacts(rhjEvents(reads, asOf), asOf).baselines);
  return list;
}

function degradations(reads: ResearchReads): readonly SourceDegradation[] {
  const list: SourceDegradation[] = [];
  if (reads.positions === "FAILED") {
    list.push({ sourceId: RESEARCH_POSITION_SOURCE, reason: "The venue position read did not complete, so no holding was measured on this read." });
  }
  if (reads.markets === "FAILED") {
    list.push({ sourceId: RESEARCH_MARKET_SOURCE, reason: "The venue market read did not complete, so no market fact was measured on this read." });
  }
  if (reads.paper === "FAILED") {
    list.push({ sourceId: RESEARCH_PAPER_SOURCE, reason: "The paper book read did not complete, so no paper position was measured on this read." });
  }
  const refused = reads.rhj.outcomes.find((outcome) => !outcome.ok);
  if (refused !== undefined) {
    /* The provider's own sentence, carried through unchanged. A jurisdiction
       refusal worded as an outage would tell a reader to retry something that
       will refuse again for the same reason. */
    list.push({ sourceId: RHJ_SOURCE_ID, reason: outcomeSentence(refused) });
  }
  return list;
}

/**
 * The source states, without needing a mandate to exist first.
 *
 * The no-scope branch of this surface used to render nothing about sources at
 * all, which hid the one fact this function exists to report: from a restricted
 * jurisdiction the issuer API refuses every call, and a reader in that
 * jurisdiction has no scope *and* no explanation. A source that answered — or
 * refused — is a fact whether or not a rule was compiled from it.
 */
export function researchSourceStates(reads: ResearchReads): readonly ResearchSourceState[] {
  return sourceStates(reads);
}

function sourceStates(reads: ResearchReads): readonly ResearchSourceState[] {
  const list: ResearchSourceState[] = [{
    sourceId: RESEARCH_MARKET_SOURCE,
    label: "Arcus markets",
    state: reads.markets === "FAILED" ? "FAILED" : "OK",
    reason: reads.markets === "FAILED" ? "The venue market read did not complete." : null,
    entitlement: "PROVIDER_PUBLIC",
  }];
  if (reads.positions !== null) {
    list.push({
      sourceId: RESEARCH_POSITION_SOURCE,
      label: "Arcus positions",
      state: reads.positions === "FAILED" ? "FAILED" : "OK",
      reason: reads.positions === "FAILED" ? "The venue position read did not complete." : null,
      entitlement: "OWN_ACCOUNT",
    });
  }
  if (reads.paper !== null) {
    list.push({
      sourceId: RESEARCH_PAPER_SOURCE,
      label: "Paper book",
      state: reads.paper === "FAILED" ? "FAILED" : "OK",
      reason: reads.paper === "FAILED" ? "The paper book read did not complete." : null,
      entitlement: "OWN_ACCOUNT",
    });
  }
  list.push(rhjSourceState(reads));
  return list;
}

/**
 * What the issuer's API answered, in its own words.
 *
 * Probed 2026-08-23 from this repository's own environment, all three endpoints
 * returned a regional `403` while the provider's documentation host and the chain's RPC both returned `200` in the
 * same session. That is the venue deciding, and Ryntra's rule is to show a
 * venue's answer as it comes back rather than predicting, simulating or
 * working around it. Where this code runs decides which answer it gets;
 * neither is assumed here.
 */
function rhjSourceState(reads: ResearchReads): ResearchSourceState {
  const refused = reads.rhj.outcomes.find((outcome) => !outcome.ok);
  const stale = reads.rhj.quotes.some((quote) => quote.identity.freshnessState === "STALE");
  return {
    sourceId: RHJ_SOURCE_ID,
    label: RHJ_SOURCE_LABEL,
    state: refused !== undefined ? "FAILED" : stale ? "STALE" : "OK",
    reason:
      refused !== undefined
        ? outcomeSentence(refused)
        : stale
          ? "At least one quote is older than this mandate's freshness policy allows."
          : null,
    entitlement: "PROVIDER_PUBLIC",
  };
}

/**
 * No scheduler record exists for any rule in this product yet.
 *
 * Returned as an explicit empty list rather than left out, so the reason is a
 * value the surface can state rather than an absence it has to interpret.
 */
export function schedulerRecords(): readonly SchedulerRecord[] {
  return [];
}

export const RESEARCH_VIEW_NOTES = {
  WATCHLIST: "Ryntra has no server-readable watchlist for this account, so nothing can be watched here yet. The Robinhood Chain watchlist lives in the browser that made it.",
  MARKET: "No market is in this mandate's scope, because the scope is built from the markets your positions and paper trades touch.",
  FOR_ME: "No holding or paper position is in this mandate's scope on this read.",
} as const;

export function projectResearchSurface(input: Readonly<{
  reads: ResearchReads;
  ownerRef: string;
  asOf: string;
}>): ResearchProjection | null {
  const mandate = buildResearchMandate({
    reads: input.reads,
    ownerRef: input.ownerRef,
    effectiveFrom: input.asOf,
  });
  if (mandate === null) return null;

  const rules = compileMonitorRules(mandate);
  const changes = detectMaterialChanges({
    rules,
    observations: observations({ reads: input.reads, asOf: input.asOf }),
    baselines: baselines(input.reads, input.asOf),
    degradedSources: degradations(input.reads),
    asOf: input.asOf,
  });

  const records = schedulerRecords();
  const runs = rules.map((rule) => [
    rule.ruleId,
    projectRuleRun({
      rule,
      record: records.find((record) => record.ruleId === rule.ruleId) ?? null,
      asOf: input.asOf,
    }),
  ] as const);

  return projectResearch({
    mandate,
    rules,
    changes,
    runs,
    sources: sourceStates(input.reads),
    asOf: input.asOf,
    viewNotes: RESEARCH_VIEW_NOTES,
  });
}
