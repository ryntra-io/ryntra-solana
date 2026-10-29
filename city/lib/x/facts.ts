import { isNamed, type CitySnapshot, type District, type Tower } from '../market/types.ts';

/**
 * The facts of the studio's posts for X (CITY-38). Every number a clip or a card shows is picked here from a real read —
 * the city's market read (Jupiter, with the time it was read) or the Launch engine's flight log (the chain, with each
 * transaction) — and carries where it came from and when. Nothing here guesses, rounds a figure up, or names a coin the
 * city has not verified. A template with no fact worth saying returns null: no post.
 */

export type Template = 'hour' | 'justin' | 'launch' | 'billboard' | 'banner';
export const TEMPLATES: readonly Template[] = ['hour', 'justin', 'launch', 'billboard', 'banner'];

/** One number on a post and where it comes from: what it is, what it says, the source, when it was read there. */
export type Source = { what: string; value: string; source: string; readAt: string; ref: string | null };

export type HourFacts = {
  template: 'hour';
  mint: string;
  symbol: string;
  district: District;
  /** The price change over the last hour at the read, in percent. */
  change: number;
  mcap: number;
  readAt: string;
  live: boolean;
};

export type JustInFacts =
  | { template: 'justin'; metric: 'volume'; value: number; towers: number; readAt: string; live: boolean }
  | { template: 'justin'; metric: 'core'; mint: string; symbol: string; mcap: number; readAt: string; live: boolean };

export type LaunchFacts = {
  template: 'launch';
  mint: string;
  network: 'solana:devnet' | 'solana:mainnet';
  launchedAt: string;
  launchTx: string;
  graduatedAt: string;
  graduateTx: string;
  /** From the launch transaction to the graduation transaction, whole seconds. */
  seconds: number;
  readAt: string;
};

export type BillboardRow = { mint: string; symbol: string; value: number };
export type BillboardFacts = {
  template: 'billboard';
  /** `week`: the price change between two reads 6–8 days apart; `volume`: the 24h volume at one read, when no read a week old is kept. */
  ranking: 'week' | 'volume';
  from: string | null;
  readAt: string;
  rows: BillboardRow[];
  live: boolean;
};

export type BannerFacts = { template: 'banner'; towers: number; readAt: string; live: boolean };

export type Facts = HourFacts | JustInFacts | LaunchFacts | BillboardFacts | BannerFacts;

export const JUPITER = 'Jupiter Tokens API v2';
export const ENGINE = 'Ryntra Launch flight log';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** "OCT 26 · 11:31 UTC". */
export function readTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const hh = String(at.getUTCHours()).padStart(2, '0');
  const mm = String(at.getUTCMinutes()).padStart(2, '0');
  return `${MONTHS[at.getUTCMonth()]} ${at.getUTCDate()} · ${hh}:${mm} UTC`;
}

/** "$3.07B", "$46.7M", "$395K", "$740". */
export function usd(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${Math.round(v)}`;
}

/** "+10.3%", "−4.0%": one decimal, a real minus sign. */
export function pct(v: number): string {
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}%`;
}

const ticker = (s: string) => `$${s.replace(/^\$/, '').toUpperCase()}`;
const validTime = (iso: unknown): iso is string => typeof iso === 'string' && !Number.isNaN(Date.parse(iso));
const iso = (s: string) => new Date(s).toISOString();
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A tower the city may name and stand in a post: verified by Jupiter, with a plain ticker X shows as a cashtag. */
const nameable = (t: Tower) => isNamed(t) && /^\$?[A-Za-z0-9]{1,12}$/.test(t.symbol);

/**
 * The tower of the hour: the named tower that grew the most over the last hour at this read, outside the docks (a new
 * pool's first hour is its own story). `inCity` keeps the pick to towers the clip can fly to. Null when nothing grew.
 */
export function towerOfHour(s: CitySnapshot, inCity: (id: string) => boolean = () => true): HourFacts | null {
  if (!validTime(s.fetchedAt)) return null;
  const best = s.towers
    .filter((t) => nameable(t) && t.district !== 'docks' && finite(t.change1h) && t.change1h > 0 && t.mcap > 0 && inCity(t.id))
    .sort((a, b) => b.change1h - a.change1h || b.mcap - a.mcap)[0];
  if (!best) return null;
  return {
    template: 'hour', mint: best.id, symbol: ticker(best.symbol), district: best.district,
    change: best.change1h, mcap: best.mcap, readAt: iso(s.fetchedAt), live: s.source === 'live',
  };
}

/** JUST IN, the city's day: the 24h volume of every tower in the city at this read. */
export function cityVolume(s: CitySnapshot): JustInFacts | null {
  if (!validTime(s.fetchedAt)) return null;
  const counted = s.towers.filter((t) => finite(t.volume24h) && t.volume24h > 0);
  const value = counted.reduce((sum, t) => sum + t.volume24h, 0);
  if (!counted.length || !(value > 0)) return null;
  return { template: 'justin', metric: 'volume', value, towers: s.towers.length, readAt: iso(s.fetchedAt), live: s.source === 'live' };
}

/** JUST IN, a new tower in Sol Core: a named tower in the core at `after` that stood elsewhere, or nowhere, at `before`. */
export function newInCore(before: CitySnapshot, after: CitySnapshot): JustInFacts | null {
  if (!validTime(after.fetchedAt) || !validTime(before.fetchedAt) || Date.parse(before.fetchedAt) >= Date.parse(after.fetchedAt)) return null;
  const was = new Set(before.towers.filter((t) => t.district === 'core').map((t) => t.id));
  const fresh = after.towers.filter((t) => t.district === 'core' && nameable(t) && !was.has(t.id)).sort((a, b) => b.mcap - a.mcap)[0];
  if (!fresh) return null;
  return { template: 'justin', metric: 'core', mint: fresh.id, symbol: ticker(fresh.symbol), mcap: fresh.mcap, readAt: iso(after.fetchedAt), live: after.source === 'live' };
}

/** The flight log as `GET /api/v1/launch/{mint}/journal` answers it: only the fields the studio reads. */
export type JournalLike = {
  network: string;
  token: string;
  events: readonly { kind: string; at: string | null; signature: string }[];
  observedAt: string;
};

const NETWORKS = ['solana:devnet', 'solana:mainnet'] as const;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Launch Night: a Ryntra launch from its launch transaction to its graduation into the pool, both read from the chain
 * by the engine's flight log. Null until it has graduated: the night is the whole way, docks to pool.
 */
export function launchNight(j: JournalLike): LaunchFacts | null {
  const network = NETWORKS.find((n) => n === j?.network);
  if (!network || !MINT.test(j.token ?? '') || !validTime(j.observedAt) || !Array.isArray(j.events)) return null;
  const first = (kind: string) =>
    j.events.filter((e) => e?.kind === kind && validTime(e.at) && SIGNATURE.test(e.signature ?? '')).sort((a, b) => Date.parse(a.at!) - Date.parse(b.at!))[0];
  const launched = first('LAUNCHED');
  const graduated = first('GRADUATED');
  if (!launched || !graduated) return null;
  const seconds = Math.round((Date.parse(graduated.at!) - Date.parse(launched.at!)) / 1000);
  if (seconds < 0) return null;
  return {
    template: 'launch', mint: j.token, network,
    launchedAt: iso(launched.at!), launchTx: launched.signature, graduatedAt: iso(graduated.at!), graduateTx: graduated.signature,
    seconds, readAt: iso(j.observedAt),
  };
}

const DAY = 86_400_000;
const BILLBOARD_ROWS = 5;

/**
 * The week's billboard: the five named towers that rose the most between the newest read and a read 6–8 days before it.
 * The studio keeps its reads; until one a week old is kept, the billboard says what one read can — the five busiest
 * towers by 24h volume — and says so.
 */
export function weekBillboard(now: CitySnapshot, earlier: readonly CitySnapshot[]): BillboardFacts | null {
  if (!validTime(now.fetchedAt)) return null;
  const at = Date.parse(now.fetchedAt);
  const live = now.source === 'live';
  const week = earlier
    .filter((s) => validTime(s.fetchedAt) && at - Date.parse(s.fetchedAt) >= 6 * DAY && at - Date.parse(s.fetchedAt) <= 8 * DAY)
    .sort((a, b) => Math.abs(at - Date.parse(a.fetchedAt) - 7 * DAY) - Math.abs(at - Date.parse(b.fetchedAt) - 7 * DAY))[0];
  if (week) {
    const then = new Map(week.towers.filter((t) => t.price > 0).map((t) => [t.id, t.price]));
    const rows = now.towers
      .filter((t) => nameable(t) && t.price > 0 && then.has(t.id))
      .map((t) => ({ mint: t.id, symbol: ticker(t.symbol), value: (t.price / then.get(t.id)! - 1) * 100 }))
      .sort((a, b) => b.value - a.value)
      .slice(0, BILLBOARD_ROWS);
    if (rows.length === BILLBOARD_ROWS) return { template: 'billboard', ranking: 'week', from: iso(week.fetchedAt), readAt: iso(now.fetchedAt), rows, live };
  }
  const rows = now.towers
    .filter((t) => nameable(t) && finite(t.volume24h) && t.volume24h > 0)
    .sort((a, b) => b.volume24h - a.volume24h)
    .slice(0, BILLBOARD_ROWS)
    .map((t) => ({ mint: t.id, symbol: ticker(t.symbol), value: t.volume24h }));
  if (rows.length < BILLBOARD_ROWS) return null;
  return { template: 'billboard', ranking: 'volume', from: null, readAt: iso(now.fetchedAt), rows, live };
}

/** The banner shows the city itself: how many towers stood in it at the read. */
export function bannerFacts(s: CitySnapshot): BannerFacts | null {
  if (!validTime(s.fetchedAt) || !s.towers.length) return null;
  return { template: 'banner', towers: s.towers.length, readAt: iso(s.fetchedAt), live: s.source === 'live' };
}

/** How old a template's facts may be when its draft goes into the queue: "the last hour" read a day ago is not news. */
export const FRESH_MS: Record<Template, number> = { hour: 2 * 3_600_000, justin: 6 * 3_600_000, launch: 3 * DAY, billboard: DAY, banner: 30 * DAY };

export function isFresh(f: Facts, now: Date): boolean {
  const at = Date.parse(f.template === 'launch' ? f.graduatedAt : f.readAt);
  return Number.isFinite(at) && now.getTime() - at <= FRESH_MS[f.template] && at - now.getTime() <= 5 * 60_000;
}

const market = (f: { live: boolean }) => (f.live ? JUPITER : `${JUPITER} (the city's bundled read)`);
const short = (sig: string) => `${sig.slice(0, 6)}…${sig.slice(-4)}`;

/** Every number of a post with its source and read time: what goes with the file, for the person who approves it. */
export function sourcesOf(f: Facts): Source[] {
  switch (f.template) {
    case 'hour':
      return [
        { what: `${f.symbol}: price change over the last hour`, value: pct(f.change), source: market(f), readAt: f.readAt, ref: f.mint },
        { what: `${f.symbol}: market cap`, value: usd(f.mcap), source: market(f), readAt: f.readAt, ref: f.mint },
      ];
    case 'justin':
      return f.metric === 'volume'
        ? [{ what: `24h volume, summed over the ${f.towers} towers of the city`, value: usd(f.value), source: market(f), readAt: f.readAt, ref: null }]
        : [{ what: `${f.symbol}: now a tower of Sol Core, market cap`, value: usd(f.mcap), source: market(f), readAt: f.readAt, ref: f.mint }];
    case 'launch':
      return [
        { what: 'Launched on Ryntra (launch transaction)', value: readTime(f.launchedAt), source: `${ENGINE}, ${f.network}`, readAt: f.readAt, ref: f.launchTx },
        { what: 'Graduated into its pool (graduation transaction)', value: readTime(f.graduatedAt), source: `${ENGINE}, ${f.network}`, readAt: f.readAt, ref: f.graduateTx },
        { what: 'From launch to pool', value: `${f.seconds} s`, source: `the two block times above (${short(f.launchTx)}, ${short(f.graduateTx)})`, readAt: f.readAt, ref: null },
      ];
    case 'billboard':
      return f.rows.map((r, i) => ({
        what: f.ranking === 'week' ? `#${i + 1} ${r.symbol}: price change since ${readTime(f.from!)}` : `#${i + 1} ${r.symbol}: 24h volume`,
        value: f.ranking === 'week' ? pct(r.value) : usd(r.value),
        source: market(f),
        readAt: f.readAt,
        ref: r.mint,
      }));
    case 'banner':
      return [{ what: 'Towers standing in the city', value: String(f.towers), source: market(f), readAt: f.readAt, ref: null }];
  }
}
