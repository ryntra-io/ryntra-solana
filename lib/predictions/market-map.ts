/**
 * The market map: the markets the provider's model links to the one a person
 * is looking at — those it expects to move with the outcome they picked,
 * those it expects to move the other way, and those on the same theme — each
 * with what links them, its price and day, and what in its dates or status
 * could work against the link (it closes earlier, the model's two lists
 * disagree on it, it no longer trades, only the titles are alike, the day's
 * prices went the other way).
 *
 * A link is the model's thematic one, never a proven cause: the model's words
 * are passed on as they are, every price is the venue's own outcome price as
 * the market page shows it, and every verdict here is a plain comparison of
 * dates, statuses and prices. Where the model names an event of several
 * markets and no market in it, no price, pair or day is drawn for it — which
 * market it meant is not ours to guess.
 *
 * Pure: the server reads the provider and hands the parts in.
 */

import { statusOf, type PredictionBar, type PredictionEvent, type PredictionMarket, type PredictionRelatedMarket, type PredictionRipple } from "./model.ts";

export type MapSide = "yes" | "no";
/** `with` — the model expects it to move with the person's outcome here; `against` — the other way; `theme` — the same theme, no direction. */
export type MapGroup = "with" | "against" | "theme";

export type MapCheck =
  /** The model's two lists disagree on this market: one says it moves with this one, the other the other way. */
  | Readonly<{ code: "bothWays" }>
  /** The linked market no longer trades. */
  | Readonly<{ code: "settled"; status: string }>
  /** It closes this many whole days before this market does. */
  | Readonly<{ code: "endsBefore"; days: number }>
  /** It closes this many whole days after this market does. */
  | Readonly<{ code: "endsAfter"; days: number }>
  /** One of the two markets gives no close date, so the dates were not compared. */
  | Readonly<{ code: "datesUnknown" }>
  /** The venue gives no plain trading status for it. */
  | Readonly<{ code: "statusUnknown" }>
  /** Only the titles are alike; the model gave no reason. */
  | Readonly<{ code: "titleOnly" }>
  /** Over the last day the two prices moved the way the link does not expect. */
  | Readonly<{ code: "pricesAgainst" }>;

/** A linked market as the model names it, before its prices are read. */
export type MapCandidate = Readonly<{
  eventId: string;
  /** The venue market the model named, when it named one (the same-theme search does; the cascade names events only). */
  marketId: string | null;
  title: string;
  group: MapGroup;
  score: number;
  /** The model's words for the link, verbatim; null when it gave none. */
  reason: string | null;
  domain: string | null;
  /** The side there the model pairs with the person's outcome here; null when it names none. */
  there: MapSide | null;
  titleOnly: boolean;
  bothWays: boolean;
  /** What the model's own answer says of the event, for when the event cannot be read. */
  fallback: Readonly<{ status: string; endDate: string | null }> | null;
}>;

/** What the venues say of a linked market now. */
export type MapFacts = Readonly<{
  /** Null when the event holds several markets and none was named: then no price, pair or day. */
  marketId: string | null;
  /** The outcome whose price is drawn, for its day's bars; null without a market. */
  outcomeId: string | null;
  /** The market's question when the event holds more than one market; null otherwise. */
  question: string | null;
  venue: string | null;
  status: string;
  endDate: string | null;
  /** The drawn outcome's label as the venue names it and its price, 0–1, as the market's own page shows it. */
  label: string | null;
  price: number | null;
  /** The change of that outcome's price over the last day; null when the history does not reach back that far. */
  change24h: number | null;
}>;

export type MapLink = Readonly<{
  eventId: string;
  marketId: string | null;
  title: string;
  group: MapGroup;
  score: number;
  reason: string | null;
  domain: string | null;
  /** The model's pair, drawn only for a single market: the side there that goes with the person's outcome here. */
  there: MapSide | null;
  question: string | null;
  venue: string | null;
  status: string | null;
  endDate: string | null;
  label: string | null;
  price: number | null;
  change24h: number | null;
  /** How the two prices moved over the day against what the link expects; null when there is nothing to compare. */
  moved: "as-linked" | "against" | "flat" | null;
  checks: readonly MapCheck[];
  /** `market` — one market's figures; `event` — an event of several markets, none named; `unread` — its event did not answer. */
  scope: "market" | "event" | "unread";
}>;

export type MapPart = "ok" | "failed";

export type MarketMap = Readonly<{
  /** `side` is null for an outcome whose side is not known: then only the theme is read. */
  anchor: Readonly<{ eventId: string; marketId: string; outcomeId: string; side: MapSide | null; endDate: string | null; change24h: number | null }>;
  links: readonly MapLink[];
  /** Which of the provider's reads answered: a failed one is a state of its group, never a failed map. */
  parts: Readonly<Record<MapGroup, MapPart>>;
  readAt: string;
}>;

const PER_GROUP = 5;
const DAY = 86_400_000;
/** A move smaller than one point over a day says nothing either way. */
const FLAT = 0.01;
/** Closing within a day of each other is the same time; within a week after, the same season. */
const BEFORE_DAYS = 1;
const AFTER_DAYS = 7;
/** Long enough for any reason a model writes; a guard against a runaway answer, not a summary. */
const TEXT_LIMIT = 2_000;

/** The side the model names in its action (`buy_yes`, `Buy No`…); null when it names none. */
export function actionSide(action: string | null | undefined): MapSide | null {
  const text = (action ?? "").toLowerCase();
  const yes = /\byes\b|_yes\b/.test(text);
  const no = /\bno\b|_no\b/.test(text);
  if (yes === no) return null;
  return yes ? "yes" : "no";
}

/**
 * The side a picked outcome is of its market: Yes or No by its label, else —
 * in a market of two — by its place, the provider listing the Yes-like one
 * first. Null in a market of more than two not named so: which side the
 * model's lists mean for it is not known.
 */
export function sideOf(market: Pick<PredictionMarket, "outcomes">, outcomeId: string): MapSide | null {
  const index = market.outcomes.findIndex((o) => o.id === outcomeId);
  const label = (market.outcomes[index]?.label ?? "").trim().toLowerCase();
  if (label === "yes") return "yes";
  if (label === "no") return "no";
  if (market.outcomes.length !== 2) return null;
  return index === 1 ? "no" : "yes";
}

/** The change of the close over the last day, from the bars; null when the history does not reach back that far. */
export function dayChange(bars: readonly PredictionBar[], nowMs: number): number | null {
  if (bars.length < 2) return null;
  const target = nowMs - DAY;
  let earlier: PredictionBar | null = null;
  for (const bar of bars) {
    if (bar.t <= target) earlier = bar;
    else break;
  }
  if (!earlier) return null;
  return bars[bars.length - 1]!.c - earlier.c;
}

const clean = (text: string | null | undefined): string | null => {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > 0 ? t.slice(0, TEXT_LIMIT) : null;
};
const same = (a: string | null | undefined, b: string | null | undefined) => {
  const x = clean(a)?.toLowerCase().replace(/[?.!]+$/, "");
  return Boolean(x) && x === clean(b)?.toLowerCase().replace(/[?.!]+$/, "");
};

/** Which way the linked market's first outcome moves with the person's outcome: +1 together, −1 apart; null when the model names no side. */
function relation(group: MapGroup, there: MapSide | null): 1 | -1 | null {
  if (!there || group === "theme") return null;
  return (group === "with") === (there === "yes") ? 1 : -1;
}

/**
 * The linked markets in the order they are drawn: each event once, never
 * this event or its twin on another venue, the strongest first, at most five
 * a group. A market in both of the model's lists keeps the place it scored
 * higher; when the two lists say the same (Yes moves with it, so No moves
 * against it) it is one link, when their named directions differ it is
 * marked. A same-theme
 * market already linked by the model's direction is not repeated.
 * `relatedEvent` names the event of a same-theme market — the search does not.
 */
export function mapCandidates(input: Readonly<{
  anchorEventId: string;
  anchorMarketIds: readonly string[];
  /** This event's title and its markets' questions: a link titled the same is this market on another venue. */
  anchorTitles: readonly string[];
  expand: PredictionRipple | null;
  hedge: PredictionRipple | null;
  related: readonly PredictionRelatedMarket[] | null;
  relatedEvent?: (r: PredictionRelatedMarket) => string | null;
  /** How many same-theme markets to keep: more when some may yet be left out as namesakes. */
  themeKeep?: number;
}>): readonly MapCandidate[] {
  const own = new Set(input.anchorMarketIds);
  const twin = (title: string | null | undefined) => input.anchorTitles.some((t) => same(t, title));
  const directed = new Map<string, MapCandidate>();
  const cascade = (ripple: PredictionRipple | null, group: "with" | "against") => {
    for (const item of ripple?.items ?? []) {
      if (!item.eventId || item.eventId === input.anchorEventId || !Number.isFinite(item.score) || twin(item.title)) continue;
      const candidate: MapCandidate = {
        eventId: item.eventId,
        marketId: null,
        title: clean(item.title) ?? item.eventId,
        group,
        score: item.score,
        reason: clean(item.reason),
        domain: clean(item.domain),
        there: actionSide(item.action),
        titleOnly: false,
        bothWays: false,
        fallback: { status: statusOf(item.status), endDate: item.endDate },
      };
      const before = directed.get(item.eventId);
      if (!before) {
        directed.set(item.eventId, candidate);
        continue;
      }
      const keep = candidate.score > before.score ? candidate : before;
      const a = relation(before.group, before.there);
      const b = relation(candidate.group, candidate.there);
      /* Disagreement is two named directions that differ; a list naming no side says nothing either way. */
      const disagree = a !== null && b !== null && a !== b;
      directed.set(item.eventId, { ...keep, bothWays: before.bothWays || disagree });
    }
  };
  cascade(input.expand, "with");
  cascade(input.hedge, "against");

  const theme = new Map<string, MapCandidate>();
  for (const r of input.related ?? []) {
    if (own.has(r.venueMarketId) || !Number.isFinite(r.score) || isOwn(r, input.anchorMarketIds, input.anchorTitles)) continue;
    const eventId = r.venueEventId ?? input.relatedEvent?.(r) ?? null;
    if (!eventId || eventId === input.anchorEventId || directed.has(eventId)) continue;
    const before = theme.get(eventId);
    if (before && before.score >= r.score) continue;
    const titleOnly = r.matchSource === "title_fallback";
    theme.set(eventId, {
      eventId,
      marketId: r.venueMarketId,
      title: clean(r.eventTitle) ?? clean(r.marketQuestion) ?? eventId,
      group: "theme",
      score: r.score,
      reason: titleOnly ? null : clean(r.matchedSignal),
      domain: null,
      there: null,
      titleOnly,
      bothWays: false,
      fallback: null,
    });
  }

  const byScore = (a: MapCandidate, b: MapCandidate) => b.score - a.score || a.eventId.localeCompare(b.eventId);
  const all = [...directed.values(), ...theme.values()];
  return (["with", "against", "theme"] as const).flatMap((group) => all.filter((c) => c.group === group).sort(byScore).slice(0, group === "theme" ? (input.themeKeep ?? PER_GROUP) : PER_GROUP));
}

/** At most five a group, in the order given. */
export function firstOfEachGroup(candidates: readonly MapCandidate[]): readonly MapCandidate[] {
  const count = new Map<MapGroup, number>();
  return candidates.filter((c) => {
    const n = count.get(c.group) ?? 0;
    count.set(c.group, n + 1);
    return n < PER_GROUP;
  });
}

/** A market of this event, or the same question on another venue, as the same-theme search returns it. */
export function isOwn(r: Pick<PredictionRelatedMarket, "venueMarketId" | "marketQuestion" | "eventTitle">, anchorMarketIds: readonly string[], anchorTitles: readonly string[]): boolean {
  return anchorMarketIds.includes(r.venueMarketId) || anchorTitles.some((t) => same(t, r.marketQuestion) || same(t, r.eventTitle));
}

/**
 * A linked market's facts from its event, before its day is read: the market
 * the model named — null when it is not in this event, so another market's
 * figures are never drawn for it — or the event's only market; the outcome of
 * the side the model pairs (Yes-like when it names none), with the price the
 * market's own page shows. An event of several markets, none named, gives its
 * status and close only.
 */
export function factsOf(event: PredictionEvent, marketId: string | null, side: MapSide | null): MapFacts | null {
  const market = marketId ? event.markets.find((m) => m.id === marketId || m.matched.some((v) => v.id === marketId)) : event.markets.length === 1 ? event.markets[0] : undefined;
  if (marketId && !market) return null;
  if (!market) return { marketId: null, outcomeId: null, question: null, venue: event.venue, status: event.status, endDate: event.endDate, label: null, price: null, change24h: null };
  const wanted = side ?? "yes";
  const outcome = market.outcomes.find((o) => sideOf(market, o.id) === wanted) ?? (wanted === "yes" ? market.outcomes[0] : undefined);
  return {
    marketId: market.id,
    outcomeId: outcome?.id ?? null,
    question: event.markets.length > 1 ? clean(market.question) : null,
    venue: market.venue,
    status: market.status,
    endDate: market.endDate ?? event.endDate,
    label: outcome?.label ?? null,
    price: outcome?.probability ?? null,
    change24h: null,
  };
}

/**
 * The map: each candidate with its facts, how the prices moved against the
 * link and what in the dates or status could work against it. A candidate
 * whose event could not be read is drawn with what the model said of it.
 */
export function finishMarketMap(input: Readonly<{
  anchor: MarketMap["anchor"];
  candidates: readonly MapCandidate[];
  facts: ReadonlyMap<string, MapFacts>;
  parts: MarketMap["parts"];
  readAt: string;
}>): MarketMap {
  const anchorClose = input.anchor.endDate ? Date.parse(input.anchor.endDate) : NaN;
  const here = input.anchor.change24h;
  const links = input.candidates.map((c): MapLink => {
    const read = input.facts.get(c.eventId) ?? null;
    const f = read ?? (c.fallback ? { marketId: null, outcomeId: null, question: null, venue: null, status: c.fallback.status, endDate: c.fallback.endDate, label: null, price: null, change24h: null } : null);
    const single = f?.marketId != null;
    const settled = f != null && (f.status === "closed" || f.status === "resolved");
    const there = single ? c.there : null;
    let moved: MapLink["moved"] = null;
    if (c.group !== "theme" && there && !settled && here != null && f?.change24h != null) {
      if (Math.abs(here) < FLAT || Math.abs(f.change24h) < FLAT) moved = "flat";
      else moved = Math.sign(here) * Math.sign(f.change24h) === (c.group === "with" ? 1 : -1) ? "as-linked" : "against";
    }
    const checks: MapCheck[] = [];
    if (c.bothWays) checks.push({ code: "bothWays" });
    if (settled && f) checks.push({ code: "settled", status: f.status });
    /* A settled market's dates say nothing more: it no longer trades. */
    if (f && !settled) {
      const close = f.endDate ? Date.parse(f.endDate) : NaN;
      if (Number.isFinite(close) && Number.isFinite(anchorClose)) {
        const days = (close - anchorClose) / DAY;
        if (days < -BEFORE_DAYS) checks.push({ code: "endsBefore", days: Math.floor(-days) });
        else if (days > AFTER_DAYS) checks.push({ code: "endsAfter", days: Math.floor(days) });
      } else checks.push({ code: "datesUnknown" });
      if (f.status !== "open") checks.push({ code: "statusUnknown" });
    }
    if (c.titleOnly) checks.push({ code: "titleOnly" });
    if (moved === "against") checks.push({ code: "pricesAgainst" });
    return {
      eventId: c.eventId,
      marketId: f?.marketId ?? c.marketId,
      title: c.title,
      group: c.group,
      score: c.score,
      reason: c.reason,
      domain: c.domain,
      there,
      question: f?.question ?? null,
      venue: f?.venue ?? null,
      status: f?.status ?? null,
      endDate: f?.endDate ?? null,
      label: f?.label ?? null,
      price: f?.price ?? null,
      change24h: f?.change24h ?? null,
      moved,
      checks,
      scope: !read ? "unread" : single ? "market" : "event",
    };
  });
  return { anchor: input.anchor, links, parts: input.parts, readAt: input.readAt };
}
