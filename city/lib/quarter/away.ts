import { digits as digitsOf, wordsNow } from '../i18n/dict.ts';
import { frontAzimuth, orbit, type Pose } from './camera.ts';
import { lotOf, streetName } from './plot.ts';
import type { AwayBeat, AwayReport, Cell, MeResponse } from './types.ts';
import { AWAY_WORDS } from './words.ts';

/**
 * «While you were away», as the city plays it: twenty seconds over what changed, one line at a time, the camera
 * over each. The world's report (`/api/world/away`) gives the lines about my quarter, the engine objects my
 * buildings show, my district and the city; the market adds my coins and the towers that grow, from the city's own
 * live read. Every line says where it came from and when; nothing here counts money, and a figure appears only as
 * its source gave it. Pure, so it can be tested without a browser.
 */

/** Where the camera looks for a line. */
export type Focus =
  | { kind: 'quarter'; cell: Cell }
  | { kind: 'tower'; mint: string }
  | { kind: 'street'; z: number }
  | { kind: 'city' };

export type Line = {
  id: string;
  /** Whose news it is: mine (my quarter, my coins) or around me (the district, the city). */
  tone: 'mine' | 'around';
  text: string;
  /** A second, smaller fact, or null. */
  sub: string | null;
  /** Who said it: the world, the engine, the market feed or Jupiter. */
  source: string;
  /** When it happened at the source (ISO). */
  at: string;
  focus: Focus;
  /** How long the line holds the screen. */
  ms: number;
};

/** A tower as the reel needs it: the city's live read gives the rest. */
export type MarketTower = { id: string; symbol: string; verified: boolean; /** In percent, as Jupiter gives it. */ change24h: number; liquidity: number };
export type Market = { towers: readonly MarketTower[]; fetchedAt: string; source: 'live' | 'snapshot' };

/** The whole reel, and how long a line may be on screen. */
export const REEL_MS = 20_000;
export const LINE_MIN_MS = 2_800;
export const LINE_MAX_MS = 5_000;
export const MAX_LINES = 6;
/** A coin of mine is news when it moved at least this much over the day, in percent. */
export const MOVE_MIN = 2;
/** A riser is shown only with enough liquidity behind its move, in USD. */
export const RISER_LIQUIDITY = 50_000;
/** Back after less than this, there is nothing to tell. */
export const AWAY_MIN_MS = 20 * 60_000;

const w = () => wordsNow(AWAY_WORDS);

/** Who said a line, in the language on screen when the reel is made (`./words.ts`). */
export const SOURCE_LABEL: Readonly<Record<'world' | 'engine' | 'market' | 'jupiter', string>> = {
  get world() {
    return w().sourceWorld;
  },
  get engine() {
    return w().sourceEngine;
  },
  get market() {
    return w().sourceMarket;
  },
  get jupiter() {
    return w().sourceJupiter;
  },
};

/** A fraction (0.184) as a signed percent, as the market says it: +18.4%, −3.0%. A world event's `change` is a fraction. */
export function percent(fraction: number): string {
  const v = fraction * 100;
  const places = Math.abs(v) >= 100 ? 0 : 1;
  return digitsOf(`${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(places)}%`);
}

/** «just now», «5 min ago», «3 h ago», «2 days ago». */
export function ago(at: string, now: number): string {
  const x = w();
  const s = Math.max(0, (now - Date.parse(at)) / 1000);
  if (!Number.isFinite(s) || s < 60) return x.justNow;
  if (s < 3600) return x.minutesAgo(Math.floor(s / 60));
  if (s < 86_400) return x.hoursAgo(Math.floor(s / 3600));
  const d = Math.floor(s / 86_400);
  return d === 1 ? x.yesterday : x.daysAgo(d);
}

/** «Away 3 h», for the header. */
export function awayFor(since: string, until: string): string {
  const s = Math.max(0, (Date.parse(until) - Date.parse(since)) / 1000);
  const x = w();
  if (!Number.isFinite(s) || s < 3600) return x.forMinutes(Math.max(1, Math.floor(s / 60) || 1));
  if (s < 86_400) return x.forHours(Math.floor(s / 3600));
  return x.forDays(Math.floor(s / 86_400));
}

/** A coin's ticker as people write it: $WIF, whether or not the symbol carries its own «$». */
export const ticker = (symbol: string) => (symbol.startsWith('$') ? symbol : `$${symbol}`);
const symbolOf = (towers: readonly MarketTower[], mint: string) => {
  const t = towers.find((x) => x.id === mint);
  return t && t.verified ? ticker(t.symbol) : null;
};
const streetIndex = (street: string | null): number | null => {
  const n = street ? /-(\d+)$/.exec(street)?.[1] : undefined;
  return n ? Number(n) - 1 : null;
};
const change = (beat: AwayBeat): string | null => (typeof beat.detail.change === 'number' && Number.isFinite(beat.detail.change) ? percent(beat.detail.change) : null);

/** One line of the world's report, in words, with where the camera looks. */
export function lineOfBeat(beat: AwayBeat, me: MeResponse, market: Market | null): Omit<Line, 'ms'> {
  const towers = market?.towers ?? [];
  const home: Focus = { kind: 'quarter', cell: me.quarter.cell };
  const source = SOURCE_LABEL[beat.source];
  const base = { id: beat.id, source, at: beat.at };
  const tower = (mint: string): Focus => (towers.some((t) => t.id === mint) ? { kind: 'tower', mint } : { kind: 'city' });
  const x = w();
  const verb = x.verb(beat.kind);
  const times = beat.count > 1 ? x.times(beat.count) : null;

  if (beat.about === 'quarter') {
    const q = me.quarters.find((x) => x.id === beat.subject) ?? me.quarter;
    const focus: Focus = { kind: 'quarter', cell: q.cell };
    if (beat.kind === 'visit') {
      const verified = typeof beat.detail.verified === 'number' ? beat.detail.verified : 0;
      return {
        ...base,
        tone: 'mine',
        text: beat.count === 1 ? x.someoneCame : x.visitorsCame(beat.count),
        sub: verified > 0 ? x.signedIn(verified) : null,
        focus,
      };
    }
    return { ...base, tone: 'mine', text: x.quarterDid(verb), sub: times, focus };
  }

  if (beat.about === 'object') {
    const kind = typeof beat.detail.linkKind === 'string' ? beat.detail.linkKind : 'mint';
    const name = (kind === 'mint' ? symbolOf(towers, beat.subject) : null) ?? (x.mine(kind) || x.yourBuilding);
    const figure = change(beat);
    return {
      ...base,
      tone: 'mine',
      text: x.did(name, verb),
      sub: [figure, times].filter(Boolean).join(' · ') || null,
      focus: kind === 'mint' ? tower(beat.subject) : home,
    };
  }

  if (beat.about === 'district') {
    // The terrace is drawn as far south as my own street: a street past it is shown by mine.
    const index = streetIndex(beat.street);
    const z = index === null ? null : Math.min(index, Math.max(0, Math.floor(me.quarter.cell.z) || 0));
    const where = beat.street ? streetName(beat.street) : x.yourDistrict;
    const focus: Focus = z === null ? home : { kind: 'street', z };
    if (beat.kind === 'claim') return { ...base, tone: 'around', text: beat.count === 1 ? x.newcomer(where) : x.newcomers(beat.count, where), sub: null, focus };
    if (beat.kind === 'build') return { ...base, tone: 'around', text: beat.count === 1 ? x.neighbour(where) : x.neighbours(beat.count, where), sub: null, focus };
    return { ...base, tone: 'around', text: `${where}: ${beat.kind}`, sub: times, focus };
  }

  const name = symbolOf(towers, beat.subject) ?? x.aCoin;
  return {
    ...base,
    tone: 'around',
    text: x.did(name, verb),
    sub: [change(beat), beat.count > 1 ? x.moments(beat.count) : null].filter(Boolean).join(' · ') || null,
    focus: tower(beat.subject),
  };
}

/**
 * The market's lines, from the city's live read: my coins (the ones my buildings show and the ones my wallet holds)
 * that moved over the day, and the towers rising most. A bundled snapshot is not news, so it gives none. The window
 * is the read's own, 24 hours, and the line says so.
 */
export function marketLines(input: { market: Market | null; mine: ReadonlySet<string>; covered: ReadonlySet<string> }): Omit<Line, 'ms'>[] {
  const { market } = input;
  if (!market || market.source !== 'live') return [];
  const base = { source: SOURCE_LABEL.jupiter, at: market.fetchedAt };
  const lines: Omit<Line, 'ms'>[] = [];
  const x = w();
  const named = market.towers.filter((t) => t.verified && Number.isFinite(t.change24h));
  const mine = named
    .filter((t) => input.mine.has(t.id) && !input.covered.has(t.id) && Math.abs(t.change24h) >= MOVE_MIN)
    .sort((a, b) => Math.abs(b.change24h) - Math.abs(a.change24h))
    .slice(0, 2);
  for (const t of mine) {
    lines.push({ ...base, id: `mine:${t.id}`, tone: 'mine', text: x.coinMoved(ticker(t.symbol), t.change24h >= 0, percent(t.change24h / 100)), sub: x.over24h, focus: { kind: 'tower', mint: t.id } });
  }
  const risers = named
    .filter((t) => t.change24h > 0 && t.liquidity >= RISER_LIQUIDITY && !input.mine.has(t.id))
    .sort((a, b) => b.change24h - a.change24h)
    .slice(0, 2);
  if (risers.length) {
    const [top, next] = risers;
    lines.push({
      ...base,
      id: `rising:${top!.id}`,
      tone: 'around',
      text: x.rising(ticker(top!.symbol), percent(top!.change24h / 100)),
      sub: next ? x.then(ticker(next.symbol), percent(next.change24h / 100)) : x.over24h,
      focus: { kind: 'tower', mint: top!.id },
    });
  }
  return lines;
}

/** The mints that are mine: the coins my buildings show and the ones my wallet holds. */
export function myMints(me: MeResponse, held: ReadonlySet<string>): Set<string> {
  const out = new Set(held);
  for (const b of me.buildings) if (b.link?.kind === 'mint') out.add(b.link.mint);
  return out;
}

/**
 * The reel: mine first (my quarter, my objects, my coins), then around me (my street, the risers, the city), at most
 * six lines sharing twenty seconds.
 */
export function reelOf(input: { report: AwayReport; me: MeResponse; market: Market | null; held: ReadonlySet<string> }): Line[] {
  const { report, me, market } = input;
  const beats = report.beats.map((b) => ({ beat: b, line: lineOfBeat(b, me, market) }));
  const covered = new Set(report.beats.filter((b) => b.about === 'object' || b.about === 'city').map((b) => b.subject));
  const fromMarket = marketLines({ market, mine: myMints(me, input.held), covered });
  const of = (about: AwayBeat['about']) => beats.filter((b) => b.beat.about === about).map((b) => b.line);
  const ordered = [
    ...of('quarter'),
    ...of('object'),
    ...fromMarket.filter((l) => l.tone === 'mine'),
    ...of('district'),
    ...fromMarket.filter((l) => l.tone === 'around'),
    ...of('city'),
  ].slice(0, MAX_LINES);
  const ms = ordered.length ? Math.round(Math.max(LINE_MIN_MS, Math.min(LINE_MAX_MS, REEL_MS / ordered.length))) : 0;
  return ordered.map((l) => ({ ...l, ms }));
}

/**
 * Whether to play: back after a real absence, or the first time this browser knows of. A resident who only just
 * moved in was never away.
 */
export function worthPlaying(lastSeen: string | null, now: number, residentSince: string | null = null): boolean {
  const born = residentSince ? Date.parse(residentSince) : Number.NaN;
  if (Number.isFinite(born) && now - born < AWAY_MIN_MS) return false;
  if (!lastSeen) return true;
  const t = Date.parse(lastSeen);
  return !Number.isFinite(t) || now - t >= AWAY_MIN_MS;
}

/**
 * Where «since» starts: the last moment this browser saw the city, or a day back when it does not know; never before
 * the resident moved in.
 */
export function sinceOf(lastSeen: string | null, now: number, residentSince: string | null = null): string {
  const t = lastSeen ? Date.parse(lastSeen) : Number.NaN;
  const from = Number.isFinite(t) && t < now ? t : now - 86_400_000;
  const born = residentSince ? Date.parse(residentSince) : Number.NaN;
  return new Date(Number.isFinite(born) && born < now ? Math.max(from, born) : from).toISOString();
}

/* ---------------------------------------------------------------- camera -- */

export type PlacedLike = { tower: { id: string }; x: number; z: number; height: number };

/** The city's establishing shots, as the city's own camera keeps them. */
const CITY: Record<'landscape' | 'portrait', Pose> = {
  landscape: { position: { x: 0, y: 38, z: 172 }, target: { x: 0, y: 25, z: 0 } },
  portrait: { position: { x: 0, y: 20, z: 128 }, target: { x: 0, y: 31, z: 0 } },
};

/** Where the camera stands for a line: over the quarter, beside the tower looking in, high over the street, or the skyline. */
export function poseOf(focus: Focus, towers: readonly PlacedLike[], portrait: boolean): Pose {
  if (focus.kind === 'quarter') {
    const lot = lotOf(focus.cell);
    const target = { x: lot.x, y: 0, z: lot.z };
    return { position: orbit(target, { azimuth: frontAzimuth(lot.facing) + 0.35, pitch: 0.72, distance: portrait ? 44 : 36 }), target };
  }
  if (focus.kind === 'street') {
    const lot = lotOf({ x: 0, z: focus.z });
    const target = { x: 0, y: 0, z: lot.z };
    return { position: orbit(target, { azimuth: 0.25, pitch: 0.82, distance: portrait ? 86 : 70 }), target };
  }
  if (focus.kind === 'tower') {
    const t = towers.find((p) => p.tower.id === focus.mint);
    if (t) {
      const r = Math.hypot(t.x, t.z);
      // From outside the island looking in, so the tower stands against the skyline.
      const dx = r < 1 ? 0 : t.x / r;
      const dz = r < 1 ? 1 : t.z / r;
      // Back and high enough to look down past its neighbours' roofs onto its crown, the skyline behind it.
      const distance = Math.max(44, t.height * 1.1 + 30) * (portrait ? 1.3 : 1);
      const target = { x: t.x, y: t.height * 0.7, z: t.z };
      return { position: { x: t.x + dx * distance, y: t.height + distance * 0.62, z: t.z + dz * distance }, target };
    }
  }
  return CITY[portrait ? 'portrait' : 'landscape'];
}
