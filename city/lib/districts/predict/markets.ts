import type { PredictionCategory, PredictionEventSummary } from '../../../../lib/predictions/model.ts';
import { dateText, digits, wordsNow } from '../../i18n/dict.ts';
import { PREDICT_TEXT } from './words.ts';

/**
 * Predictions' markets as the window shows them: one card per open event — the question, the event's picture, the
 * price of each side in cents and its chance, the volume the aggregator counts and the close. Every figure is the
 * venue's, read through Ryntra Predictions (the same engine as the web's Predictions); the window adds none of its own. A
 * market past its close, settled, or without two priced sides never gets a card: its last price is no offer to buy at.
 */

/** One side of a market, priced by the venue: 0–1. */
export type Side = Readonly<{ id: string; label: string; p: number }>;

export type Market = Readonly<{
  eventId: string;
  /** The venue market the sides are the outcomes of. */
  marketId: string;
  title: string;
  /** The market's own question when the event holds several and it says more than the title; null otherwise. */
  question: string | null;
  image: string | null;
  /** Yes then No for a yes/no market; otherwise the most likely outcomes first. */
  sides: readonly Side[];
  binary: boolean;
  /** What AGG counts across the matched venues; null when it gives none. */
  volume: number | null;
  /** The close as the venue states it; null when there is none. */
  closes: string | null;
  venues: readonly string[];
  /** The engine's category slugs of the event, its first one leading. */
  categories: readonly string[];
  /** How many markets the event holds: more than one, and its page lists them all. */
  marketCount: number;
}>;

/** How a tab orders its markets, as the engine sorts them: the day's volume, or the soonest close. */
export type Sort = 'volume24h' | 'ending';

/**
 * A tab of the window: Trending is the whole list by the day's volume, Ending soon the soonest closes; every other tab
 * is one of the engine's categories. A search is a tab of its own while it is open (`searchTab`).
 */
export type Tab = Readonly<{ id: string; label: string; category: string | null; sort?: Sort; q?: string }>;

export const TRENDING: Tab = { id: 'trending', label: 'Trending', category: null };
export const ENDING: Tab = { id: 'ending', label: 'Ending soon', category: null, sort: 'ending' };

/** The tab of a search: the words, trimmed; null for none. */
export function searchTab(q: string): Tab | null {
  const words = q.trim().replace(/\s+/g, ' ').slice(0, 80);
  return words.length >= 2 ? { id: `q:${words.toLowerCase()}`, label: words, category: null, q: words } : null;
}

/** A read older than this is said to be delayed, and nothing is bought at its prices. */
export const DELAY_MS = 2 * 60_000;
/** Cards a tab lists at most: the most traded in a day first. */
export const LIST_MAX = 24;
/** Tabs beside Trending at most. */
export const TABS_MAX = 5;
/** A market with more outcomes shows this many, the most likely first. */
const MAX_SIDES = 4;
/** The categories the window names first when the engine has them, in this order; the rest follow by the day's volume. */
const FIRST = ['crypto', 'politics', 'sports', 'world'];

const VENUE_NAMES: Readonly<Record<string, string>> = {
  polymarket: 'Polymarket',
  kalshi: 'Kalshi',
  limitless: 'Limitless',
  opinion: 'Opinion',
  myriad: 'Myriad',
  predict: 'Predict.fun',
  probable: 'Probable',
};

export function venueName(venue: string): string {
  return VENUE_NAMES[venue.toLowerCase()] ?? venue.charAt(0).toUpperCase() + venue.slice(1);
}

const isYes = (label: string) => /^yes$/i.test(label.trim());
const isNo = (label: string) => /^no$/i.test(label.trim());

/**
 * A side's name on the screen: the generic Yes and No in the language on screen, any other outcome as the venue names
 * it. Only for the eye — the label itself (what matching and orders read) never changes.
 */
export function sideName(label: string): string {
  const w = wordsNow(PREDICT_TEXT);
  return isYes(label) ? w.yes : isNo(label) ? w.no : label;
}

/** A tab's name in the language on screen: Trending and Ending soon, the engine's known categories; a search keeps its words. */
export function tabName(tab: Pick<Tab, 'id' | 'label'> & Partial<Pick<Tab, 'q'>>): string {
  const w = wordsNow(PREDICT_TEXT);
  if (tab.id === TRENDING.id) return w.trending;
  if (tab.id === ENDING.id) return w.ending;
  return tab.q ? tab.label : w.category(tab.id, tab.label);
}
const priced = (p: unknown): p is number => typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1;
const IMAGE = /^https:\/\/[^\s"'<>]+$/;

/** One event as a card; null when it is not a market to buy now. */
export function marketOf(event: PredictionEventSummary, nowMs: number = Date.now()): Market | null {
  if (event.status !== 'open' || !event.id || !event.title?.trim()) return null;
  const end = event.endDate ? Date.parse(event.endDate) : NaN;
  if (event.endDate && (!Number.isFinite(end) || end <= nowMs)) return null;
  const marketId = event.leading[0]?.venueMarketId;
  if (!marketId || event.leading.some((o) => o.venueMarketId !== marketId)) return null;
  const sides: Side[] = [];
  for (const o of event.leading) if (o.id && o.label?.trim() && priced(o.probability)) sides.push({ id: o.id, label: o.label.trim(), p: o.probability });
  if (sides.length < 2 || new Set(sides.map((s) => s.id)).size !== sides.length) return null;
  const yes = sides.find((s) => isYes(s.label));
  const no = sides.find((s) => isNo(s.label));
  const binary = Boolean(yes && no && sides.length === 2);
  const ordered = binary ? [yes!, no!] : [...sides].sort((a, b) => b.p - a.p || (a.label < b.label ? -1 : 1)).slice(0, MAX_SIDES);
  const question = event.leadingQuestion?.trim() && event.leadingQuestion.trim().toLowerCase() !== event.title.trim().toLowerCase() ? event.leadingQuestion.trim() : null;
  return {
    eventId: event.id,
    marketId,
    title: event.title.trim(),
    question,
    image: typeof event.image === 'string' && IMAGE.test(event.image) ? event.image : null,
    sides: ordered,
    binary,
    volume: typeof event.volume === 'number' && Number.isFinite(event.volume) && event.volume >= 0 ? event.volume : null,
    closes: event.endDate ?? null,
    venues: (event.venues?.length ? event.venues : [event.venue]).filter(Boolean).map(venueName),
    categories: (event.categories ?? []).map((c) => c?.slug).filter((slug): slug is string => typeof slug === 'string' && slug.length > 0),
    marketCount: typeof event.marketCount === 'number' && Number.isFinite(event.marketCount) && event.marketCount > 0 ? Math.floor(event.marketCount) : 1,
  };
}

/** The cards from a page of events: open, priced markets only, one per event, in the order read. */
export function marketsOf(events: readonly PredictionEventSummary[], nowMs: number = Date.now(), limit = LIST_MAX): Market[] {
  const seen = new Set<string>();
  const cards: Market[] = [];
  for (const event of events) {
    const card = marketOf(event, nowMs);
    if (!card || seen.has(card.eventId)) continue;
    seen.add(card.eventId);
    cards.push(card);
    if (cards.length >= limit) break;
  }
  return cards;
}

/**
 * The window's tabs: Trending, then the engine's own categories — Crypto, Politics, Sports and World first where the
 * engine has them, the others by the day's volume — after Ending soon. Without the engine's categories there are the two alone.
 */
export function tabsOf(categories: readonly PredictionCategory[], unavailable = false): Tab[] {
  if (unavailable) return [TRENDING, ENDING];
  const usable = categories.filter((c) => c && typeof c.slug === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(c.slug) && typeof c.name === 'string' && c.name.trim() && c.slug !== TRENDING.id && c.slug !== ENDING.id);
  const unique = [...new Map(usable.map((c) => [c.slug.toLowerCase(), c] as const)).values()];
  const rank = (c: PredictionCategory) => {
    const at = FIRST.indexOf(c.slug.toLowerCase());
    return at === -1 ? FIRST.length : at;
  };
  const ordered = unique.sort((a, b) => rank(a) - rank(b) || (Number(b.volume24h) || 0) - (Number(a.volume24h) || 0));
  return [TRENDING, ENDING, ...ordered.slice(0, TABS_MAX).map((c) => ({ id: c.slug, label: title(c.name), category: c.slug }))];
}

function title(name: string): string {
  const n = name.trim();
  return n.charAt(0).toUpperCase() + n.slice(1);
}

export type Discovered = Readonly<{ events: readonly PredictionEventSummary[]; categories: readonly PredictionCategory[]; categoriesUnavailable: boolean; readAt: string }>;

/** What `/api/predictions/discover` answered, when it has the shape the window reads; null otherwise. */
export function readDiscover(json: unknown): Discovered | null {
  if (!json || typeof json !== 'object') return null;
  const body = json as { events?: unknown; readAt?: unknown; categories?: unknown; categoriesUnavailable?: unknown };
  if (!Array.isArray(body.events) || typeof body.readAt !== 'string' || !Number.isFinite(Date.parse(body.readAt))) return null;
  const events = body.events.filter(
    (e): e is PredictionEventSummary => !!e && typeof e === 'object' && typeof (e as { id?: unknown }).id === 'string' && Array.isArray((e as { leading?: unknown }).leading),
  );
  const categories = Array.isArray(body.categories)
    ? body.categories.filter((c): c is PredictionCategory => !!c && typeof c === 'object' && typeof (c as { slug?: unknown }).slug === 'string' && typeof (c as { name?: unknown }).name === 'string')
    : [];
  return { events, categories, categoriesUnavailable: body.categoriesUnavailable === true || !Array.isArray(body.categories), readAt: body.readAt };
}

/** The side that leads: the one the venue prices highest; Yes on a tie. */
export function leadOf(market: Pick<Market, 'sides'>): Side {
  return market.sides.reduce((best, side) => (side.p > best.p ? side : best), market.sides[0]!);
}

/** The side a card's chance speaks of: Yes on a yes/no market, the leading outcome otherwise. */
export function headSide(market: Pick<Market, 'sides' | 'binary'>): Side {
  return market.binary ? market.sides[0]! : leadOf(market);
}

/** Whether a read is too old to stand for now. A read that cannot be dated is delayed too. */
export function isDelayed(readAt: string | null, nowMs: number = Date.now()): boolean {
  if (!readAt) return true;
  const at = Date.parse(readAt);
  return !Number.isFinite(at) || nowMs - at > DELAY_MS;
}

/** A side's price in cents, as a share of it costs: 58¢; never a flat 0 or 100 for a market still trading. */
export function cents(p: number): string {
  if (!Number.isFinite(p)) return '—';
  if (p > 0 && p < 0.01) return '<1¢';
  if (p < 1 && p > 0.99) return '>99¢';
  return `${Math.round(p * 100)}¢`;
}

/** A probability as a chance: whole percent, never a flat 0 or 100 for a market still trading. */
export function chance(p: number): string {
  if (!Number.isFinite(p)) return '—';
  if (p > 0 && p < 0.01) return '<1%';
  if (p < 1 && p > 0.99) return '>99%';
  return `${Math.round(p * 100)}%`;
}

/**
 * What a buy of `spendUsd` pays if the side wins: a share costs the side's price and pays one dollar, so the spend
 * buys `spend ÷ price` shares and wins as many dollars — stake included. Rounded down to the cent; 0 for no price.
 */
export function toWin(spendUsd: number, p: number): number {
  if (!(spendUsd > 0) || !(p > 0) || !(p <= 1) || !Number.isFinite(spendUsd)) return 0;
  return Math.floor((spendUsd / p) * 100 + 1e-7) / 100;
}

/** Dollars as the window prints them: $1,240.00 (in Ukrainian $1 240,00). Only for the eye: never a field's value. */
export function usd(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const sign = v < 0 ? '−' : '';
  return digits(`${sign}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
}

/** A profit or loss with its sign: +$324.50, −$12.00. */
export function signedUsd(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const cents = Math.round(v * 100) / 100;
  return cents > 0 ? `+${usd(cents)}` : cents < 0 ? usd(cents) : usd(0);
}

/** A change in percent with its sign: +24.3%. */
export function signedPct(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return '';
  const r = Math.round(v * 10) / 10;
  return digits(r > 0 ? `+${r.toFixed(1)}%` : r < 0 ? `−${Math.abs(r).toFixed(1)}%` : '0.0%');
}

/** A volume in dollars, short; a dash when the source gives none. */
export function volumeText(v: number | null): string {
  if (v === null) return '—';
  if (v >= 1e9) return digits(`$${(v / 1e9).toFixed(1)}B`);
  if (v >= 1e6) return digits(`$${(v / 1e6).toFixed(1)}M`);
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${Math.round(v)}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The time left until a market closes: 42m, 5h 12m, 3d 4h, 41d. */
export function closesIn(iso: string | null, nowMs: number = Date.now()): string {
  const w = wordsNow(PREDICT_TEXT);
  if (!iso) return w.noClose;
  const left = Date.parse(iso) - nowMs;
  if (!Number.isFinite(left)) return w.noClose;
  if (left <= 0) return w.closed;
  if (left < MINUTE) return w.underMinute;
  if (left < HOUR) return w.minutes(Math.floor(left / MINUTE));
  if (left < DAY) return w.hoursMinutes(Math.floor(left / HOUR), Math.floor((left % HOUR) / MINUTE));
  if (left < 7 * DAY) return w.daysHours(Math.floor(left / DAY), Math.floor((left % DAY) / HOUR));
  return w.days(Math.floor(left / DAY));
}

/** A read's time of day, as the city's top bar prints its own. */
export function clock(iso: string | number): string {
  const at = typeof iso === 'number' ? iso : Date.parse(iso);
  return Number.isFinite(at) ? dateText(at, { hour: '2-digit', minute: '2-digit' }) : '—';
}

/** The picture a card falls back to when the event has none (or the page may not load it): its first category's. */
export type Art = 'crypto' | 'politics' | 'sports' | 'world' | 'finance' | 'culture' | 'market';

export function artOf(market: Pick<Market, 'categories' | 'title'>): Art {
  for (const slug of market.categories) {
    const s = slug.toLowerCase();
    if (/crypto|bitcoin|ethereum|solana|defi/.test(s)) return 'crypto';
    if (/politic|election|government/.test(s)) return 'politics';
    if (/sport|soccer|football|nba|nfl|tennis|esport/.test(s)) return 'sports';
    if (/world|geopolit|global|international/.test(s)) return 'world';
    if (/financ|econom|fed|business|stock|rates/.test(s)) return 'finance';
    if (/entertain|culture|music|movie|mention|social|celebr|award/.test(s)) return 'culture';
  }
  if (/\b(bitcoin|btc|eth|ethereum|sol|solana|crypto|token|etf)\b/i.test(market.title)) return 'crypto';
  // Politics before sports: «Which party will win the House?» is no match (a position row has the title only, 29.10).
  if (/\b(election|president|senate|house|congress|party|governor|parliament|minister|fed|ceasefire|war)\b/i.test(market.title)) return 'politics';
  if (/\b(vs\.?|match|cup|league|win the)\b/i.test(market.title)) return 'sports';
  return 'market';
}

/**
 * The kicker over a market's title: its first category the window names as a tab, in the language on screen and in
 * capitals. A category the window has no tab for (the source's own, often a race's tag — «US presidential election»
 * on a House race, 29.10) is no kicker: the title says it better.
 */
export function kickerOf(market: Pick<Market, 'categories'>, tabs: readonly Tab[]): string | null {
  for (const slug of market.categories) {
    const named = tabs.find((t) => t.category === slug);
    if (named) return tabName(named).toUpperCase();
  }
  return null;
}
