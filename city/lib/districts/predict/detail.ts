import { venueName, type Market, type Side } from './markets.ts';

/**
 * One market's page as the window shows it, from the event the engine reads (`/api/predictions/events/<id>`): the
 * question with its live sides, and behind «Details» what resolves it — the venue's own rules, its description and
 * where the venues differ, verbatim. A settled or closed market keeps its page; nothing is bought on it.
 *
 * An event of several markets — the Fed's brackets, a party per seat, a date per deadline — lists every one of them
 * as a row with its own chance and its own Yes and No (CITY-77): the page shows the row picked, and the ticket buys it.
 */

/** One market of an event as a row of its page. */
export type Row = Readonly<{
  marketId: string;
  /** What the row asks: the market's own question, or the event's title when it has one market. */
  label: string;
  image: string | null;
  sides: readonly Side[];
  binary: boolean;
  volume: number | null;
  closes: string | null;
  status: string;
  rules: string | null;
  description: string | null;
  /** The same outcome on the other venues the engine matched, Yes first: where its history may be read too. */
  matched: readonly string[];
}>;

export type Detail = Market &
  Readonly<{
    status: string;
    /** The venue's own resolution rules, verbatim; null when it gives none. */
    rules: string | null;
    description: string | null;
    /** What the matched venues agree resolves it, as the engine states it. */
    settlement: string | null;
    /** Every market of the event, cut down to what settles a practice buy. */
    settle: readonly SettleMarket[];
    /** Every priced market of the event, the likeliest first; one row for a market of its own. */
    rows: readonly Row[];
    /** The other venues' outcomes of the head side of the market shown. */
    matched: readonly string[];
    /** The event's own description and close, for a row that states none of its own. */
    eventDescription: string | null;
    eventCloses: string | null;
  }>;

/** One market as the settlement reads it: its status and which outcome the venue named the winner. */
export type SettleMarket = Readonly<{ id: string; status: string; outcomes: readonly Readonly<{ id: string; winner: boolean | null }>[] }>;

type RawOutcome = { id?: unknown; label?: unknown; probability?: unknown; winner?: unknown; matched?: unknown };
type RawMarket = { id?: unknown; status?: unknown; question?: unknown; outcomes?: unknown; volume?: unknown; endDate?: unknown; description?: unknown; rules?: unknown; venue?: unknown; image?: unknown };

const text = (v: unknown, max = 4000): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const priced = (p: unknown): p is number => typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1;
const IMAGE = /^https:\/\/[^\s"'<>]+$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** Rows a page lists at most. */
export const ROWS_MAX = 24;

/** Every market of an event, cut down to its status and the outcomes the venue named. */
export function readSettle(json: unknown): Readonly<{ id: string; markets: readonly SettleMarket[] }> | null {
  const event = (json as { event?: unknown } | null)?.event as { id?: unknown; markets?: unknown } | undefined;
  if (!event || typeof event.id !== 'string' || !Array.isArray(event.markets)) return null;
  const markets: SettleMarket[] = [];
  for (const m of event.markets as RawMarket[]) {
    if (!m || typeof m.id !== 'string' || !Array.isArray(m.outcomes)) continue;
    markets.push({
      id: m.id,
      status: typeof m.status === 'string' ? m.status : 'unknown',
      outcomes: (m.outcomes as RawOutcome[]).filter((o) => !!o && typeof o.id === 'string').map((o) => ({ id: o.id as string, winner: typeof o.winner === 'boolean' ? o.winner : null })),
    });
  }
  return { id: event.id, markets };
}

function order(sides: readonly Side[]): Readonly<{ sides: readonly Side[]; binary: boolean }> {
  const yes = sides.find((s) => /^yes$/i.test(s.label));
  const no = sides.find((s) => /^no$/i.test(s.label));
  const binary = Boolean(yes && no && sides.length === 2);
  return { binary, sides: binary ? [yes!, no!] : [...sides].sort((a, b) => b.p - a.p || (a.label < b.label ? -1 : 1)).slice(0, 6) };
}

const headP = (row: Pick<Row, 'sides' | 'binary'>) => (row.binary ? row.sides[0]!.p : Math.max(...row.sides.map((s) => s.p)));

/**
 * The page of one event: the market the card priced when it is still there, else the event's first market with two
 * priced sides. Its sides are the venue's live midpoints; a side the venue leaves unpriced keeps the card's last read.
 * Null for an answer of another shape.
 */
export function readDetail(json: unknown, card: Market | null = null): Detail | null {
  const settle = readSettle(json);
  if (!settle) return null;
  const event = (json as { event: Record<string, unknown> }).event;
  const markets = (event.markets as RawMarket[]).filter((m) => !!m && typeof m.id === 'string' && Array.isArray(m.outcomes));
  const sidesOf = (m: RawMarket): Side[] =>
    (m.outcomes as RawOutcome[])
      .filter((o) => !!o && typeof o.id === 'string' && typeof o.label === 'string' && o.label.trim())
      .map((o) => {
        const was = card?.sides.find((s) => s.id === o.id);
        const p = priced(o.probability) ? o.probability : (was?.p ?? NaN);
        return { id: o.id as string, label: (o.label as string).trim(), p };
      })
      .filter((s) => Number.isFinite(s.p));
  const title = text(event.title, 300) ?? card?.title ?? '';
  const many = markets.length > 1;
  const rowOf = (m: RawMarket): Row | null => {
    let sides = sidesOf(m);
    if (sides.length < 2 && card && card.marketId === m.id) sides = [...card.sides];
    if (sides.length < 2) return null;
    const ordered = order(sides);
    const rules = (m.rules ?? null) as { primary?: unknown; secondary?: unknown } | null;
    const head = ordered.binary ? ordered.sides[0]! : ordered.sides.reduce((a, b) => (b.p > a.p ? b : a));
    const raw = (m.outcomes as RawOutcome[]).find((o) => o?.id === head.id);
    const matched = Array.isArray(raw?.matched)
      ? (raw.matched as { outcomeId?: unknown }[]).map((x) => x?.outcomeId).filter((id): id is string => typeof id === 'string' && ID.test(id))
      : [];
    return {
      marketId: m.id as string,
      label: (many && text(m.question, 300)) || title,
      image: typeof m.image === 'string' && IMAGE.test(m.image) ? m.image : null,
      sides: ordered.sides,
      binary: ordered.binary,
      volume: typeof m.volume === 'number' && Number.isFinite(m.volume) && m.volume >= 0 ? m.volume : null,
      closes: text(m.endDate, 64) ?? text(event.endDate, 64),
      status: typeof m.status === 'string' ? m.status : 'unknown',
      rules: [text(rules?.primary), text(rules?.secondary)].filter(Boolean).join('\n\n') || null,
      description: text(m.description),
      matched: [...new Set(matched)].slice(0, 4),
    };
  };
  const rows: Row[] = [];
  for (const m of markets) {
    const row = rowOf(m);
    if (row) rows.push(row);
  }
  if (!rows.length) return null;
  // The open ones first, the likeliest first; a market the card priced stays reachable however far down it sits.
  const open = (r: Row) => (r.status === 'open' ? 0 : 1);
  rows.sort((a, b) => open(a) - open(b) || headP(b) - headP(a));
  const listed = rows.slice(0, ROWS_MAX);
  const chosen = (card && rows.find((r) => r.marketId === card.marketId)) ?? rows[0]!;
  if (!listed.includes(chosen)) listed.push(chosen);
  const venues = Array.isArray(event.venues) ? (event.venues as unknown[]).filter((v): v is string => typeof v === 'string').map(venueName) : (card?.venues ?? []);
  const categories = Array.isArray(event.categories)
    ? (event.categories as { slug?: unknown }[]).map((c) => c?.slug).filter((s): s is string => typeof s === 'string' && s.length > 0)
    : (card?.categories ?? []);
  const shared = ((event.settlement ?? null) as { sharedSummary?: unknown } | null)?.sharedSummary;
  const image = [event.image, card?.image].find((v): v is string => typeof v === 'string' && IMAGE.test(v)) ?? chosen.image;
  const volume = typeof event.volume === 'number' && Number.isFinite(event.volume) && event.volume >= 0 ? event.volume : (card?.volume ?? null);
  const event0: EventPart = {
    eventId: settle.id,
    title,
    image,
    volume,
    venues: venues.length ? venues : (card?.venues ?? []),
    categories,
    marketCount: rows.length,
    settlement: text(shared),
    settle: settle.markets,
    rows: listed,
    eventDescription: text(event.description),
    eventCloses: text(event.endDate, 64) ?? card?.closes ?? null,
  };
  return withRow(event0, chosen);
}

/** What a page holds of its event, whichever row it shows. */
type EventPart = Omit<Detail, 'marketId' | 'question' | 'sides' | 'binary' | 'closes' | 'status' | 'rules' | 'description' | 'matched'>;

function withRow(event: EventPart, row: Row): Detail {
  return {
    ...event,
    marketId: row.marketId,
    question: row.label !== event.title ? row.label : null,
    sides: row.sides,
    binary: row.binary,
    closes: row.closes ?? event.eventCloses,
    status: row.status,
    rules: row.rules,
    description: row.description ?? event.eventDescription,
    matched: row.matched,
  };
}

/** The page on another of its rows: the same event, the row picked; the page as it was for a row it does not have. */
export function pickRow(detail: Detail, marketId: string): Detail {
  if (detail.marketId === marketId) return detail;
  const row = detail.rows.find((r) => r.marketId === marketId);
  return row ? withRow(detail, row) : detail;
}

/** Whether a page's market takes a buy now: open and before its close. */
export function tradable(detail: Pick<Detail, 'status' | 'closes'>, nowMs: number = Date.now()): boolean {
  if (detail.status !== 'open') return false;
  if (!detail.closes) return true;
  const end = Date.parse(detail.closes);
  return Number.isFinite(end) && end > nowMs;
}
