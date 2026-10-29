/**
 * The prediction-market domain as Ryntra states it — provider-neutral view
 * models and the mappers from the aggregator's own shapes.
 *
 * Every figure keeps its provenance: a probability is the venue's own price
 * of the outcome (0–1) at the moment it was read, a volume is what the
 * aggregator counts across the matched cluster, a signal is the provider's
 * generated observation with its model named. Nothing here invents a number
 * the source did not give — a field the source leaves out is `null`, and the
 * surface says so.
 *
 * Shared by the server routes, the pages and the tools; nothing here reads
 * the network or a store.
 */

import type {
  BatchOrderbooksResponse,
  ChartBarsResponse,
  CorrelatedMarketCascadeItem,
  CorrelatedMarketQueryResult,
  CorrelatedMarketSignal,
  ExecutionOrderItem,
  ExecutionPositionGroup,
  ExecutionStatusResponse,
  SmartRouteResponse,
  UnifiedBalanceResponse,
  VenueEventWithMarkets,
  VenueMarket,
} from "@agg-build/sdk";

import type { PredictionRouteCosts, PredictionSoloQuote } from "./costs.ts";

/* ------------------------------------------------------------- categories */

export type PredictionCategory = Readonly<{
  id: string;
  /** The provider's slug (`crypto`, `politics`…), the key the customer URL carries. */
  slug: string;
  name: string;
  eventCount: number;
  volume24h: number;
}>;

/* ------------------------------------------------------------- outcomes */

export type PredictionOutcome = Readonly<{
  id: string;
  label: string;
  /** The venue's price of the outcome, 0–1, as last read; null when the source gives none. */
  probability: number | null;
  venueMarketId: string;
  winner: boolean | null;
  /** The same outcome on the other venues of the matched cluster. */
  matched: readonly Readonly<{ venueMarketId: string; outcomeId: string }>[];
}>;

/* ------------------------------------------------------------- markets */

export type PredictionMarketStatus = "open" | "closed" | "resolved" | "unknown";

export type PredictionVenueMarket = Readonly<{
  id: string;
  venue: string;
  question: string;
  status: PredictionMarketStatus;
  outcomes: readonly Readonly<{ id: string; label: string; probability: number | null; winner: boolean | null }>[];
  volume: number | null;
  /** The venue's own description of what resolves the market, verbatim. */
  description: string | null;
  rules: Readonly<{ primary: string | null; secondary: string | null }>;
}>;

export type PredictionMarket = Readonly<{
  id: string;
  venue: string;
  question: string;
  status: PredictionMarketStatus;
  outcomes: readonly PredictionOutcome[];
  volume: number | null;
  endDate: string | null;
  resolutionDate: string | null;
  /** The venue's own description of what resolves the market, verbatim; null when the source gives none. */
  description: string | null;
  /** The venue's own resolution rules, verbatim; null when the source gives none. */
  rules: Readonly<{ primary: string | null; secondary: string | null }>;
  tickSize: number | null;
  minOrderSize: number | null;
  aggKey: string | null;
  /** The provider's arbitrage return across venues where it computes one; null otherwise. */
  arbReturn: number | null;
  /** The same market on the other venues of the matched cluster. */
  matched: readonly PredictionVenueMarket[];
  image: string | null;
}>;

/* ------------------------------------------------------------- events */

export type PredictionSettlement = Readonly<{
  sharedSummary: string;
  differences: readonly Readonly<{ type: string; title: string; summary: string | null; perVenue: Readonly<Record<string, string>> }>[];
}>;

export type PredictionEventSummary = Readonly<{
  id: string;
  title: string;
  subtitle: string | null;
  image: string | null;
  status: PredictionMarketStatus;
  /** The anchor venue and every venue the cluster trades on. */
  venue: string;
  venues: readonly string[];
  volume: number | null;
  endDate: string | null;
  categories: readonly Readonly<{ id: string; slug: string; name: string }>[];
  marketCount: number;
  aggKey: string | null;
  structureType: string | null;
  arbReturn: number | null;
  /** The first market's outcomes with their last price — the card's leading figures. */
  leading: readonly Readonly<{ id: string; label: string; probability: number | null; venueMarketId: string }>[];
  /** The first market's question when the event holds more than one market — what the leading figures are the odds of; null otherwise. */
  leadingQuestion?: string | null;
  /** The provider's series cadence as an ISO-8601 duration (`PT5M`, `P1D`…); null for a one-off event. */
  recurrence?: string | null;
  /** The provider's sport slug; null for an event that is not a game. */
  sport?: string | null;
  /** The game's scheduled start, for a sports event: its markets may keep trading during play. */
  gameStartTime?: string | null;
}>;

export type PredictionEvent = PredictionEventSummary &
  Readonly<{
    description: string | null;
    startDate: string | null;
    markets: readonly PredictionMarket[];
    settlement: PredictionSettlement | null;
  }>;

/* ------------------------------------------------------------- books */

export type PredictionBookLevel = Readonly<{ price: number; size: number; venues: Readonly<Record<string, number>> }>;

export type PredictionVenueBook = Readonly<{
  venue: string;
  venueMarketId: string;
  tickSize: number | null;
  bids: readonly PredictionBookLevel[];
  asks: readonly PredictionBookLevel[];
}>;

export type PredictionBook = Readonly<{
  venueMarketId: string;
  status: string;
  error: string | null;
  requested: Readonly<{ venue: string; marketStatus: string | null; tickSize: number | null }> | null;
  venues: readonly PredictionVenueBook[];
  matched: readonly Readonly<{ venue: string; venueMarketId: string; hasOrderbook: boolean }>[];
  /** The best bid/ask across venues, computed here from the books read. */
  aggregated: Readonly<{ bids: readonly PredictionBookLevel[]; asks: readonly PredictionBookLevel[] }>;
  readAt: string;
}>;

/* ------------------------------------------------------------- chart */

export type PredictionBar = Readonly<{ t: number; o: number; h: number; l: number; c: number; v: number | null }>;
export type PredictionChart = Readonly<{
  outcomeId: string;
  venue: string;
  resolution: "1m" | "5m" | "1h" | "1d";
  bars: readonly PredictionBar[];
  staleSeconds: number | null;
  lastBarAt: number | null;
}>;

/* ------------------------------------------------------------- research */

export type PredictionSignal = Readonly<{ id: string; text: string; side: string; direction: string; domain: string }>;
export type PredictionSignals = Readonly<{
  signals: readonly PredictionSignal[];
  /** The provider names the model and the prompt version: advisory content, never evidence. */
  sourceModel: string;
  promptVersion: string | number;
  createdAt: string;
}>;

export type PredictionRelatedMarket = Readonly<{
  score: number;
  venue: string;
  venueMarketId: string;
  venueEventId: string | null;
  marketQuestion: string;
  eventTitle: string;
  matchSource: string;
  matchedSignal: string | null;
}>;

export type PredictionRipple = Readonly<{
  mode: "expand" | "hedge";
  items: readonly Readonly<{
    eventId: string;
    title: string;
    status: string;
    score: number;
    action: string;
    reason: string;
    domain: string;
    endDate: string | null;
  }>[];
}>;

export type PredictionNewsArticle = Readonly<{ title: string; source: string; publishedAt: string | null; url: string | null; summary: string }>;
export type PredictionNews = Readonly<{ window: string | null; query: string | null; articles: readonly PredictionNewsArticle[] }>;

export type PredictionEngineState = Readonly<{
  tradingMode: string;
  paperStartingBalance: number | null;
  disabledVenues: readonly string[];
  signals: Readonly<{ marketsProcessed: number; marketsTotal: number; coveragePct: number; total: number }> | null;
}>;

/* ------------------------------------------------------------- route / quote */

export type PredictionRouteFill = Readonly<{
  venue: string;
  chain: string;
  avgPrice: number;
  shares: number;
  fees: Readonly<{ venue: number | null; builder: number | null; settlement: number | null }>;
}>;

export type PredictionRoute = Readonly<{
  quoteId: string;
  status: string;
  side: "buy" | "sell";
  outcomeId: string;
  venueMarketId: string;
  /** What the person asked to spend (buy) or to sell (shares). */
  requested: number;
  shares: number;
  /** Cost of the fills before fees, USD. */
  costUsd: number;
  /** Cost including every fee the route names, USD; null when the route does not state it. */
  totalCostIncFeesUsd: number | null;
  /** Average price paid per share = the probability the route buys at. */
  avgProbability: number | null;
  estimatedPayoutUsd: number | null;
  estimatedProfitUsd: number | null;
  returnPct: number | null;
  fees: Readonly<{ venue: number; builder: number; settlement: number; app: number | null }>;
  fills: readonly PredictionRouteFill[];
  venueSolo: readonly Readonly<{ venue: string; fields: Readonly<Record<string, string | number | boolean | null>> }>[];
  /** The route's own cost breakdown; null when the provider stated none. Absent on a Review stored before it was kept. */
  costs?: PredictionRouteCosts | null;
  /** Each venue's own quote for the same order, its cost read as the venue alone would charge it. */
  solos?: readonly PredictionSoloQuote[];
  warnings: readonly Readonly<{ venue: string; reason: string }>[];
  matchedMarkets: readonly Readonly<{ venue: string; venueMarketId: string }>[];
  expiresAt: string;
  refreshAt: string;
  solveMs: number;
  verifyMs: number;
  error: string | null;
  quotedAt: string;
}>;

/* ------------------------------------------------------------- paper account */

export type PaperBalance = Readonly<{
  startingBalance: number;
  cashBalance: number;
  positionsValue: number;
  realizedPnl: number;
  unrealizedPnl: number;
  earnings: number;
}>;

export type PaperPositionOutcome = Readonly<{
  label: string;
  totalSize: number;
  avgEntryPrice: number;
  currentPrice: number;
  totalValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  winner: boolean | null;
  venues: readonly Readonly<{ venue: string; size: number; venueMarketId: string; outcomeId: string }>[];
}>;

export type PaperPosition = Readonly<{
  eventId: string | null;
  venueEventId: string;
  question: string;
  image: string | null;
  marketStatus: string;
  status: "active" | "closed";
  redeemStatus: string;
  resolutionDate: string | null;
  outcomes: readonly PaperPositionOutcome[];
}>;

export type PaperOrder = Readonly<{
  id: string;
  quoteId: string | null;
  status: string;
  venue: string;
  side: string;
  createdAt: string;
  updatedAt: string;
  amountUsd: number | null;
  filledUsd: number | null;
  quotedPrice: number | null;
  executionPrice: number | null;
  quotedShares: number | null;
  actualShares: number | null;
  quotedToWin: number | null;
  actualToWin: number | null;
  partialFillReason: string | null;
  error: string | null;
  question: string | null;
  venueEventId: string | null;
  outcomeLabel: string | null;
}>;

/**
 * One of the provider's limit orders, as it stands on the venue. The figures
 * it leaves out are `null`, never zero: `filledShares` of null means the
 * provider did not state it, which is not the same as nothing filled.
 */
export type PredictionLimitOrder = Readonly<{
  id: string;
  /** Ryntra's own id for the order, given to the venue when it was placed. */
  clientOrderId: string | null;
  status: string;
  venue: string;
  side: string;
  limitPrice: number | null;
  limitShares: number | null;
  filledShares: number | null;
  remainingShares: number | null;
  filledUsd: number | null;
  avgFillPrice: number | null;
  /** What the provider holds against the order while it stands. */
  reservedUsd: number | null;
  timeInForce: string | null;
  expiresAt: string | null;
  cancelRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
  error: string | null;
}>;

/** What the provider answered when a limit order was placed. */
export type PredictionLimitPlaced = Readonly<{
  orderId: string;
  status: string;
  venue: string;
  venueOrderId: string | null;
  limitPrice: number | null;
  limitShares: number | null;
  filledShares: number | null;
  remainingShares: number | null;
  reservedUsd: number | null;
}>;

export type PaperExecution = Readonly<{
  quoteId: string;
  executionId: string | null;
  orderIds: readonly string[];
  state: string;
  terminal: boolean;
  error: string | null;
  pollAfterMs: number | null;
  steps: readonly Readonly<{ label: string; kind: string; status: string; error: string | null }>[];
  orders: readonly Readonly<{
    orderId: string;
    venue: string;
    status: string;
    event: string | null;
    filledUsd: number | null;
    actualShares: number | null;
    executionPrice: number | null;
    error: string | null;
  }>[];
}>;

/* ------------------------------------------------------------- helpers */

const MICRO = 1_000_000;

/** The aggregator's `*Raw` money fields are decimal strings in 6-decimal units. */
export function rawToUsd(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n / MICRO : null;
}

export function rawPrice(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Yes before No on a binary market, everything else in the venue's order — the reading order a person expects. */
export function yesFirst<T extends Readonly<{ label: string }>>(outcomes: readonly T[]): readonly T[] {
  const rank = (label: string) => (/^yes$/i.test(label) ? 0 : /^no$/i.test(label) ? 2 : 1);
  return [...outcomes].sort((a, b) => rank(a.label) - rank(b.label));
}

/**
 * Whether a person can still trade an event: it is open (or the venue does not
 * say) and its close is ahead. Past its close it is awaiting a result, never
 * an offer — whatever its last price would pay.
 */
export function eventTradable(event: Readonly<{ status: PredictionMarketStatus; endDate?: string | null | undefined }>, nowMs: number = Date.now()): boolean {
  if (event.status === "closed" || event.status === "resolved") return false;
  if (!event.endDate) return true;
  const end = Date.parse(event.endDate);
  return !Number.isFinite(end) || end > nowMs;
}

const HOUR = 3_600_000;

/** How long a game of a sport runs at most, stoppages and overtime in: past it the game is over, whatever the venue still lists. */
const GAME_LENGTH_MS: Readonly<Record<string, number>> = {
  soccer: 3 * HOUR,
  basketball: 3.5 * HOUR,
  hockey: 3.5 * HOUR,
  football: 4.5 * HOUR,
  baseball: 5 * HOUR,
  tennis: 6 * HOUR,
  cricket: 9 * HOUR,
};

/** A game of a sport not in the table is taken as over this long after its start. */
export const IN_PLAY_MS = 4 * HOUR;

/** How long after its start a game of this sport can still be under way. */
export function gameLengthMs(sport: string | null | undefined): number {
  const key = (sport ?? "").toLowerCase();
  return GAME_LENGTH_MS[key] ?? (key.includes("football") ? GAME_LENGTH_MS.football : IN_PLAY_MS);
}

/**
 * A game under way: a sports event whose start has passed no longer ago than
 * its sport's longest game, that the venue has not closed, and whose own end
 * (when it has one) is still ahead. Venues often date a game's markets by the
 * start and keep them trading through play — live, not past their date. A
 * game over by either clock is never live, whatever the venue still lists.
 */
export function eventInPlay(event: Readonly<{ status: PredictionMarketStatus; endDate?: string | null; sport?: string | null; gameStartTime?: string | null }>, nowMs: number = Date.now()): boolean {
  if (!event.sport || !event.gameStartTime) return false;
  if (event.status === "closed" || event.status === "resolved") return false;
  const start = Date.parse(event.gameStartTime);
  if (!Number.isFinite(start) || start > nowMs || nowMs - start >= gameLengthMs(event.sport)) return false;
  const end = event.endDate ? Date.parse(event.endDate) : NaN;
  return !Number.isFinite(end) || end > nowMs;
}

/** Whether a market still takes orders: the venue lists it open and has named no winner. */
export function marketTradable(market: Readonly<{ status: PredictionMarketStatus; outcomes: readonly Readonly<{ winner: boolean | null }>[] }>): boolean {
  return market.status === "open" && !market.outcomes.some((o) => o.winner === true);
}

/** An event whose end passed more than two days ago is not a market to decide on, whatever status the provider still keeps. */
export function eventStale(event: Readonly<{ endDate?: string | null | undefined }>, nowMs: number = Date.now()): boolean {
  if (!event.endDate) return false;
  const end = Date.parse(event.endDate);
  return Number.isFinite(end) && end < nowMs - 48 * 3_600_000;
}

/** A venue's status in the product's four words; anything not plainly open, closed or resolved is unknown. */
export function statusOf(value: string | null | undefined): PredictionMarketStatus {
  if (!value) return "unknown";
  const s = value.toLowerCase();
  if (s === "open" || s === "active") return "open";
  if (s === "resolved" || s === "settled" || s === "finalized") return "resolved";
  if (s === "closed" || s === "paused" || s === "halted" || s === "suspended") return "closed";
  return "unknown";
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A probability from the source, kept to four decimals so 1 − 0.32 reads 0.68 and never 0.6799999. */
export function prob(value: unknown): number | null {
  const n = num(value);
  return n == null ? null : Math.round(Math.max(0, Math.min(1, n)) * 1e4) / 1e4;
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" && value.length > 0 ? value : null;
}

/* ------------------------------------------------------------- mappers */

export function mapVenueMarket(market: VenueMarket): PredictionMarket {
  const raw = market as VenueMarket & { arbReturn?: number | null; matchedVenueMarkets?: VenueMarket["matchedVenueMarkets"] };
  return {
    id: market.id,
    venue: market.venue,
    question: market.question,
    status: statusOf(market.status),
    outcomes: yesFirst(market.venueMarketOutcomes).map((o) => ({
      id: o.id,
      label: o.label,
      probability: prob(o.price),
      venueMarketId: o.venueMarketId ?? market.id,
      winner: o.winner ?? null,
      matched: (o.matchedVenueMarketOutcomes ?? []).map((m) => ({ venueMarketId: m.venueMarketId, outcomeId: m.venueMarketOutcomeId })),
    })),
    volume: num(market.volume),
    endDate: market.endDate ?? null,
    resolutionDate: market.resolutionDate ?? null,
    description: market.description ?? null,
    rules: { primary: market.rulesPrimary ?? null, secondary: market.rulesSecondary ?? null },
    tickSize: num(market.tickSize),
    minOrderSize: num(market.minOrderSize),
    aggKey: (raw as { aggKey?: string | null }).aggKey ?? null,
    arbReturn: num(raw.arbReturn),
    matched: (raw.matchedVenueMarkets ?? []).map((m) => ({
      id: m.id,
      venue: m.venue,
      question: m.question,
      status: statusOf(m.status),
      outcomes: (m.venueMarketOutcomes ?? []).map((o) => ({ id: o.id, label: o.label, probability: prob(o.price), winner: o.winner ?? null })),
      volume: num(m.volume),
      description: m.description ?? null,
      rules: { primary: m.rulesPrimary ?? null, secondary: m.rulesSecondary ?? null },
    })),
    image: market.image ?? null,
  };
}

type Settleable = Readonly<{
  status?: string | null;
  endDate?: string | null;
  venueMarketOutcomes?: readonly Readonly<{ winner?: boolean | null }>[] | null;
  outcomes?: readonly Readonly<{ winner?: boolean | null }>[] | null;
}>;

/**
 * A market that has stopped: the venue says closed or resolved, names a
 * winner while still listing it open, or the market's own close has passed —
 * the same close the market page reads, so a card and its page agree.
 */
export function marketSettled(market: Settleable, nowMs: number = Date.now(), inPlay = false): boolean {
  const status = statusOf(market.status);
  if (status === "closed" || status === "resolved") return true;
  if ([...(market.venueMarketOutcomes ?? []), ...(market.outcomes ?? [])].some((o) => o.winner === true)) return true;
  /* During a game the venue's date is the kick-off, not the end of trading. */
  if (inPlay) return false;
  const close = market.endDate ? Date.parse(market.endDate) : NaN;
  return Number.isFinite(close) && close <= nowMs;
}

/**
 * The market a card leads with: the first one still trading, else the first.
 * A settled market's last price is what is left over, not an estimate — it
 * must not stand for the event while another market still trades.
 */
export function leadMarket<T extends Settleable>(markets: readonly T[] | null | undefined, nowMs: number = Date.now(), inPlay = false): T | undefined {
  return markets?.find((m) => !marketSettled(m, nowMs, inPlay)) ?? markets?.[0];
}

type RawGame = Readonly<{ status?: string | null; endDate?: string | null; sport?: string | null; gameStartTime?: string | null }>;

/** Whether a provider's event, as read, is a game under way. */
export function rawInPlay(event: RawGame, nowMs: number = Date.now()): boolean {
  return eventInPlay({ status: statusOf(event.status), endDate: event.endDate ?? null, sport: event.sport ?? null, gameStartTime: event.gameStartTime ?? null }, nowMs);
}

/**
 * The event's status as a person should read it: the venue's own word, except
 * that an event every market of which has stopped trading is no longer open,
 * whatever the venue still says of the event. Only when every market is in
 * hand — a partial list says nothing of the markets left out.
 */
export function eventStatus(event: RawGame & Readonly<{ marketCount?: number | null; venueMarkets?: readonly Settleable[] | null }>, nowMs: number = Date.now()): PredictionMarketStatus {
  const own = statusOf(event.status);
  const markets = event.venueMarkets ?? [];
  if (own === "closed" || own === "resolved" || markets.length === 0 || (event.marketCount ?? markets.length) > markets.length) return own;
  const inPlay = rawInPlay(event, nowMs);
  if (!markets.every((m) => marketSettled(m, nowMs, inPlay))) return own;
  return markets.every((m) => statusOf(m.status) === "resolved" || [...(m.venueMarketOutcomes ?? []), ...(m.outcomes ?? [])].some((o) => o.winner === true)) ? "resolved" : "closed";
}

export function mapEventSummary(event: VenueEventWithMarkets, midpoints: ReadonlyMap<string, number> = new Map(), nowMs: number = Date.now()): PredictionEventSummary {
  const raw = event as VenueEventWithMarkets & { arbReturn?: number | null };
  const inPlay = rawInPlay(event, nowMs);
  const first = leadMarket(event.venueMarkets, nowMs, inPlay);
  return {
    id: event.id,
    title: event.title,
    subtitle: event.subtitle ?? null,
    image: event.image ?? null,
    status: eventStatus(event, nowMs),
    venue: event.venue,
    venues: event.venues && event.venues.length > 0 ? event.venues : [event.venue],
    volume: num(event.volume),
    endDate: event.endDate ?? null,
    categories: (event.categories ?? []).map((c) => ({ id: c.category.id, slug: c.category.name, name: c.category.displayName ?? c.category.name })),
    marketCount: event.venueMarkets?.length ?? event.marketCount ?? 0,
    leadingQuestion: first && (event.venueMarkets?.length ?? 0) > 1 ? first.question : null,
    recurrence: typeof event.recurrence === "string" && event.recurrence ? event.recurrence : null,
    sport: typeof event.sport === "string" && event.sport ? event.sport : null,
    gameStartTime: typeof event.gameStartTime === "string" && event.gameStartTime ? event.gameStartTime : null,
    aggKey: event.aggKey ?? null,
    structureType: event.structureType ?? null,
    arbReturn: num(raw.arbReturn),
    /* A lead that has itself stopped (every market in hand settled, the list partial) carries no price: its leftover is no offer. */
    leading: first
      ? yesFirst(first.venueMarketOutcomes).map((o) => ({
          id: o.id,
          label: o.label,
          probability: marketSettled(first, nowMs, inPlay) ? null : (midpointFor(midpoints, first.id, o) ?? prob(o.price)),
          venueMarketId: first.id,
        }))
      : [],
  };
}

/** A midpoint is the Yes price of a binary market; the No side is its complement. */
function midpointFor(midpoints: ReadonlyMap<string, number>, marketId: string, outcome: { label: string }): number | null {
  const mid = midpoints.get(marketId);
  if (mid == null) return null;
  if (/^yes$/i.test(outcome.label)) return prob(mid);
  if (/^no$/i.test(outcome.label)) return prob(1 - mid);
  return null;
}

export function mapEvent(event: VenueEventWithMarkets, markets: readonly VenueMarket[], midpoints: ReadonlyMap<string, number> = new Map(), nowMs: number = Date.now()): PredictionEvent {
  const summary = mapEventSummary(event, midpoints, nowMs);
  const mapped = markets.map(mapVenueMarket).map((market) => ({
    ...market,
    outcomes: market.outcomes.map((o) => ({ ...o, probability: midpointFor(midpoints, market.id, o) ?? o.probability })),
  }));
  const settlement = event.settlementDiff
    ? {
        sharedSummary: event.settlementDiff.sharedSummary,
        differences: event.settlementDiff.differences.map((d) => ({ type: d.type, title: d.title, summary: d.summary ?? null, perVenue: d.perVenue })),
      }
    : null;
  const lead = leadMarket(mapped, nowMs, eventInPlay(summary, nowMs));
  return {
    ...summary,
    marketCount: mapped.length || summary.marketCount,
    leading: lead ? lead.outcomes.map((o) => ({ id: o.id, label: o.label, probability: o.probability, venueMarketId: lead.id })) : summary.leading,
    leadingQuestion: lead && mapped.length > 1 ? lead.question : (summary.leadingQuestion ?? null),
    description: event.description ?? null,
    startDate: event.startDate ?? null,
    markets: mapped,
    settlement,
  };
}

export function mapBook(item: BatchOrderbooksResponse["data"][number], readAt: string): PredictionBook {
  const venues = Object.entries(item.venueOrderbooks ?? {}).map(([venue, entry]) => ({
    venue,
    venueMarketId: entry.venueMarketId,
    tickSize: num(entry.tickSize),
    bids: entry.orderbook.bids.map((l) => ({ price: l.price, size: l.size, venues: { [venue]: l.size } })),
    asks: entry.orderbook.asks.map((l) => ({ price: l.price, size: l.size, venues: { [venue]: l.size } })),
  }));
  return {
    venueMarketId: item.venueMarketId,
    status: String(item.status),
    error: item.error ? JSON.stringify(item.error) : null,
    requested: item.requestedMarket
      ? { venue: item.requestedMarket.venue, marketStatus: (item.requestedMarket as { marketStatus?: string | null }).marketStatus ?? null, tickSize: num(item.requestedMarket.tickSize) }
      : null,
    venues,
    matched: (item.matchedMarkets ?? []).map((m) => ({ venue: m.venue, venueMarketId: (m as { venueMarketId?: string }).venueMarketId ?? "", hasOrderbook: Boolean((m as { hasOrderbook?: boolean }).hasOrderbook) })),
    aggregated: aggregateBooks(venues),
    readAt,
  };
}

/** Best levels across venues: bids descending, asks ascending, sizes merged per price with the venue breakdown kept. */
export function aggregateBooks(venues: readonly PredictionVenueBook[]): Readonly<{ bids: readonly PredictionBookLevel[]; asks: readonly PredictionBookLevel[] }> {
  const merge = (side: "bids" | "asks") => {
    const byPrice = new Map<number, { size: number; venues: Record<string, number> }>();
    for (const book of venues) {
      for (const level of book[side]) {
        const key = Math.round(level.price * 1e6) / 1e6;
        const current = byPrice.get(key) ?? { size: 0, venues: {} };
        current.size += level.size;
        current.venues[book.venue] = (current.venues[book.venue] ?? 0) + level.size;
        byPrice.set(key, current);
      }
    }
    const levels = [...byPrice].map(([price, v]) => ({ price, size: v.size, venues: v.venues }));
    levels.sort((a, b) => (side === "bids" ? b.price - a.price : a.price - b.price));
    return levels;
  };
  return { bids: merge("bids"), asks: merge("asks") };
}

export function mapChart(response: ChartBarsResponse): PredictionChart {
  return {
    outcomeId: response.venueMarketOutcomeId,
    venue: response.venue,
    resolution: response.resolution,
    bars: response.data.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })),
    staleSeconds: response.meta?.staleSeconds ?? null,
    lastBarAt: response.meta?.lastBarOpenTime ?? null,
  };
}

export function mapSignals(batch: Readonly<{ signals: readonly CorrelatedMarketSignal[]; sourceModel: string; promptVersion: string | number; createdAt: string }>): PredictionSignals {
  return {
    signals: batch.signals.map((s) => ({ id: s.id, text: s.text, side: String(s.side), direction: String(s.direction), domain: s.domain })),
    sourceModel: batch.sourceModel,
    promptVersion: batch.promptVersion,
    createdAt: batch.createdAt,
  };
}

export function mapRelated(results: readonly CorrelatedMarketQueryResult[]): readonly PredictionRelatedMarket[] {
  return results.map((r) => ({
    score: r.score,
    venue: r.venue,
    venueMarketId: r.venueMarketId,
    venueEventId: (r as { venueEventId?: string | null }).venueEventId ?? null,
    marketQuestion: r.marketQuestion,
    eventTitle: r.eventTitle,
    matchSource: String(r.matchSource),
    matchedSignal: r.matchedSignal?.text ?? null,
  }));
}

export function mapRipple(mode: "expand" | "hedge", items: readonly CorrelatedMarketCascadeItem[]): PredictionRipple {
  return {
    mode,
    items: items.map((r) => ({
      eventId: r.venueEventId,
      title: r.eventTitle,
      status: String(r.eventStatus),
      score: r.score,
      action: r.action,
      reason: r.reason,
      domain: r.reasonDomain,
      endDate: r.eventEndDate ?? null,
    })),
  };
}

export function mapNews(raw: unknown): PredictionNews {
  const body = (raw ?? {}) as { results?: { question?: string; timeRangeLabel?: string; searchQuery?: string; articles?: Record<string, unknown>[] }[] };
  const groups = body.results ?? [];
  const pick = (row: Record<string, unknown>, keys: string[]): string | null => {
    for (const key of keys) if (typeof row[key] === "string" && (row[key] as string).length > 0) return row[key] as string;
    return null;
  };
  const articles = groups.flatMap((g) => g.articles ?? []).map((row) => ({
    title: pick(row, ["title", "headline"]) ?? "",
    source: pick(row, ["source", "publisher", "domain"]) ?? "",
    publishedAt: pick(row, ["publishedAt", "date", "published"]),
    url: pick(row, ["url", "link"]),
    summary: pick(row, ["impactSummary", "summary", "marketImpact", "snippet"]) ?? "",
  }));
  return { window: groups[0]?.timeRangeLabel ?? null, query: groups[0]?.searchQuery ?? null, articles };
}

export function mapRoute(route: SmartRouteResponse, side: "buy" | "sell", requested: number, quotedAt: string): PredictionRoute {
  const fills = (route.fills ?? []).map((f) => ({
    venue: f.venue,
    chain: f.chain,
    avgPrice: f.avgPrice,
    shares: f.venueQty,
    fees: { venue: num(f.venueFee), builder: num(f.builderFee), settlement: num(f.settlementFee) },
  }));
  const sum = (key: "venue" | "builder" | "settlement") => fills.reduce((acc, f) => acc + (f.fees[key] ?? 0), 0);
  const shares = num(route.totalFilled) ?? 0;
  const cost = num(route.rawExecCost) ?? 0;
  return {
    quoteId: route.quoteId,
    status: String(route.status),
    side,
    outcomeId: route.venueMarketOutcomeId,
    venueMarketId: route.venueMarketId,
    requested,
    shares,
    costUsd: cost,
    totalCostIncFeesUsd: num(route.totalCostIncFees),
    avgProbability: shares > 0 ? cost / shares : null,
    estimatedPayoutUsd: num(route.estimatedPayout),
    estimatedProfitUsd: num(route.estimatedProfit),
    returnPct: num(route.returnPct),
    fees: { venue: sum("venue"), builder: sum("builder"), settlement: sum("settlement"), app: route.appFee ? rawToUsd(route.appFee.quotedAppFeeRaw) : null },
    fills,
    venueSolo: ((route.venueSoloQuotes ?? []) as unknown as Record<string, unknown>[]).map((q) => ({
      venue: String(q.venue ?? "—"),
      fields: Object.fromEntries(
        Object.entries(q)
          .filter(([k, v]) => k !== "venue" && (v === null || ["string", "number", "boolean"].includes(typeof v)))
          .map(([k, v]) => [k, v as string | number | boolean | null]),
      ),
    })),
    costs: mapCosts(route.feeBreakdown),
    solos: (route.venueSoloQuotes ?? []).map((q) => ({
      venue: q.venue,
      status: String(q.status),
      shares: num(q.filledQty) ?? 0,
      avgPrice: num(q.avgPrice),
      directCostUsd: q.feeBreakdown ? num(q.feeBreakdown.totalCost) : num(q.rawExecCost),
      unavailableReason: q.unavailableReason ?? q.quoteFailure?.code ?? null,
      levels: (q.fills ?? []).flatMap((f) => (f.fills ?? []).map((l) => ({ price: num(l.price) ?? 0, qty: num(l.fill) ?? 0 }))).slice(0, 1024),
    })),
    warnings: (route.warnings ?? []).map((w) => ({ venue: w.venue, reason: w.reason })),
    matchedMarkets: (route.matchedMarkets ?? []).map((m) => ({ venue: m.venue, venueMarketId: m.venueMarketId })),
    expiresAt: route.expiresAt,
    refreshAt: route.refreshAt,
    solveMs: route.solveTimeMs,
    verifyMs: route.verifyTimeMs,
    error: route.error ?? route.message ?? null,
    quotedAt,
  };
}

/** The route's fee breakdown in Ryntra's names; null when the provider planned no feasible route. A fee it leaves out is zero only where its own total leaves it out too. */
export function mapCosts(breakdown: SmartRouteResponse["feeBreakdown"]): PredictionRouteCosts | null {
  if (!breakdown) return null;
  const setup = num(breakdown.setupCostsTotal);
  return {
    contractsUsd: num(breakdown.rawExecCost) ?? 0,
    venueFeesUsd: num(breakdown.venueFees) ?? 0,
    builderFeeUsd: num(breakdown.builderFee) ?? 0,
    bridgeUsd: num(breakdown.bridgeFees) ?? 0,
    gasUsd: num(breakdown.executionGas) ?? 0,
    appFeeUsd: num(breakdown.appFee),
    appFeeBips: num(breakdown.appFeeBips),
    referralUsd: num(breakdown.referralFee),
    setupUsd: setup,
    totalUsd: num(breakdown.totalCost) ?? 0,
  };
}

export function mapPaperBalance(balances: UnifiedBalanceResponse): PaperBalance | null {
  const paper = balances.paper;
  if (!paper) return null;
  return {
    startingBalance: paper.startingBalance,
    cashBalance: paper.cashBalance,
    positionsValue: paper.positionsValue,
    realizedPnl: paper.realizedPnl,
    unrealizedPnl: paper.unrealizedPnl,
    earnings: paper.earnings,
  };
}

export function mapPaperPosition(group: ExecutionPositionGroup): PaperPosition {
  return {
    eventId: group.eventId ?? null,
    venueEventId: group.venueMarket.venueEventId,
    question: group.venueMarket.question,
    image: group.venueMarket.image,
    marketStatus: String(group.venueMarket.status),
    status: group.status,
    redeemStatus: group.redeemStatus,
    resolutionDate: group.resolutionDate,
    outcomes: group.venueMarket.venueMarketOutcomes.map((o) => ({
      label: o.label,
      totalSize: o.totalSize,
      avgEntryPrice: o.avgEntryPrice,
      currentPrice: o.currentPrice,
      totalValue: o.totalValue,
      unrealizedPnl: o.unrealizedPnl,
      unrealizedPnlPercent: o.unrealizedPnlPercent,
      winner: o.winner,
      venues: o.venueBreakdown.map((v) => ({ venue: v.venue, size: v.size, venueMarketId: v.venueMarketId, outcomeId: v.venueMarketOutcomeId })),
    })),
  };
}

export function mapPaperOrder(order: ExecutionOrderItem): PaperOrder {
  return {
    id: order.id,
    quoteId: order.quoteId,
    status: order.status,
    venue: order.venue,
    side: order.side,
    createdAt: iso(order.createdAt) ?? "",
    updatedAt: iso(order.updatedAt) ?? "",
    amountUsd: rawToUsd(order.amountRaw),
    filledUsd: rawToUsd(order.filledAmountRaw),
    quotedPrice: rawPrice(order.quotedPriceRaw),
    executionPrice: rawPrice(order.executionPrice),
    quotedShares: rawToUsd(order.quotedSharesRaw),
    actualShares: rawToUsd(order.actualSharesRaw),
    quotedToWin: rawToUsd(order.quotedToWinRaw),
    actualToWin: rawToUsd(order.actualToWinRaw),
    partialFillReason: order.partialFillReason,
    error: order.errorMessage,
    question: order.venueMarket?.question ?? null,
    venueEventId: order.venueMarket?.venueEventId ?? null,
    outcomeLabel: order.venueMarketOutcome?.label ?? null,
  };
}

/**
 * One limit order of the provider's list. Its `*Raw` fields are millionths —
 * of a dollar for money, of a share for size — and a field the provider
 * leaves out stays null.
 */
export function mapLimitOrder(order: ExecutionOrderItem): PredictionLimitOrder {
  const row = order as ExecutionOrderItem & { errorMessage?: string | null };
  return {
    id: order.id,
    clientOrderId: order.clientOrderId ?? null,
    status: order.status,
    venue: order.venue,
    side: order.side,
    limitPrice: rawToUsd(order.limitPriceRaw),
    limitShares: rawToUsd(order.limitSizeRaw),
    filledShares: rawToUsd(order.filledSizeRaw),
    remainingShares: rawToUsd(order.remainingSizeRaw),
    filledUsd: rawToUsd(order.filledCostRaw),
    avgFillPrice: rawToUsd(order.averageFillPriceRaw),
    reservedUsd: rawToUsd(order.reservedCostRaw),
    timeInForce: order.timeInForce ? String(order.timeInForce) : null,
    expiresAt: iso(order.expiresAt),
    cancelRequestedAt: iso(order.cancelRequestedAt),
    createdAt: iso(order.createdAt) ?? "",
    updatedAt: iso(order.updatedAt) ?? "",
    error: row.errorMessage ?? null,
  };
}

/** The provider's answer to a limit order placed. */
export function mapLimitPlaced(answer: Readonly<{ orderId: string; status: string; venue: string; venueOrderId?: string | null; limitPriceRaw?: string | null; limitSizeRaw?: string | null; filledSizeRaw?: string | null; remainingSizeRaw?: string | null; reservedCostRaw?: string | null }>): PredictionLimitPlaced {
  return {
    orderId: String(answer.orderId),
    status: String(answer.status),
    venue: String(answer.venue),
    venueOrderId: answer.venueOrderId ?? null,
    limitPrice: rawToUsd(answer.limitPriceRaw),
    limitShares: rawToUsd(answer.limitSizeRaw),
    filledShares: rawToUsd(answer.filledSizeRaw),
    remainingShares: rawToUsd(answer.remainingSizeRaw),
    reservedUsd: rawToUsd(answer.reservedCostRaw),
  };
}

export function mapExecution(status: ExecutionStatusResponse): PaperExecution {
  return {
    quoteId: status.quoteId,
    executionId: status.executionId,
    orderIds: status.orderIds,
    state: status.overallState,
    terminal: status.terminal,
    error: status.errorReason,
    pollAfterMs: status.pollAfterMs,
    steps: status.steps.map((s) => ({ label: s.label, kind: String(s.kind), status: s.status, error: s.errorReason })),
    orders: status.orders.map((o) => ({
      orderId: o.orderId,
      venue: o.venue,
      status: o.status,
      event: o.event,
      filledUsd: rawToUsd(o.filledAmountRaw),
      actualShares: rawToUsd(o.actualSharesRaw),
      executionPrice: rawPrice(o.executionPriceRaw),
      error: o.errorReason ?? null,
    })),
  };
}

/* ------------------------------------------------------------- live prices */

export type PredictionVenuePrice = Readonly<{
  venue: string;
  venueMarketId: string;
  midpoint: number | null;
  spread: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  timestamp: number | null;
}>;

/** The live prices of one market: its own midpoint, each outcome's, and every matched venue's. */
export type PredictionMarketPrices = Readonly<{
  venueMarketId: string;
  venue: string;
  midpoint: number | null;
  spread: number | null;
  timestamp: number | null;
  arbReturn: number | null;
  marketStatus: string | null;
  error: string | null;
  outcomes: readonly Readonly<{ outcomeId: string; label: string; midpoint: number | null; bestBid: number | null; bestAsk: number | null }>[];
  venues: readonly PredictionVenuePrice[];
}>;

export function mapMarketPrices(row: import("@agg-build/sdk").BatchMidpointsResponse["data"][number]): PredictionMarketPrices {
  const own: PredictionVenuePrice = {
    venue: row.venue,
    venueMarketId: row.venueMarketId,
    midpoint: prob(row.midpoint),
    spread: row.spread,
    bestBid: prob(row.bestBid),
    bestAsk: prob(row.bestAsk),
    timestamp: row.timestamp,
  };
  return {
    venueMarketId: row.venueMarketId,
    venue: row.venue,
    midpoint: prob(row.midpoint),
    spread: row.spread,
    timestamp: row.timestamp,
    arbReturn: row.arbReturn ?? null,
    marketStatus: row.marketStatus ? String(row.marketStatus) : null,
    error: row.error ? row.error.code : null,
    outcomes: (row.outcomes ?? []).map((o) => ({ outcomeId: o.venueMarketOutcomeId, label: o.label, midpoint: prob(o.midpoint), bestBid: prob(o.bestBid), bestAsk: prob(o.bestAsk) })),
    venues: [own, ...(row.matched ?? []).map((m) => ({ venue: m.venue, venueMarketId: m.venueMarketId, midpoint: prob(m.midpoint), spread: m.spread, bestBid: prob(m.bestBid), bestAsk: prob(m.bestAsk), timestamp: m.timestamp }))],
  };
}

/** The `Yes` midpoints by market id, for the card's leading figures. */
export function midpointMap(prices: readonly PredictionMarketPrices[]): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  for (const p of prices) if (p.midpoint != null) map.set(p.venueMarketId, p.midpoint);
  return map;
}
