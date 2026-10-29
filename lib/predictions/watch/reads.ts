/**
 * Turning the provider's streams into the figures the engine compares.
 *
 * The provider serves the same market four ways — the live book and the bar
 * series the market page keeps a socket open for, the news feed, the
 * correlated markets — and the watch needs them when no page is open at all.
 * So the pass reads them through the server's own adapter: the same figures
 * the socket carries, asked for on a schedule rather than pushed. What a
 * browser gets as a message, this gets as a read with the provider's own
 * stamp on it, and the engine refuses to judge a stamp that is too old.
 *
 * Two things this module will not do, by design:
 *
 * - **it reads only what the rules need.** The rules of one market say which
 *   parts to ask for; a market watched only for its news costs one read, not
 *   five. Every part answers for itself, and a part that failed is `null`
 *   rather than a figure made up to fill it.
 * - **it reads nothing of anybody's money.** The person's own position comes
 *   from the pass, which reads it once for the wallet; nothing here opens a
 *   session, quotes, places or collects.
 *
 * Server only — it takes a provider, so the tests give it the real adapter
 * over the provider's own answers.
 */

import { rulesFingerprint, settlementPhase } from "../resolution.ts";
import { observeRules, type RulesHistory } from "../rules-history.ts";
import type { GuardStore } from "../../guard/store.ts";
import type { PredictionBar, PredictionEvent, PredictionMarket, PaperPosition } from "../model.ts";
import type { PredictionProvider } from "../provider.ts";
import { LIQUIDITY_DEPTH_BAND, type WatchRuleInput, type WatchSubject } from "./rules.ts";
import type { WatchBookRead, WatchPositionRead, WatchPriceRead, WatchReads, WatchRelatedRead, WatchRulesRead } from "./engine.ts";

/** How many linked markets one `related_move` rule looks at: the model's best few, never a crawl. */
export const WATCH_LINKED_LIMIT = 3;
/** The news items one read asks for; the provider serves at most five. */
export const WATCH_NEWS_LIMIT = 5;
/** How deep a book is read: enough to tell a thin one from a full one. */
export const WATCH_BOOK_DEPTH = 20;

/** Which of the provider's reads the rules of one market need. */
export type WatchNeeds = Readonly<{
  prices: boolean;
  bars: boolean;
  book: boolean;
  news: boolean;
  rules: boolean;
  position: boolean;
  related: boolean;
  /** The bar size and how many: the longest window any rule of this market asks for decides both. */
  resolution: "5m" | "1h";
  countBack: number;
  /** The outcome whose own price and bars are read; null when no rule of this market is about one. */
  outcomeId: string | null;
  /** The longest window asked for, in minutes; null when no rule of this market has one. */
  windowMinutes: number | null;
}>;

const NONE: WatchNeeds = { prices: false, bars: false, book: false, news: false, rules: false, position: false, related: false, resolution: "1h", countBack: 48, outcomeId: null, windowMinutes: null };

/** What a market's rules, taken together, ask the provider for. */
export function needsOf(rules: readonly WatchRuleInput[]): WatchNeeds {
  let needs = NONE;
  for (const rule of rules) {
    const window = rule.windowMinutes;
    needs = {
      ...needs,
      prices: needs.prices || rule.kind === "price" || rule.kind === "venue_spread",
      bars: needs.bars || rule.kind === "probability_move" || rule.kind === "volume_spike",
      book: needs.book || rule.kind === "liquidity",
      news: needs.news || rule.kind === "news",
      rules: needs.rules || rule.kind === "resolution",
      position: needs.position || rule.kind === "position_value",
      related: needs.related || rule.kind === "related_move",
      outcomeId: needs.outcomeId ?? rule.subject.outcomeId,
      windowMinutes: window === null ? needs.windowMinutes : Math.max(needs.windowMinutes ?? 0, window),
    };
  }
  if (needs.windowMinutes !== null) {
    /* Bars shorter than an hour only for a window under two: a week of five-minute bars is a thousand of them nobody reads. */
    const resolution = needs.windowMinutes <= 120 ? "5m" : "1h";
    const minutesPerBar = resolution === "5m" ? 5 : 60;
    /* The window plus a quarter, so the bar at its start is in the series even when the provider's clock is a little behind. */
    const countBack = Math.min(400, Math.max(12, Math.ceil((needs.windowMinutes * 1.25) / minutesPerBar)));
    needs = { ...needs, resolution, countBack };
  }
  return needs;
}

const inBand = (price: number, mid: number) => Math.abs(price - mid) <= LIQUIDITY_DEPTH_BAND;

/** The book as the engine reads it: the best two prices, and the USD a person could trade into near them on the thinner side. */
export function bookRead(book: Readonly<{ aggregated: Readonly<{ bids: readonly Readonly<{ price: number; size: number }>[]; asks: readonly Readonly<{ price: number; size: number }>[] }>; readAt: string }>): WatchBookRead {
  const bestBid = book.aggregated.bids.length > 0 ? Math.max(...book.aggregated.bids.map((l) => l.price)) : null;
  const bestAsk = book.aggregated.asks.length > 0 ? Math.min(...book.aggregated.asks.map((l) => l.price)) : null;
  const stamped = Date.parse(book.readAt);
  if (bestBid === null || bestAsk === null) return { bestBid, bestAsk, depthUsd: null, stampedAt: Number.isFinite(stamped) ? stamped : null };
  const mid = (bestBid + bestAsk) / 2;
  /* A level's size is shares; what a person can trade into is shares times the price they would pay. */
  const usd = (levels: readonly Readonly<{ price: number; size: number }>[]) => levels.filter((l) => inBand(l.price, mid)).reduce((sum, l) => sum + l.size * l.price, 0);
  return { bestBid, bestAsk, depthUsd: Math.min(usd(book.aggregated.bids), usd(book.aggregated.asks)), stampedAt: Number.isFinite(stamped) ? stamped : null };
}

/** The market's prices as the engine reads them: the watched outcome's own, and each venue's midpoint for the market. */
export function priceRead(prices: Readonly<{ timestamp: number | null; outcomes: readonly Readonly<{ outcomeId: string; midpoint: number | null }>[]; venues: readonly Readonly<{ venue: string; midpoint: number | null }>[] }>, outcomeId: string | null): WatchPriceRead {
  const own = outcomeId === null ? null : (prices.outcomes.find((o) => o.outcomeId === outcomeId)?.midpoint ?? null);
  return {
    outcome: own,
    stampedAt: prices.timestamp,
    venues: prices.venues.filter((v): v is Readonly<{ venue: string; midpoint: number }> => typeof v.midpoint === "number" && Number.isFinite(v.midpoint)).map((v) => ({ venue: v.venue, midpoint: v.midpoint })),
  };
}

/**
 * The person's position in this market, from the positions the pass already
 * read. The provider names an event twice — its own id and the venue's — and
 * a position is matched on either, so a watch set from the market page finds
 * the holding whichever id that page carried.
 */
export function positionRead(positions: readonly PaperPosition[], subject: WatchSubject): WatchPositionRead {
  const rows = positions.filter((p) => p.venueEventId === subject.eventId || p.eventId === subject.eventId);
  const valueUsd = rows.flatMap((p) => p.outcomes).reduce((sum, o) => sum + (Number.isFinite(o.totalValue) ? o.totalValue : 0), 0);
  return { valueUsd, held: rows.some((p) => p.outcomes.some((o) => o.totalSize > 0)) };
}

/** The market the watch is about inside the event the provider answered, by id or — the provider having renamed it — by its question. */
export function marketOf(event: PredictionEvent, subject: WatchSubject): PredictionMarket | null {
  return event.markets.find((m) => m.id === subject.venueMarketId) ?? event.markets.find((m) => m.question === subject.question) ?? null;
}

/** The rules and the settlement of one market, with what the line's own history says moved since it was last read. */
export async function rulesRead(store: GuardStore, provider: PredictionProvider, subject: WatchSubject, nowMs: number): Promise<WatchRulesRead | null> {
  const event = await provider.event(subject.eventId).catch(() => null);
  if (!event || !event.ok) return null;
  const market = marketOf(event.value, subject);
  if (!market) return null;
  /* The same record the market page keeps, so the watch and the page never disagree about what changed. */
  const history = await observeRules(store, subject.eventId, event.value.markets, nowMs).catch((): RulesHistory => ({}));
  const change = (history[market.id] ?? [])[0] ?? null;
  const moved: string[] = [];
  if (change) {
    if (change.diff.added.length > 0 || change.diff.removed.length > 0) moved.push("text");
    if (change.diff.closes) moved.push("closes");
    if (change.diff.resolves) moved.push("resolves");
  }
  const phase = settlementPhase(market, event.value.endDate, nowMs);
  return {
    fingerprint: rulesFingerprint({ description: market.description, primary: market.rules.primary, secondary: market.rules.secondary, endDate: market.endDate, resolutionDate: market.resolutionDate }),
    moved,
    phase: phase.phase,
    lateByMs: phase.phase === "delayed" ? phase.lateByMs : null,
  };
}

/** Which side of a two-outcome market the watched outcome is, for the correlated reads; null when the market has more than two. */
function sideOf(subject: WatchSubject): "yes" | "no" | null {
  const label = subject.outcomeLabel?.trim().toLowerCase() ?? "";
  if (label === "yes" || label === "так") return "yes";
  if (label === "no" || label === "ні") return "no";
  return null;
}

/** The change one outcome's bars show over the window; null when the series is shorter than the window. */
async function changeOver(provider: PredictionProvider, outcomeId: string, resolution: "5m" | "1h", countBack: number, windowMs: number, nowMs: number): Promise<number | null> {
  const chart = await provider.chart(outcomeId, resolution, countBack).catch(() => null);
  if (!chart || !chart.ok || chart.value.bars.length < 2) return null;
  const ordered = [...chart.value.bars].sort((a, b) => a.t - b.t);
  const to = ordered[ordered.length - 1]!;
  let from: PredictionBar | null = null;
  for (const bar of ordered) {
    if (bar.t <= nowMs - windowMs) from = bar;
    else break;
  }
  return from && from.t !== to.t ? to.c - from.c : null;
}

/**
 * The linked markets of one market, with how far each moved over the window.
 * The link itself is the provider's model — a theme, not a proven cause —
 * which is why the words a signal gets say so.
 */
export async function relatedRead(provider: PredictionProvider, subject: WatchSubject, needs: WatchNeeds, nowMs: number): Promise<WatchRelatedRead | null> {
  const side = sideOf(subject) ?? "yes";
  const cascade = await provider.ripple(subject.venueMarketId, "expand", WATCH_LINKED_LIMIT * 2, side).catch(() => null);
  if (!cascade || !cascade.ok) return null;
  const windowMs = (needs.windowMinutes ?? 1_440) * 60_000;
  const items: { venueMarketId: string; question: string; change: number; eventId: string | null }[] = [];
  for (const candidate of cascade.value.items.slice(0, WATCH_LINKED_LIMIT)) {
    if (candidate.eventId === subject.eventId) continue;
    const linked = await provider.event(candidate.eventId).catch(() => null);
    if (!linked || !linked.ok) continue;
    const market = linked.value.markets[0];
    const outcome = market?.outcomes[0];
    if (!market || !outcome) continue;
    const change = await changeOver(provider, outcome.id, needs.resolution, needs.countBack, windowMs, nowMs);
    if (change === null) continue;
    items.push({ venueMarketId: market.id, question: market.question, change, eventId: candidate.eventId });
  }
  return { items };
}

export type SubjectReadDeps = Readonly<{
  store: GuardStore;
  provider: PredictionProvider;
  /** The wallet's positions, read once for the pass; an empty list is a wallet that holds nothing. */
  positions: readonly PaperPosition[];
  nowMs: number;
}>;

/**
 * Everything the rules of one market need, read once. Each part answers for
 * itself: a provider that failed one read leaves that part `null`, the rules
 * that need it are `unavailable`, and the rest of the market's rules are
 * judged as usual.
 */
export async function readSubject(subject: WatchSubject, needs: WatchNeeds, deps: SubjectReadDeps): Promise<WatchReads> {
  const { provider, nowMs } = deps;
  const [prices, bars, book, news, rules, related] = await Promise.all([
    needs.prices ? provider.prices([subject.venueMarketId]).then((r) => (r.ok ? (r.value[0] ?? null) : null), () => null) : Promise.resolve(null),
    needs.bars && needs.outcomeId ? provider.chart(needs.outcomeId, needs.resolution, needs.countBack).then((r) => (r.ok ? r.value.bars : null), () => null) : Promise.resolve(null),
    needs.book ? provider.book(subject.venueMarketId, WATCH_BOOK_DEPTH).then((r) => (r.ok ? r.value : null), () => null) : Promise.resolve(null),
    needs.news ? provider.news(subject.venueMarketId, WATCH_NEWS_LIMIT).then((r) => (r.ok ? r.value : null), () => null) : Promise.resolve(null),
    needs.rules ? rulesRead(deps.store, provider, subject, nowMs).catch(() => null) : Promise.resolve(null),
    needs.related ? relatedRead(provider, subject, needs, nowMs).catch(() => null) : Promise.resolve(null),
  ]);
  return {
    readAt: nowMs,
    prices: prices === null ? null : priceRead(prices, needs.outcomeId),
    bars,
    book: book === null ? null : bookRead(book),
    news:
      news === null ? null
      : {
          items: news.articles.map((article) => ({
            /* The item's own identity, so the same headline read again is the same item however the feed reorders it. */
            id: `${article.source}|${article.publishedAt ?? ""}|${article.title}`.slice(0, 220),
            title: article.title,
            source: article.source,
            publishedAt: article.publishedAt === null ? null : (Number.isFinite(Date.parse(article.publishedAt)) ? Date.parse(article.publishedAt) : null),
          })),
        },
    rules,
    position: needs.position ? positionRead(deps.positions, subject) : null,
    related,
  };
}
