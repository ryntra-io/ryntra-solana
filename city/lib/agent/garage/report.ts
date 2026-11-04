import type { Tower } from '../../market/types.ts';
import type { MyTower } from './mine.ts';
import type { Topic } from './settings.ts';

/**
 * The garage agent's report (CITY-29): what changed on your towers since you last looked. Every line is the city's own
 * read against the read it kept when you last looked — a price and a liquidity with the moment they were read. A figure
 * the source did not measure is never compared, and an old or saved read reports nothing: the agent waits for live
 * prices rather than tell a change that did not happen.
 */

/** What the agent kept of a tower when you last looked. */
export type Mark = Readonly<{ price: number; liquidity: number; at: number }>;
export type Marks = Readonly<Record<string, Mark>>;

export type ChangeKind = 'up' | 'down' | 'deeper' | 'thinner';

export type Change = Readonly<{
  tower: Tower;
  kind: ChangeKind;
  /** The figure as the window prints it: «+6.2%». */
  value: string;
  /** Since the kept read, or the day's move when there is no kept read for this tower yet. */
  window: 'since' | '24H';
  /** How big, to rank by: the move in percent, unsigned. */
  size: number;
}>;

export type Report =
  | Readonly<{ status: 'waiting' }>
  | Readonly<{ status: 'ready'; since: number | null; changes: readonly Change[]; watched: number }>;

/** A price move this big since the kept read is worth a line. */
export const MOVE_MIN = 3;
/** Without a kept read: the day's move must be at least this. */
export const DAY_MOVE_MIN = 5;
/** Liquidity that grew or shrank by this share. */
export const LIQUIDITY_MIN = 0.2;
/** Lines in one report. */
export const REPORT_MAX = 5;
/** A kept read older than this is forgotten: a week-old price says nothing about «since you looked». */
export const MARK_MS = 7 * 24 * 60 * 60 * 1000;

const measuredFigure = (t: Tower, f: 'price' | 'liquidity' | 'change24h') => !t.unread?.includes(f) && Number.isFinite(t[f]);

export const signedPct = (v: number): string => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;

/** The marks to keep after a look: each of your towers as the city reads it now, measured figures only. */
export function markAll(mine: readonly MyTower[], now: number, before: Marks = {}): Marks {
  const out: Record<string, Mark> = {};
  for (const [mint, mark] of Object.entries(before)) if (now - mark.at < MARK_MS) out[mint] = mark;
  for (const { tower } of mine) {
    if (!measuredFigure(tower, 'price') || !(tower.price > 0)) continue;
    out[tower.id] = { price: tower.price, liquidity: measuredFigure(tower, 'liquidity') ? tower.liquidity : NaN, at: now };
  }
  return out;
}

/** Marks read back from storage: only finite, positive prices; anything else is dropped. */
export function readMarks(raw: unknown, now: number): Marks {
  const out: Record<string, Mark> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [mint, m] of Object.entries(raw as Record<string, unknown>)) {
    const r = m as Partial<Mark> | null;
    if (!r || typeof r.price !== 'number' || !(r.price > 0) || typeof r.at !== 'number' || r.at > now || now - r.at >= MARK_MS) continue;
    out[mint] = { price: r.price, liquidity: typeof r.liquidity === 'number' ? r.liquidity : NaN, at: r.at };
  }
  return out;
}

/** The changes on one tower, by the topics the person asked for. */
function changesOf(tower: Tower, mark: Mark | undefined, topics: Readonly<Record<Topic, boolean>>): Change[] {
  const out: Change[] = [];
  if (topics.moves) {
    if (mark && measuredFigure(tower, 'price') && tower.price > 0) {
      const move = (tower.price / mark.price - 1) * 100;
      if (Math.abs(move) >= MOVE_MIN) out.push({ tower, kind: move > 0 ? 'up' : 'down', value: signedPct(move), window: 'since', size: Math.abs(move) });
    } else if (!mark && measuredFigure(tower, 'change24h') && Math.abs(tower.change24h) >= DAY_MOVE_MIN) {
      out.push({ tower, kind: tower.change24h > 0 ? 'up' : 'down', value: signedPct(tower.change24h), window: '24H', size: Math.abs(tower.change24h) });
    }
  }
  if (topics.liquidity && mark && Number.isFinite(mark.liquidity) && mark.liquidity > 0 && measuredFigure(tower, 'liquidity')) {
    const share = tower.liquidity / mark.liquidity - 1;
    if (Math.abs(share) >= LIQUIDITY_MIN) out.push({ tower, kind: share > 0 ? 'deeper' : 'thinner', value: signedPct(share * 100), window: 'since', size: Math.abs(share * 100) });
  }
  return out;
}

/**
 * The report on your towers. `live` is the city's read being a live, fresh one; without it there is no report. The
 * biggest changes first, at most a few; `since` is the oldest kept read the report compares with.
 */
export function report(input: Readonly<{ mine: readonly MyTower[]; marks: Marks; live: boolean; topics: Readonly<Record<Topic, boolean>> }>): Report {
  const { mine, marks, live, topics } = input;
  if (!live) return { status: 'waiting' };
  const changes = mine.flatMap(({ tower }) => changesOf(tower, marks[tower.id], topics));
  // One line per tower: its biggest change.
  const best = new Map<string, Change>();
  for (const c of changes) if (!best.has(c.tower.id) || best.get(c.tower.id)!.size < c.size) best.set(c.tower.id, c);
  const ranked = [...best.values()].sort((a, b) => b.size - a.size || a.tower.id.localeCompare(b.tower.id)).slice(0, REPORT_MAX);
  const ats = ranked.filter((c) => c.window === 'since').map((c) => marks[c.tower.id]!.at);
  return { status: 'ready', since: ats.length ? Math.min(...ats) : null, changes: ranked, watched: mine.length };
}
