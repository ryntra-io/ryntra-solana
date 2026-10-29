/**
 * The engine that decides whether something happened.
 *
 * It is deterministic and it is the only thing allowed to say *this
 * happened*: the clock, the figures one pass read and what the rule saw last
 * time go in; a verdict and the next observation come out. No model is
 * consulted here and none can be — a language model's part comes after, and
 * only to put a signal that this engine raised into a sentence.
 *
 * Three rules hold for every kind, and they are why a watch can be trusted
 * while nobody is looking:
 *
 * 1. **A read nobody can vouch for is never an event.** A figure the provider
 *    stamped too long ago is `stale`; a read that did not answer is
 *    `unavailable`. Neither fires, and neither is recorded as *nothing
 *    happened* either.
 * 2. **A crossing must have been seen.** A rule that compares *now* against
 *    *last time* fires only when it holds both ends of the comparison and
 *    they are close enough together in time to be one stretch of watching. A
 *    first pass, a restart, a cron that did not run, a stream that dropped
 *    and reconnected — all of them *re-baseline*: the figure is written down
 *    and nothing is sent. Otherwise reconnecting would announce every level
 *    the market crossed while nobody was reading, as though it had just
 *    happened.
 * 3. **The event names itself.** Every verdict that fires carries the
 *    identity of the thing that happened — the news item, the bar, the level,
 *    the window. The same thing read twice is the same identity, so a pass
 *    that runs twice, or two instances at once, cannot make two of it.
 *
 * Nothing here trades, quotes, signs or spends. A verdict is information.
 *
 * Pure.
 */

import type { PredictionBar } from "../model.ts";
import { LIQUIDITY_DEPTH_BAND, LIQUIDITY_THIN_DEPTH_USD, LIQUIDITY_WIDE_SPREAD, thresholdShape, WATCH_RULE_SHAPES, type WatchRuleInput } from "./rules.ts";

/** What a rule saw last time: enough to tell a crossing from a level that was already there. */
export type WatchObservation = Readonly<{
  /** When the figure below was read. */
  at: string;
  /** The figure this kind compares; null when the kind compares none. */
  figure: number | null;
  /** The newest stream item already accounted for, in ms — a news item's moment, a bar's open. */
  cursor: number | null;
  /** A short word or digest this kind compares instead of a figure: the rules' fingerprint, the settlement's phase. */
  mark: string | null;
}>;

/**
 * Two observations further apart than this are not one stretch of watching.
 * The pass runs every few minutes; three quarters of an hour of silence means
 * a deployment, an outage or a scheduler that missed its turn, and what the
 * market did in between was not watched.
 */
export const WATCH_GAP_MS = 45 * 60_000;
/** A price or a book stamped longer ago than this is not *now*. */
export const WATCH_READ_STALE_MS = 10 * 60_000;
/** A news item older than this is not news, however long nobody read it. */
export const WATCH_NEWS_FRESH_MS = 6 * 3_600_000;
/** Bars older than this are history, not the market as it stands. */
export const WATCH_BARS_STALE_MS = 3 * 3_600_000;
/** The fewest bars a pace can be judged from: fewer, and one quiet hour looks like a spike. */
export const WATCH_VOLUME_BARS_MIN = 6;

export type WatchOutcome =
  /** The rule's condition happened, and this pass is the first to see it. */
  | "fired"
  /** Read, judged, nothing happened. */
  | "held"
  /** The figures were too old to judge now. */
  | "stale"
  /** The read did not answer. */
  | "unavailable"
  /** Nothing to compare against yet: the figure is written down and nothing is sent. */
  | "rebased";

export type WatchFacts = Readonly<Record<string, string | number | null>>;

export type WatchVerdict = Readonly<{
  outcome: WatchOutcome;
  /** Ryntra's own short code for why, for the record; never a sentence. */
  reason: string;
  /** What the rule now holds; written whatever the outcome, so the next pass compares against this read. */
  observation: WatchObservation;
  /** The figures the signal is made of; only on `fired`. */
  facts: WatchFacts | null;
  /** What makes this the same happening if it is read again; only on `fired`. */
  event: string | null;
}>;

/* ------------------------------------------------------------------ what one pass read */

/** The market's prices as the provider stamped them, with every venue's own. */
export type WatchPriceRead = Readonly<{
  /** The watched outcome's price, 0–1; null when the provider gave none. */
  outcome: number | null;
  /** When the provider stamped the figure, in ms; null when it stamped none and the read's own moment stands. */
  stampedAt: number | null;
  /** Each venue's midpoint for the same market. */
  venues: readonly Readonly<{ venue: string; midpoint: number }>[];
}>;

export type WatchBookRead = Readonly<{
  bestBid: number | null;
  bestAsk: number | null;
  /** USD a person could trade into within the band of the mid, the thinner side of the two. */
  depthUsd: number | null;
  stampedAt: number | null;
}>;

export type WatchNewsRead = Readonly<{ items: readonly Readonly<{ id: string; title: string; source: string; publishedAt: number | null }>[] }>;

export type WatchRulesRead = Readonly<{
  /** The fingerprint of the market's rules and dates as this pass read them. */
  fingerprint: string;
  /** What moved, in Ryntra's own words, when the fingerprint is new: `text`, `closes`, `resolves`. */
  moved: readonly string[];
  /** Where settlement stands, as the product's own phase word. */
  phase: string;
  /** How late the result is, in ms, when the phase says late. */
  lateByMs: number | null;
}>;

export type WatchPositionRead = Readonly<{
  /** What the person's position in this market is worth now; 0 when they hold none. */
  valueUsd: number;
  held: boolean;
}>;

export type WatchRelatedRead = Readonly<{
  items: readonly Readonly<{ venueMarketId: string; question: string; change: number; eventId: string | null }>[];
}>;

/**
 * Everything one pass read about one market, each part on its own: a part
 * that did not answer is `null`, and a rule that needs it is `unavailable`
 * rather than quietly held. `reconnected` is the reader's own word that this
 * market's stream was interrupted since the last pass, which re-baselines
 * every rule that compares against last time.
 */
export type WatchReads = Readonly<{
  readAt: number;
  reconnected?: boolean;
  prices?: WatchPriceRead | null;
  bars?: readonly PredictionBar[] | null;
  book?: WatchBookRead | null;
  news?: WatchNewsRead | null;
  rules?: WatchRulesRead | null;
  position?: WatchPositionRead | null;
  related?: WatchRelatedRead | null;
}>;

/* ------------------------------------------------------------------ small pure helpers */

const held = (reason: string, observation: WatchObservation): WatchVerdict => ({ outcome: "held", reason, observation, facts: null, event: null });
const missing = (reason: string, observation: WatchObservation): WatchVerdict => ({ outcome: "unavailable", reason, observation, facts: null, event: null });
const old = (reason: string, observation: WatchObservation): WatchVerdict => ({ outcome: "stale", reason, observation, facts: null, event: null });
const rebase = (reason: string, observation: WatchObservation): WatchVerdict => ({ outcome: "rebased", reason, observation, facts: null, event: null });
const fire = (reason: string, observation: WatchObservation, event: string, facts: WatchFacts): WatchVerdict => ({ outcome: "fired", reason, observation, facts, event });

const round = (value: number, places = 4) => Number(value.toFixed(places));

function sight(reads: WatchReads, figure: number | null, cursor: number | null = null, mark: string | null = null): WatchObservation {
  return { at: new Date(reads.readAt).toISOString(), figure, cursor, mark };
}

/** Whether what the rule saw last time and what it sees now are one stretch of watching. */
function continuous(previous: WatchObservation | null, reads: WatchReads): boolean {
  if (!previous || reads.reconnected === true) return false;
  const was = Date.parse(previous.at);
  return Number.isFinite(was) && reads.readAt - was <= WATCH_GAP_MS;
}

/** The latest bar, and the bar at or before the start of the window. */
export function barsOverWindow(bars: readonly PredictionBar[], windowMs: number, nowMs: number): Readonly<{ from: PredictionBar; to: PredictionBar }> | null {
  if (bars.length < 2) return null;
  const ordered = [...bars].sort((a, b) => a.t - b.t);
  const to = ordered[ordered.length - 1]!;
  const start = nowMs - windowMs;
  /* The last bar that opened at or before the window's start; without one, the series is shorter than the window. */
  let from: PredictionBar | null = null;
  for (const bar of ordered) {
    if (bar.t <= start) from = bar;
    else break;
  }
  if (!from || from.t === to.t) return null;
  return { from, to };
}

/** The pace of the window's bars against its last one: how many times the latest hour traded what an hour of the window usually does. */
export function volumePace(bars: readonly PredictionBar[], windowMs: number, nowMs: number): Readonly<{ bar: PredictionBar; pace: number; average: number }> | null {
  const ordered = [...bars].filter((bar) => bar.t >= nowMs - windowMs && typeof bar.v === "number" && Number.isFinite(bar.v)).sort((a, b) => a.t - b.t);
  if (ordered.length < WATCH_VOLUME_BARS_MIN) return null;
  const last = ordered[ordered.length - 1]!;
  const before = ordered.slice(0, -1);
  const average = before.reduce((sum, bar) => sum + (bar.v ?? 0), 0) / before.length;
  if (!(average > 0)) return null;
  return { bar: last, pace: (last.v ?? 0) / average, average };
}

/** Whether a figure crossed the level in the direction asked, between what was seen and what is seen now. */
function crossed(was: number, now: number, level: number, direction: "above" | "below" | "any"): boolean {
  if (direction === "above") return was < level && now >= level;
  if (direction === "below") return was > level && now <= level;
  return (was < level && now >= level) || (was > level && now <= level);
}

/** The window the time buckets of a periodic rule are cut on, so one window gives one signal. */
const bucketOf = (nowMs: number, windowMs: number) => Math.floor(nowMs / Math.max(windowMs, 60_000));

/* ------------------------------------------------------------------ the kinds */

function judgePrice(rule: WatchRuleInput, reads: WatchReads, previous: WatchObservation | null): WatchVerdict {
  const prices = reads.prices;
  if (!prices) return missing("no_prices", previous ?? sight(reads, null));
  if (prices.outcome === null) return missing("no_outcome_price", previous ?? sight(reads, null));
  const stamped = prices.stampedAt ?? reads.readAt;
  const now = sight(reads, prices.outcome);
  if (reads.readAt - stamped > WATCH_READ_STALE_MS) return old("price_stale", previous ?? now);
  const level = rule.threshold!;
  const direction = rule.direction === "any" ? "any" : rule.direction;
  if (!continuous(previous, reads) || previous!.figure === null) return rebase("no_earlier_price", now);
  if (!crossed(previous!.figure, prices.outcome, level, direction)) return held("not_crossed", now);
  const way = prices.outcome >= level ? "above" : "below";
  return fire("crossed", now, `price:${way}:${round(level)}`, { was: round(previous!.figure), now: round(prices.outcome), level: round(level), way });
}

function judgeProbabilityMove(rule: WatchRuleInput, reads: WatchReads, previous: WatchObservation | null): WatchVerdict {
  const bars = reads.bars;
  if (!bars || bars.length === 0) return missing("no_bars", previous ?? sight(reads, null));
  const latest = Math.max(...bars.map((bar) => bar.t));
  if (reads.readAt - latest > WATCH_BARS_STALE_MS) return old("bars_stale", previous ?? sight(reads, null));
  const windowMs = rule.windowMinutes! * 60_000;
  const pair = barsOverWindow(bars, windowMs, reads.readAt);
  const now = sight(reads, pair ? pair.to.c : null, latest);
  /* The bars carry their own history, so a gap in the watching is no reason not to read the move; a series too short for the window is. */
  if (!pair) return missing("window_longer_than_series", now);
  const change = pair.to.c - pair.from.c;
  const enough = Math.abs(change) >= rule.threshold!;
  const way = change >= 0 ? "above" : "below";
  const wanted = rule.direction === "any" || rule.direction === way;
  if (!enough || !wanted) return held("move_small", now);
  return fire("moved", now, `move:${way}:${bucketOf(reads.readAt, windowMs)}`, { was: round(pair.from.c), now: round(pair.to.c), change: round(change), windowMinutes: rule.windowMinutes, way });
}

function judgeVolumeSpike(rule: WatchRuleInput, reads: WatchReads, previous: WatchObservation | null): WatchVerdict {
  const bars = reads.bars;
  if (!bars || bars.length === 0) return missing("no_bars", previous ?? sight(reads, null));
  const latest = Math.max(...bars.map((bar) => bar.t));
  if (reads.readAt - latest > WATCH_BARS_STALE_MS) return old("bars_stale", previous ?? sight(reads, null));
  const paced = volumePace(bars, rule.windowMinutes! * 60_000, reads.readAt);
  const now = sight(reads, paced ? round(paced.pace, 3) : null, latest);
  if (!paced) return missing("no_pace", now);
  if (paced.pace < rule.threshold!) return held("pace_normal", now);
  /* Keyed by the bar that spiked: the same bar read on the next pass is the same happening. */
  return fire("spiked", now, `volume:${paced.bar.t}`, { bar: paced.bar.t, pace: round(paced.pace, 2), volume: round(paced.bar.v ?? 0, 2), average: round(paced.average, 2), windowMinutes: rule.windowMinutes });
}

function judgeLiquidity(rule: WatchRuleInput, reads: WatchReads, previous: WatchObservation | null): WatchVerdict {
  const book = reads.book;
  if (!book) return missing("no_book", previous ?? sight(reads, null));
  if (book.bestBid === null || book.bestAsk === null || book.depthUsd === null) return missing("book_empty", previous ?? sight(reads, null));
  const stamped = book.stampedAt ?? reads.readAt;
  if (reads.readAt - stamped > WATCH_READ_STALE_MS) return old("book_stale", previous ?? sight(reads, book.depthUsd));
  const spread = Math.max(0, book.bestAsk - book.bestBid);
  const now = sight(reads, book.depthUsd, null, `${round(spread)}`);
  /*
   * Which of the two the person meant, and at what figure: asked for a wide
   * spread the figure is in probability points, asked for a thin book it is
   * USD of depth, and asked for either they set none — Ryntra's own two
   * bounds decide, because one field cannot carry both scales.
   */
  const wideAt = rule.direction === "above" ? rule.threshold! : LIQUIDITY_WIDE_SPREAD;
  const thinAt = rule.direction === "below" ? rule.threshold! : LIQUIDITY_THIN_DEPTH_USD;
  const wideNow = rule.direction !== "below" && spread >= wideAt;
  const thinNow = rule.direction !== "above" && book.depthUsd <= thinAt;
  if (!wideNow && !thinNow) return held("liquid", now);
  if (!continuous(previous, reads)) return rebase("no_earlier_book", now);
  /* A book that was already thin, or a spread already wide, is the market's state rather than something that just happened: said once, and again only after it recovered. */
  const wasSpread = previous!.mark === null ? Number.NaN : Number(previous!.mark);
  const thinBefore = previous!.figure !== null && previous!.figure <= thinAt;
  const wideBefore = Number.isFinite(wasSpread) && wasSpread >= wideAt;
  const newlyThin = thinNow && !thinBefore;
  const newlyWide = wideNow && !wideBefore;
  if (!newlyThin && !newlyWide) return held("already_illiquid", now);
  const which = newlyThin && newlyWide ? "both" : newlyThin ? "thin" : "wide";
  return fire("illiquid", now, `liquidity:${which}`, { which, spread: round(spread), depthUsd: round(book.depthUsd, 2), band: LIQUIDITY_DEPTH_BAND });
}

function judgeNews(_rule: WatchRuleInput, reads: WatchReads, previous: WatchObservation | null): WatchVerdict {
  const news = reads.news;
  if (!news) return missing("no_news_read", previous ?? sight(reads, null));
  const dated = news.items.filter((item) => item.publishedAt !== null && Number.isFinite(item.publishedAt));
  const newest = dated.length > 0 ? Math.max(...dated.map((item) => item.publishedAt!)) : null;
  /*
   * The first read of a market carries whatever its feed already holds. None
   * of that is news to send, so watching starts from this moment: the mark is
   * the newest item there is, or the read's own time when there is none.
   */
  if (previous?.cursor === null || previous?.cursor === undefined) return rebase("first_news_read", sight(reads, null, newest ?? reads.readAt));
  /* The mark only ever moves forward: a feed that drops an item cannot make the one before it news again. */
  const now = sight(reads, null, Math.max(previous.cursor, newest ?? 0));
  if (dated.length === 0) return held("no_dated_news", now);
  const fresh = dated
    .filter((item) => item.publishedAt! > previous.cursor!)
    .filter((item) => reads.readAt - item.publishedAt! <= WATCH_NEWS_FRESH_MS)
    .sort((a, b) => b.publishedAt! - a.publishedAt!);
  if (fresh.length === 0) return held("nothing_new", now);
  const item = fresh[0]!;
  /* Keyed by the item itself: the same headline read on every pass is one signal, and a second item is its own. */
  return fire("news", now, `news:${item.id}`, { headline: item.title.slice(0, 200), source: item.source.slice(0, 80), publishedAt: new Date(item.publishedAt!).toISOString(), more: fresh.length - 1 });
}

function judgeResolution(_rule: WatchRuleInput, reads: WatchReads, previous: WatchObservation | null): WatchVerdict {
  const rules = reads.rules;
  if (!rules) return missing("no_rules_read", previous ?? sight(reads, null));
  const now = sight(reads, rules.lateByMs === null ? null : Math.round(rules.lateByMs / 60_000), null, `${rules.fingerprint}|${rules.phase}`);
  const was = previous?.mark ?? null;
  if (was === null) return rebase("first_rules_read", now);
  const [wasPrint, wasPhase] = was.split("|");
  const changed = wasPrint !== undefined && wasPrint !== rules.fingerprint;
  const late = rules.phase === "delayed" && wasPhase !== "delayed";
  if (!changed && !late) return held("rules_same", now);
  if (changed && rules.moved.length === 0) {
    /* The fingerprint moved on something Ryntra does not keep: the new print is recorded without a claim about what changed. */
    return held("rules_print_only", now);
  }
  const which = changed && late ? "both" : changed ? "rules" : "late";
  const event = changed ? `rules:${rules.fingerprint}` : `late:${rules.phase}`;
  return fire("resolution", now, event, { which, moved: rules.moved.join(","), phase: rules.phase, lateMinutes: rules.lateByMs === null ? null : Math.round(rules.lateByMs / 60_000) });
}

function judgePositionValue(rule: WatchRuleInput, reads: WatchReads, previous: WatchObservation | null): WatchVerdict {
  const position = reads.position;
  if (!position) return missing("no_position_read", previous ?? sight(reads, null));
  const now = sight(reads, position.valueUsd);
  if (!position.held) return held("nothing_held", now);
  if (!continuous(previous, reads) || previous!.figure === null) return rebase("no_earlier_value", now);
  const level = rule.threshold!;
  if (!crossed(previous!.figure, position.valueUsd, level, rule.direction)) return held("not_crossed", now);
  const way = position.valueUsd >= level ? "above" : "below";
  return fire("position", now, `position:${way}:${round(level, 2)}`, { was: round(previous!.figure, 2), now: round(position.valueUsd, 2), level: round(level, 2), way });
}

function judgeVenueSpread(rule: WatchRuleInput, reads: WatchReads, previous: WatchObservation | null): WatchVerdict {
  const prices = reads.prices;
  if (!prices) return missing("no_prices", previous ?? sight(reads, null));
  const venues = prices.venues.filter((v) => Number.isFinite(v.midpoint));
  if (venues.length < 2) return missing("one_venue", previous ?? sight(reads, null));
  const stamped = prices.stampedAt ?? reads.readAt;
  if (reads.readAt - stamped > WATCH_READ_STALE_MS) return old("price_stale", previous ?? sight(reads, null));
  const high = venues.reduce((a, b) => (b.midpoint > a.midpoint ? b : a));
  const low = venues.reduce((a, b) => (b.midpoint < a.midpoint ? b : a));
  const gap = high.midpoint - low.midpoint;
  const now = sight(reads, round(gap));
  if (gap < rule.threshold!) return held("venues_together", now);
  /* A gap that was already open is the market's state; it is said once, and again only after it closed. */
  if (continuous(previous, reads) && previous!.figure !== null && previous!.figure >= rule.threshold!) return held("gap_already_open", now);
  if (!continuous(previous, reads)) return rebase("no_earlier_gap", now);
  return fire("venues", now, `venues:${round(rule.threshold!)}`, { gap: round(gap), high: high.venue.slice(0, 40), highPrice: round(high.midpoint), low: low.venue.slice(0, 40), lowPrice: round(low.midpoint), level: round(rule.threshold!) });
}

function judgeRelatedMove(rule: WatchRuleInput, reads: WatchReads, previous: WatchObservation | null): WatchVerdict {
  const related = reads.related;
  if (!related) return missing("no_related_read", previous ?? sight(reads, null));
  const moved = related.items.filter((item) => Number.isFinite(item.change) && Math.abs(item.change) >= rule.threshold!).filter((item) => rule.direction === "any" || (rule.direction === "above" ? item.change > 0 : item.change < 0));
  const biggest = moved.length === 0 ? null : moved.reduce((a, b) => (Math.abs(b.change) > Math.abs(a.change) ? b : a));
  const now = sight(reads, biggest ? round(biggest.change) : 0);
  if (!biggest) return held("related_quiet", now);
  const windowMs = rule.windowMinutes! * 60_000;
  /* One signal per linked market per window: a move read again inside the same window is the same move. */
  return fire("related", now, `related:${biggest.venueMarketId}:${bucketOf(reads.readAt, windowMs)}`, {
    /* Named apart from the watched market's own question: the words say both, and neither may stand in for the other. */
    linkedQuestion: biggest.question.slice(0, 200),
    change: round(biggest.change),
    windowMinutes: rule.windowMinutes,
    linkedEventId: biggest.eventId,
    more: moved.length - 1,
    way: biggest.change >= 0 ? "above" : "below",
  });
}

/* ------------------------------------------------------------------ the one entry point */

const JUDGES: Readonly<Record<string, (rule: WatchRuleInput, reads: WatchReads, previous: WatchObservation | null) => WatchVerdict>> = {
  price: judgePrice,
  probability_move: judgeProbabilityMove,
  volume_spike: judgeVolumeSpike,
  liquidity: judgeLiquidity,
  news: judgeNews,
  resolution: judgeResolution,
  position_value: judgePositionValue,
  venue_spread: judgeVenueSpread,
  related_move: judgeRelatedMove,
};

/**
 * One rule against one pass's reads. The verdict is the whole answer: what
 * happened or did not, what the rule now holds, and — when something did —
 * the figures and the identity of the happening.
 */
export function judgeRule(rule: WatchRuleInput, reads: WatchReads, previous: WatchObservation | null): WatchVerdict {
  const judge = JUDGES[rule.kind];
  if (!judge) return missing("unknown_kind", previous ?? sight(reads, null));
  /* A kind that needs a figure or a period must have one: a rule stored without either is not judged, never guessed at. */
  const shape = WATCH_RULE_SHAPES[rule.kind];
  if ((thresholdShape(rule.kind, rule.direction) !== null && rule.threshold === null) || (shape.window !== null && rule.windowMinutes === null)) return missing("rule_incomplete", previous ?? sight(reads, null));
  return judge(rule, reads, previous);
}

/* ------------------------------------------------------------------ checking a signal again */

/**
 * What a later read says about a signal already raised: `confirmed` — the
 * market still shows what the signal claims; `stale` — it does not any more,
 * so the signal's figures are no longer something to act on; `unavailable` —
 * this pass could not read the market, so neither can be said.
 *
 * A signal is never *confirmed* on the same read that raised it, and it is
 * never re-sent: confirming moves the state a person sees, nothing else. A
 * signal also goes stale by age wherever it stands (`WATCH_SIGNAL_FRESH_MS`),
 * because the quote behind it ages whatever the market does.
 */
export function reviewSignal(rule: WatchRuleInput, facts: WatchFacts, reads: WatchReads): "confirmed" | "stale" | "unavailable" {
  const fresh = (stampedAt: number | null | undefined) => stampedAt === null || stampedAt === undefined || reads.readAt - stampedAt <= WATCH_READ_STALE_MS;
  const way = typeof facts.way === "string" ? facts.way : null;
  switch (rule.kind) {
    case "price": {
      if (!reads.prices || reads.prices.outcome === null) return "unavailable";
      if (!fresh(reads.prices.stampedAt)) return "unavailable";
      const level = rule.threshold!;
      const beyond = way === "below" ? reads.prices.outcome <= level : reads.prices.outcome >= level;
      return beyond ? "confirmed" : "stale";
    }
    case "position_value": {
      if (!reads.position) return "unavailable";
      if (!reads.position.held) return "stale";
      const level = rule.threshold!;
      return (way === "below" ? reads.position.valueUsd <= level : reads.position.valueUsd >= level) ? "confirmed" : "stale";
    }
    case "venue_spread": {
      if (!reads.prices) return "unavailable";
      const venues = reads.prices.venues.filter((v) => Number.isFinite(v.midpoint));
      if (venues.length < 2 || !fresh(reads.prices.stampedAt)) return "unavailable";
      const gap = Math.max(...venues.map((v) => v.midpoint)) - Math.min(...venues.map((v) => v.midpoint));
      return gap >= rule.threshold! ? "confirmed" : "stale";
    }
    case "liquidity": {
      const book = reads.book;
      if (!book || book.bestBid === null || book.bestAsk === null || book.depthUsd === null || !fresh(book.stampedAt)) return "unavailable";
      const spread = Math.max(0, book.bestAsk - book.bestBid);
      const wideAt = rule.direction === "above" ? rule.threshold! : LIQUIDITY_WIDE_SPREAD;
      const thinAt = rule.direction === "below" ? rule.threshold! : LIQUIDITY_THIN_DEPTH_USD;
      const still = (rule.direction !== "below" && spread >= wideAt) || (rule.direction !== "above" && book.depthUsd <= thinAt);
      return still ? "confirmed" : "stale";
    }
    case "probability_move": {
      if (!reads.bars || reads.bars.length === 0) return "unavailable";
      const pair = barsOverWindow(reads.bars, rule.windowMinutes! * 60_000, reads.readAt);
      if (!pair) return "unavailable";
      const change = pair.to.c - pair.from.c;
      const sameWay = way === null || (way === "above" ? change > 0 : change < 0);
      return Math.abs(change) >= rule.threshold! && sameWay ? "confirmed" : "stale";
    }
    case "volume_spike": {
      if (!reads.bars || reads.bars.length === 0) return "unavailable";
      const paced = volumePace(reads.bars, rule.windowMinutes! * 60_000, reads.readAt);
      if (!paced) return "unavailable";
      /* The hour that spiked is the signal: once the series has moved past that bar, the figure is history. */
      return String(paced.bar.t) === String(facts.bar ?? paced.bar.t) && paced.pace >= rule.threshold! ? "confirmed" : "stale";
    }
    case "related_move": {
      if (!reads.related) return "unavailable";
      const linked = reads.related.items.find((item) => item.question.slice(0, 200) === facts.linkedQuestion);
      if (!linked) return "stale";
      return Math.abs(linked.change) >= rule.threshold! ? "confirmed" : "stale";
    }
    case "news":
      /* A published item stays published: a second read that answered is the confirmation, and age alone makes it old. */
      return reads.news ? "confirmed" : "unavailable";
    case "resolution": {
      if (!reads.rules) return "unavailable";
      const print = typeof facts.phase === "string" ? facts.phase : null;
      /* A delay that ended is no longer something to act on; a rules change stays true once read. */
      return facts.which === "late" && print !== null && reads.rules.phase !== print ? "stale" : "confirmed";
    }
    default:
      return "unavailable";
  }
}

/** Past this a signal's figures are no longer the market: before acting, a fresh quote. */
export const WATCH_SIGNAL_FRESH_MS = 2 * 3_600_000;
