import type { CityEvent, FxKind } from '../city/store.ts';
import { BRAND } from '../brand.ts';
import { isNamed, type District, type Tower } from '../market/types.ts';
import type { RunForm } from '../run/course.ts';
import type { Facts } from '../x/facts.ts';
import { dateText, digits, wordsNow } from '../i18n/dict.ts';
import { langNow } from '../i18n/lang.ts';
import { MOMENTS, retellMoment } from './words.ts';

/**
 * A moment worth a clip: a launch, a coin graduating from its curve into a pool, a coin surviving day 7, 30 or
 * 90, a record run, a district winning the week. Hype only through things that really happened: each moment
 * names its real figure with its window, where it comes from and when it happened there. A moment without a source
 * time is never made, and a coin the city has not verified is never named, in the clip, the card or the words.
 */

export type MomentKind = 'launch' | 'graduate' | 'survival' | 'record' | 'war' | 'bigx' | 'agent' | 'studio';
export type Accent = 'mint' | 'amber' | 'flare' | 'violet';
export type SurvivalDay = 7 | 30 | 90;

export type Moment = {
  /** Stable for the same happening, so a list never shows it twice. */
  id: string;
  kind: MomentKind;
  /** The tower the camera flies to; null for a run, whose own footage is the picture. */
  towerId: string | null;
  district: District | null;
  /** "$BONK" when the city may name the coin, else null. */
  symbol: string | null;
  kicker: string;
  title: string;
  /** The real figure with its type or window: "PAST $75K · NOW A DAMM V2 POOL", "39.9 S · OCT 26 COURSE". */
  figure: string;
  /** Where the fact comes from, said on the clip and the card. */
  source: string;
  /** When it happened at the source (ISO). */
  sourceAt: string;
  /** How the city stages it: fireworks, a flare, or a tower growing from the ground. */
  fx: FxKind;
  accent: Accent;
  run: { time: number; form: RunForm; day: string; newBest: boolean; course: string } | null;
  /** A post of the studio for X (CITY-38, `../x/`): its facts, from which the server writes the words. */
  studio?: Facts;
};

/** A world event as the world contract describes it (`docs/city/WORLD-CONTRACT.md`), read defensively. */
export type WorldEventLike = {
  id: string;
  at: string;
  source: 'market' | 'engine' | 'world';
  kind: string;
  /** A mint, a quarter or a crew; for a war, the district. */
  subject: string;
  sourceAt: string;
  payload: Record<string, unknown>;
};

export const DISTRICT_NAMES: Record<District, string> = {
  core: 'Sol Core',
  heights: 'DeFi Heights',
  strip: 'Meme Strip',
  avenue: 'Stock Avenue',
  docks: 'Launch Docks',
};

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "OCT 26" for a YYYY-MM-DD day. */
export function dayLabel(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  return m && d ? `${MONTHS[m - 1]} ${d}` : day;
}

/** "OCT 26 · 14:02 UTC" for a moment's source time. */
export function sourceTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const hh = String(at.getUTCHours()).padStart(2, '0');
  const mm = String(at.getUTCMinutes()).padStart(2, '0');
  return `${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()} · ${hh}:${mm} UTC`;
}

/** A moment's source time as the city's list shows it, in the language on screen («26 жовт. · 14:02 UTC»). */
export function sourceTimeShown(iso: string): string {
  const lang = langNow();
  if (lang === 'en') return sourceTime(iso);
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const day = dateText(at, { day: 'numeric', month: 'short', timeZone: 'UTC' }, lang);
  const clock = dateText(at, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }, lang);
  return `${day} · ${clock} UTC`;
}

/**
 * A moment's kicker, title and figure as the city shows them, in the language on screen. The moment itself keeps them
 * in English: the clip and the card for X carry them so.
 */
export function momentShown(m: Pick<Moment, 'kicker' | 'title' | 'figure'>): { kicker: string; title: string; figure: string } {
  const lang = langNow();
  return { kicker: retellMoment(m.kicker, lang), title: retellMoment(m.title, lang), figure: retellMoment(m.figure, lang) };
}

export function money(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function compact(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e4) return `${(v / 1e3).toFixed(0)}K`;
  return Math.round(v).toLocaleString('en-US');
}

const ticker = (s: string) => `$${s.replace(/^\$/, '').toUpperCase()}`;

/** The coin's ticker, only when the city has verified the coin. */
export function nameOf(tower: Tower | undefined): string | null {
  return tower && isNamed(tower) && tower.symbol ? ticker(tower.symbol) : null;
}

const validTime = (iso: unknown): iso is string => typeof iso === 'string' && !Number.isNaN(Date.parse(iso));
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The city's own market moments: today only a new pool in the docks counts (pumps and flares are weather, not feats). */
export function momentFromCityEvent(e: CityEvent, towers: readonly Tower[]): Moment | null {
  if (e.kind !== 'launch') return null;
  const tower = towers.find((t) => t.id === e.towerId);
  // The source time of a new pool is when the pool was made, not when the city noticed it.
  if (!tower || !validTime(tower.launchedAt)) return null;
  const name = nameOf(tower);
  return {
    id: `launch:${tower.id}`,
    kind: 'launch',
    towerId: tower.id,
    district: tower.district,
    symbol: name,
    kicker: 'LAUNCH DOCKS',
    title: name ?? 'NEW TOWER',
    figure: name ? `NEW POOL · ${money(tower.mcap)} CAP` : 'UNVERIFIED · NEW POOL',
    source: 'Jupiter',
    sourceAt: new Date(tower.launchedAt).toISOString(),
    fx: 'launch',
    accent: 'mint',
    run: null,
  };
}

/** The district a war's subject names: a market district, or a world district mapped to the skyline it stands by. */
function warDistrict(subject: unknown): District | null {
  if (typeof subject !== 'string') return null;
  const s = subject.toLowerCase();
  if (s in DISTRICT_NAMES) return s as District;
  const world: Record<string, District> = { downtown: 'core', arrivals: 'strip', harbor: 'heights' };
  return world[s] ?? null;
}

/**
 * Moments from the engine and the world (the event bus of the world contract): a Ryntra launch, its graduation at
 * $75K into a DAMM v2 pool, its day 7 / 30 / 90 checks, a district war. Payload fields read, all optional:
 * `day` (7, 30 or 90), `holders`, `actions` (verified actions in a war), `district`.
 */
export function momentFromWorldEvent(e: WorldEventLike, towers: readonly Tower[]): Moment | null {
  if (!validTime(e.sourceAt)) return null;
  const sourceAt = new Date(e.sourceAt).toISOString();
  const payload = e.payload ?? {};
  if (e.kind === 'war') {
    const district = warDistrict(payload.district ?? e.subject);
    if (!district) return null;
    const actions = num(payload.actions);
    const leader = towers
      .filter((t) => t.district === district && isNamed(t))
      .sort((a, b) => b.mcap - a.mcap)[0];
    return {
      id: `war:${district}:${sourceAt}`,
      kind: 'war',
      towerId: leader?.id ?? null,
      district,
      symbol: null,
      kicker: 'DISTRICT WAR',
      title: DISTRICT_NAMES[district].toUpperCase(),
      figure: actions !== null && actions > 0 ? `WON THE WEEK · ${compact(actions)} VERIFIED ACTIONS` : 'WON THE WEEK',
      source: 'Ryntra City',
      sourceAt,
      fx: 'pump',
      accent: 'violet',
      run: null,
    };
  }
  const tower = towers.find((t) => t.id === e.subject);
  if (!tower) return null;
  const name = nameOf(tower);
  const engine = e.source === 'engine';
  const base = { towerId: tower.id, district: tower.district, symbol: name, sourceAt, run: null };
  if (e.kind === 'launch') {
    return {
      ...base,
      id: `launch:${tower.id}`,
      kind: 'launch',
      kicker: engine ? 'RYNTRA LAUNCH' : 'LAUNCH DOCKS',
      title: name ?? 'NEW TOWER',
      figure: engine ? 'LAUNCHED ON RYNTRA · METEORA CURVE' : name ? 'NEW POOL' : 'UNVERIFIED · NEW POOL',
      source: engine ? 'Ryntra Launch' : 'Jupiter',
      fx: 'launch',
      accent: 'mint',
    };
  }
  // Graduations and survival checks exist only for Ryntra launches.
  if (!engine) return null;
  if (e.kind === 'graduate') {
    return {
      ...base,
      id: `graduate:${tower.id}`,
      kind: 'graduate',
      kicker: 'GRADUATED',
      title: name ?? 'A RYNTRA LAUNCH',
      figure: 'PAST $75K ON THE CURVE · NOW A DAMM V2 POOL',
      source: 'Ryntra Launch',
      fx: 'pump',
      accent: 'mint',
    };
  }
  if (e.kind === 'survival') {
    const day = num(payload.day);
    if (day !== 7 && day !== 30 && day !== 90) return null;
    const holders = num(payload.holders);
    return {
      ...base,
      id: `survival:${tower.id}:${day}`,
      kind: 'survival',
      kicker: `SURVIVED DAY ${day}`,
      title: name ?? 'A RYNTRA LAUNCH',
      figure: holders !== null && holders > 0 ? `${compact(holders)} HOLDERS · DAY ${day} CHECK` : `DAY ${day} CHECK · ON CHAIN`,
      source: 'Ryntra Launch',
      fx: 'pump',
      accent: 'amber',
    };
  }
  return null;
}

/** The smallest multiple the city calls a big x; below it a win is a good trade, not a moment. */
export const BIG_X = 5;

/** The windows a move or a multiple is counted over. */
export type MoveWindow = '5M' | '1H' | '24H' | '7D';

/**
 * A big x: a trade in the city that closed at `multiple` times its entry, read back from the chain. Only a coin the
 * city has verified, and never the trader: the wallet is nobody's business but theirs.
 */
export function momentFromBigX(x: { tower: Tower; multiple: number; sourceAt: string; tx: string }): Moment | null {
  const name = nameOf(x.tower);
  if (!name || !validTime(x.sourceAt) || !(x.multiple >= BIG_X && x.multiple < 100_000)) return null;
  const multiple = x.multiple >= 100 ? Math.round(x.multiple).toString() : x.multiple.toFixed(1);
  return {
    id: `bigx:${x.tx}`,
    kind: 'bigx',
    towerId: x.tower.id,
    district: x.tower.district,
    symbol: name,
    kicker: 'BIG X',
    title: name,
    figure: `${multiple}X · ENTRY TO EXIT · ON CHAIN`,
    source: 'Ryntra trade',
    sourceAt: new Date(x.sourceAt).toISOString(),
    fx: 'pump',
    accent: 'amber',
    run: null,
  };
}

/**
 * An agent's find: a scout of the city matched its rule on a tower — the move with its window, the rule in its own
 * short words. A find is a lead a person confirms, never a call to buy; an unverified coin is never named, so it is
 * never a find worth a post.
 */
export function momentFromAgentFind(f: { tower: Tower; agent: string; rule: string; change: number; window: MoveWindow; sourceAt: string }): Moment | null {
  const name = nameOf(f.tower);
  if (!name || !validTime(f.sourceAt) || !Number.isFinite(f.change)) return null;
  const rule = f.rule.trim().toUpperCase();
  const agent = f.agent.trim().toUpperCase();
  if (!rule || !agent) return null;
  const move = `${f.change >= 0 ? '+' : '−'}${Math.abs(f.change).toFixed(1)}% · ${f.window}`;
  return {
    id: `agent:${f.tower.id}:${new Date(f.sourceAt).toISOString()}`,
    kind: 'agent',
    towerId: f.tower.id,
    district: f.tower.district,
    symbol: name,
    kicker: `${agent} FOUND`,
    title: name,
    figure: `${move} · ${rule}`,
    source: 'Ryntra agents',
    sourceAt: new Date(f.sourceAt).toISOString(),
    fx: f.change >= 0 ? 'pump' : 'flare',
    accent: 'violet',
    run: null,
  };
}

/** A finished run. A record says so; any finish can still challenge a friend. */
export function momentFromRun(r: { time: number; newBest: boolean; form: RunForm; day: string; course: string; at?: Date }): Moment | null {
  if (!(r.time > 0 && r.time < 600)) return null;
  return {
    id: `run:${r.course}:${r.time}`,
    kind: 'record',
    towerId: null,
    district: null,
    symbol: null,
    kicker: r.newBest ? 'NEW RECORD' : 'SKYLINE RUN',
    title: `${r.time.toFixed(1)} S`,
    figure: `${dayLabel(r.day)} COURSE · ${r.form === 'flight' ? 'FLIGHT' : 'ROOFTOPS'}`,
    source: 'Skyline Run',
    sourceAt: (r.at ?? new Date()).toISOString(),
    fx: 'pump',
    accent: 'amber',
    run: { time: r.time, form: r.form, day: r.day, newBest: r.newBest, course: r.course },
  };
}

/**
 * The words that go with the clip or the card: plain facts, the figure's window, a link — never a promise. They are
 * the words a person sends from the share sheet, so they are written in the language on screen.
 */
export function momentText(m: Moment, link?: string): string {
  const w = wordsNow(MOMENTS);
  const coin = m.symbol ?? w.aRyntraLaunch;
  let line: string;
  switch (m.kind) {
    case 'launch':
      if (m.source === 'Ryntra Launch') line = w.launchedOnRyntra(m.symbol ?? w.aNewCoin);
      else line = m.symbol ? w.roseInDocks(m.symbol) : w.newTowerRose;
      break;
    case 'graduate':
      line = w.graduated(coin);
      break;
    case 'survival':
      line = w.survived(coin, m.kicker, Number(m.id.split(':').pop()));
      break;
    case 'record': {
      const time = digits(`${m.run?.time.toFixed(1)}`);
      line = m.run?.newBest ? w.newRecord(time) : w.runTime(time);
      if (link) return w.beatMyRun(line, link);
      break;
    }
    case 'war':
      line = w.wonWar(w[m.district ?? 'core']);
      break;
    case 'bigx':
      line = w.bigX(coin, digits(m.figure.split(' · ')[0]!.toLowerCase()));
      break;
    case 'agent':
      line = w.agentSpotted(coin, retellMoment(m.figure, langNow()).toLowerCase());
      break;
    case 'studio':
      // The queue writes a studio post's words from its facts (`../x/post.ts`); this is the share sheet's short line.
      line = `${m.kicker}: ${m.title} · ${m.figure}.`;
      break;
  }
  return `${line} ${link ?? BRAND.domain}`;
}

/** A file name a person recognises: brand, what, day. */
export function momentFileName(m: Moment, ext: 'mp4' | 'png'): string {
  const what = (m.symbol ?? (m.kind === 'record' ? 'run' : m.kind)).replace(/[^\p{L}\p{N}]+/gu, '').slice(0, 16).toLowerCase() || 'moment';
  return `ryntra-${m.kind}-${what}-${m.sourceAt.slice(0, 10)}.${ext}`;
}
