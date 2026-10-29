import type { HarborPool } from '../districts/harbor/pools.ts';
import type { LaunchTower } from '../launch/towers.ts';
import { isNamed, type Tower } from '../market/types.ts';
import { money, move, ticker } from './format.ts';
import type { FeedKind } from './settings.ts';
import { remember, sparkPoints, type Point, type Window } from './spark.ts';

/**
 * The home's live event feed (CITY-66): what rose, what fell, where the money traded, who launched a new coin, which
 * new pool opened — each event with its time and its source, built only from what the engine read. The city's market
 * read (`/api/city`, Jupiter, every minute) gives the movers, the volume and the new pools; the Launch district's read
 * (`/api/v1/launch/markets`) gives the coins launched on Ryntra; the Harbor's read (`/api/city/harbor`, Meteora) gives
 * the pools' volume and liquidity. The engine has no net inflow, so the feed says what it has: «24h volume» on the card,
 * the «liquidity» behind the header's «i».
 *
 * Events are history: an event keeps the figure and the time it was read with. A new one joins at the top and the
 * older ones move down; the screen holds a few. The market's moves arrive calmly — one kind's first event, then at
 * most one move a read — and a coin or a tower speaks once per `repeatMs`.
 */

export const FEED = {
  /** Depth a coin needs before its move is news: a thin pool moves on one trade. The same line as the city's moments. */
  minLiquidity: 100_000,
  /** A rise worth a line: +2% in an hour, or +5% in a day. */
  rise: { '1h': 2, '24h': 5 },
  /** A fall worth a line: −2% in an hour, or −5% in a day. */
  fall: { '1h': -2, '24h': -5 },
  /** 24-hour volume a coin or a pool needs to be named under «Volume». */
  minVolume: 250_000,
  /** How many of each kind's best are in turn. */
  candidates: 4,
  /** One coin, pool or tower is said once in this long. */
  repeatMs: 20 * 60_000,
  /** A read older than this is not «now»: no event is made from it. */
  staleMs: 5 * 60_000,
  /** A launch or a pool is new for this long. */
  newMs: 24 * 3_600_000,
  /** Events kept in memory, per kind: the market's moves never push a launch out. The screen shows fewer. */
  keep: 12,
  /** New coins one step may add. */
  coinsPerStep: 2,
  /** A new pool joins at most this often: Jupiter's newest pools arrive by the minute. */
  poolGapMs: 2 * 60_000,
} as const;

/** Where a tap on the event goes: a tower of the city (the camera flies, its card opens) or a pool of the Harbor. */
export type FeedTarget = Readonly<{ tower: string }> | Readonly<{ pool: string }>;

export type FeedTone = 'up' | 'down' | 'new' | 'flow';

export type FeedEvent = Readonly<{
  /** Arrival order: a larger id joined later. */
  id: number;
  /** What the event is about; one key speaks once per `repeatMs`. */
  key: string;
  kind: FeedKind;
  tone: FeedTone;
  title: string;
  line: string;
  /** The logo's same-origin address, or none. */
  image: string | null;
  /** The time the event is about: the read, the launch, the pool's opening. */
  at: number;
  /** Who said it. */
  source: string;
  /** A second figure kept behind the header's «i» with the source and the time; the card itself shows one number. */
  detail: string | null;
  /** The price line beside a mover, oldest point first. */
  spark: readonly Point[] | null;
  target: FeedTarget;
}>;

export type CityRead = Readonly<{ towers: readonly Tower[]; readAt: number; live: boolean }>;
export type PoolsRead = Readonly<{ pools: readonly HarborPool[]; at: number }>;

export type FeedInput = Readonly<{
  now: number;
  /** The city's latest market read. */
  city: CityRead | null;
  /** The launches on Ryntra the Launch district reads; null while it has none. */
  launches: readonly LaunchTower[] | null;
  /** The Harbor's pools; null while closed or not read. */
  pools: PoolsRead | null;
}>;

export type FeedMemory = Readonly<{
  /** Newest first. */
  events: readonly FeedEvent[];
  /** When each key last joined the feed. */
  spoke: ReadonlyMap<string, number>;
  /** Kinds that already had their first event. */
  seeded: ReadonlySet<FeedKind>;
  /** The launch time of the newest coin and pool said: only newer ones are news. */
  marks: Readonly<{ coins: number; pools: number }>;
  /** When the last new pool joined. */
  poolArrived: number;
  /** Whose turn among the market's kinds comes next. */
  turn: number;
  next: number;
  /** The city read the last step used. */
  readAt: number | null;
  /** The prices the city read, per tower, for the lines. */
  history: ReadonlyMap<string, readonly Point[]>;
}>;

export const emptyFeed = (): FeedMemory => ({
  events: [],
  spoke: new Map(),
  seeded: new Set(),
  marks: { coins: -Infinity, pools: -Infinity },
  poolArrived: -Infinity,
  turn: 0,
  next: 1,
  readAt: null,
  history: new Map(),
});

/* ---------------------------------------------------------------- reading the inputs */

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const list = <T>(v: readonly T[] | null | undefined): readonly T[] => (Array.isArray(v) ? v : []);
const time = (iso: string | null | undefined): number | null => {
  const t = typeof iso === 'string' ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** A tower the market's lines may name: verified, out of the docks, deep enough, with a price. */
export function listed(t: Tower | null | undefined): t is Tower {
  return !!t && typeof t.id === 'string' && typeof t.symbol === 'string' && isNamed(t) && t.district !== 'docks' && num(t.liquidity) >= FEED.minLiquidity && num(t.price) > 0;
}

/** Coins pegged to a currency: their volume is money parked, not money going somewhere. */
const STABLE = /^(?:[a-z]*usd[a-z0-9]*|eurc|dai|usdt0?)$/i;

export type Move = Readonly<{ window: Window; change: number; score: number }>;

/** The tower's rise worth a line: the hour's if it clears its bar, else the day's; the stronger of the two by its bar. */
export function riseOf(t: Pick<Tower, 'change1h' | 'change24h'>): Move | null {
  const h = num(t.change1h);
  const d = num(t.change24h);
  const sh = h >= FEED.rise['1h'] ? h / FEED.rise['1h'] : 0;
  const sd = d >= FEED.rise['24h'] ? d / FEED.rise['24h'] : 0;
  if (!sh && !sd) return null;
  return sh >= sd ? { window: '1h', change: h, score: sh } : { window: '24h', change: d, score: sd };
}

/** The tower's fall worth a line, the same way. */
export function fallOf(t: Pick<Tower, 'change1h' | 'change24h'>): Move | null {
  const h = num(t.change1h);
  const d = num(t.change24h);
  const sh = h <= FEED.fall['1h'] ? h / FEED.fall['1h'] : 0;
  const sd = d <= FEED.fall['24h'] ? d / FEED.fall['24h'] : 0;
  if (!sh && !sd) return null;
  return sh >= sd ? { window: '1h', change: h, score: sh } : { window: '24h', change: d, score: sd };
}

/**
 * One way per coin: a coin up 10% in the hour and down 16% in the day is said once, by the stronger of its two moves
 * against its bar, so the feed never names one coin as a gainer and a loser at once.
 */
export function directionOf(t: Pick<Tower, 'change1h' | 'change24h'>): 'up' | 'down' | null {
  const up = riseOf(t);
  const down = fallOf(t);
  if (!up && !down) return null;
  if (!down) return 'up';
  if (!up) return 'down';
  return up.score >= down.score ? 'up' : 'down';
}

const icon = (t: Tower): string | null => (t.icon ? `/api/icon/${t.id}` : null);

type Draft = Omit<FeedEvent, 'id'>;

function moverDraft(kind: 'gainers' | 'losers', t: Tower, m: Move, readAt: number, history: ReadonlyMap<string, readonly Point[]>): Draft {
  return {
    key: `${kind}:${t.id}`,
    kind,
    tone: kind === 'gainers' ? 'up' : 'down',
    title: ticker(t.symbol),
    line: move(m.change, m.window),
    image: icon(t),
    at: readAt,
    source: 'Jupiter',
    detail: null,
    spark: sparkPoints(t, m.window, readAt, history.get(t.id)),
    target: { tower: t.id },
  };
}

/** The best risers of a read, strongest first. */
export function gainers(towers: readonly Tower[], readAt: number, history: ReadonlyMap<string, readonly Point[]> = new Map()): Draft[] {
  return list(towers)
    .filter(listed)
    .map((t) => ({ t, m: directionOf(t) === 'up' ? riseOf(t) : null }))
    .filter((x): x is { t: Tower; m: Move } => x.m !== null)
    .sort((a, b) => b.m.score - a.m.score || a.t.id.localeCompare(b.t.id))
    .slice(0, FEED.candidates)
    .map(({ t, m }) => moverDraft('gainers', t, m, readAt, history));
}

/** The worst fallers of a read, sharpest first. */
export function losers(towers: readonly Tower[], readAt: number, history: ReadonlyMap<string, readonly Point[]> = new Map()): Draft[] {
  return list(towers)
    .filter(listed)
    .map((t) => ({ t, m: directionOf(t) === 'down' ? fallOf(t) : null }))
    .filter((x): x is { t: Tower; m: Move } => x.m !== null)
    .sort((a, b) => b.m.score - a.m.score || a.t.id.localeCompare(b.t.id))
    .slice(0, FEED.candidates)
    .map(({ t, m }) => moverDraft('losers', t, m, readAt, history));
}

/**
 * Where the money traded: the coins and the Harbor's pools with the most 24-hour volume, the most first. Volume is
 * what the engine has — not a net inflow — and the line says so.
 */
export function inflows(towers: readonly Tower[], readAt: number, pools: PoolsRead | null): Draft[] {
  const coins = list(towers)
    .filter((t) => listed(t) && !STABLE.test(t.symbol) && num(t.volume24h) >= FEED.minVolume)
    .map((t) => ({
      volume: num(t.volume24h),
      draft: {
        key: `inflows:${t.id}`,
        kind: 'inflows',
        tone: 'flow',
        title: `${money(num(t.volume24h))} · 24h volume`,
        line: ticker(t.symbol),
        image: icon(t),
        at: readAt,
        source: 'Jupiter',
        detail: `${money(num(t.liquidity))} liquidity`,
        spark: null,
        target: { tower: t.id },
      } satisfies Draft,
    }));
  const deep = list(pools?.pools)
    .filter((p) => p && typeof p.address === 'string' && num(p.volume24hUsd) >= FEED.minVolume && num(p.tvlUsd) > 0)
    .map((p) => ({
      volume: num(p.volume24hUsd),
      draft: {
        key: `inflows:pool:${p.address}`,
        kind: 'inflows',
        tone: 'flow',
        title: `${money(num(p.volume24hUsd))} · 24h volume`,
        line: `${p.pair} pool`,
        image: null,
        at: pools!.at,
        source: p.kind === 'dlmm' ? 'Meteora DLMM' : 'Meteora DAMM v2',
        detail: `${money(num(p.tvlUsd))} liquidity`,
        spark: null,
        target: { pool: p.address },
      } satisfies Draft,
    }));
  return [...coins, ...deep]
    .sort((a, b) => b.volume - a.volume || a.draft.key.localeCompare(b.draft.key))
    .slice(0, FEED.candidates)
    .map((x) => x.draft);
}

/**
 * Coins launched on Ryntra's mainnet in the last day, newest first; a lost signal, Ryntra's own test launches and a coin
 * on devnet (test coins, no real money) are not news of the market.
 */
export function newCoins(launches: readonly LaunchTower[] | null, now: number): Draft[] {
  return list(launches)
    .filter((l) => l && typeof l.token === 'string' && l.network === 'solana:mainnet' && !l.ryntraTest && l.phase !== 'lost')
    .map((l) => ({ l, at: time(l.launchedAt) }))
    .filter((x): x is { l: LaunchTower; at: number } => x.at !== null && x.at <= now + 60_000 && now - x.at <= FEED.newMs)
    .sort((a, b) => b.at - a.at || a.l.token.localeCompare(b.l.token))
    .map(({ l, at }) => ({
      key: `coins:${l.token}`,
      kind: 'coins',
      tone: 'new',
      title: 'New coin',
      line: `$${ticker(l.symbol)} launched on Ryntra`,
      image: l.image,
      at: Math.min(at, now),
      source: 'Ryntra Launch',
      detail: null,
      spark: null,
      target: { tower: l.token },
    }) satisfies Draft);
}

/**
 * Pools that opened in the last day, from the city's read of Jupiter's newest pools (the towers of the Launch Docks),
 * newest first. A coin Jupiter has not verified is named the city's way — «New pool», unverified, no name or logo.
 */
export function newPools(towers: readonly Tower[], launchTokens: ReadonlySet<string>, now: number): Draft[] {
  return list(towers)
    .filter((t) => t && typeof t.id === 'string' && t.district === 'docks' && !launchTokens.has(t.id))
    .map((t) => ({ t, at: time(t.launchedAt) }))
    .filter((x): x is { t: Tower; at: number } => x.at !== null && x.at <= now + 60_000 && now - x.at <= FEED.newMs)
    .sort((a, b) => b.at - a.at || a.t.id.localeCompare(b.t.id))
    .map(({ t, at }) => {
      const named = isNamed(t);
      return {
        key: `pools:${t.id}`,
        kind: 'pools',
        tone: 'new',
        title: 'New pool',
        line: named ? `$${ticker(t.symbol)} · ${money(num(t.liquidity))} liquidity` : `Unverified · ${money(num(t.liquidity))} liquidity`,
        image: named ? icon(t) : null,
        at: Math.min(at, now),
        source: 'Jupiter',
        detail: null,
        spark: null,
        target: { tower: t.id },
      } satisfies Draft;
    });
}

/* ---------------------------------------------------------------- one step */

const MARKET: readonly FeedKind[] = ['gainers', 'losers', 'inflows'];
const ORDER: readonly FeedKind[] = ['gainers', 'losers', 'inflows', 'coins', 'pools'];

/**
 * True when the read may make events: a live read, not older than `staleMs`. A read stamped ahead of this device's clock
 * (a clock running behind) counts as made now.
 */
export function freshRead(city: CityRead | null, now: number): city is CityRead {
  return !!city && city.live && Number.isFinite(city.readAt) && now - city.readAt <= FEED.staleMs;
}

/** Keys and prices older than this are let go: a day's events and lines need nothing older. */
const FORGET_MS = 25 * 3_600_000;

/** The Harbor's read counts while it is this young. */
const POOLS_FRESH_MS = 10 * 60_000;

/**
 * One step of the feed with the latest reads. Only the kinds the person shows get new events. A fresh market read gives
 * each kind's first event, and after that one move a read in turn. The newest launch and the newest pool are the first
 * of theirs; after that only a launch or a pool newer than the last one said joins — a coin launched, a pool opened —
 * and a pool at most once in `poolGapMs`.
 */
export function advance(memory: FeedMemory, input: FeedInput, shown: ReadonlySet<FeedKind>): FeedMemory {
  const now = input.now;
  const spoke = new Map(memory.spoke);
  const seeded = new Set(memory.seeded);
  const marks = { ...memory.marks };
  let history = memory.history;
  let turn = memory.turn;
  let poolArrived = memory.poolArrived;
  const fresh: Partial<Record<FeedKind, Draft[]>> = {};
  const add = (d: Draft) => {
    (fresh[d.kind] ??= []).push(d);
    spoke.set(d.key, now);
    seeded.add(d.kind);
  };
  const quiet = (key: string) => now - (spoke.get(key) ?? -Infinity) >= FEED.repeatMs;

  // The latest fresh read seeds a kind switched on; only a newer read moves the feed on (a cached older copy does not).
  const latest = freshRead(input.city, now) ? input.city : null;
  const read = latest && (memory.readAt === null || latest.readAt > memory.readAt) ? latest : null;
  if (latest) {
    const towers = list(latest.towers);
    // The time the market's events are about: the read's, never ahead of now.
    const readAt = Math.min(latest.readAt, now);
    if (read) {
      const next = new Map<string, readonly Point[]>();
      for (const [id, points] of history) if (points.length && readAt - points[points.length - 1]![0] <= FORGET_MS) next.set(id, points);
      for (const t of towers) if (listed(t)) next.set(t.id, remember(next.get(t.id), readAt, t.price));
      history = next;
      for (const [key, at] of spoke) if (now - at > FORGET_MS) spoke.delete(key);
    }

    const pools = input.pools && now - input.pools.at <= POOLS_FRESH_MS ? input.pools : null;
    const candidates: Record<string, Draft[]> = {
      gainers: gainers(towers, readAt, history),
      losers: losers(towers, readAt, history),
      inflows: inflows(towers, readAt, pools),
    };
    // A kind's first event, for every kind shown that has one.
    for (const kind of MARKET) {
      if (!shown.has(kind) || seeded.has(kind)) continue;
      const first = candidates[kind]!.find((d) => quiet(d.key));
      if (first) add(first);
    }
    // Then one move a new read, the market's kinds in turn.
    if (read && !MARKET.some((kind) => fresh[kind])) {
      for (let k = 0; k < MARKET.length; k += 1) {
        const kind = MARKET[(turn + k) % MARKET.length]!;
        if (!shown.has(kind)) continue;
        const draft = candidates[kind]!.find((d) => quiet(d.key));
        if (!draft) continue;
        add(draft);
        turn = (turn + k + 1) % MARKET.length;
        break;
      }
    }
    // A pool that opened after the last one said: the first one now, the next ones with a new read.
    if (shown.has('pools') && (read || !seeded.has('pools')) && now - poolArrived >= FEED.poolGapMs) {
      const launchTokens = new Set(list(input.launches).flatMap((l) => (l && typeof l.token === 'string' ? [l.token] : [])));
      const pool = newPools(towers, launchTokens, now).find((d) => d.at > marks.pools && !spoke.has(d.key));
      if (pool) {
        add(pool);
        marks.pools = pool.at;
        poolArrived = now;
      }
    }
  }

  // Coins launched after the last one said. The first step shows only the newest; after that the oldest new ones go
  // first, so a burst of launches is said over a few steps and none is skipped.
  if (shown.has('coins')) {
    const coins = newCoins(input.launches, now).filter((d) => d.at > marks.coins && !spoke.has(d.key));
    const taken = seeded.has('coins') ? coins.slice(-FEED.coinsPerStep) : coins.slice(0, 1);
    taken.forEach(add);
    if (taken.length) marks.coins = Math.max(marks.coins, ...taken.map((d) => d.at));
  }

  const added = ORDER.flatMap((kind) => fresh[kind] ?? []);
  if (!added.length && history === memory.history) return memory;
  let id = memory.next;
  // The first of the order lands on top: the batch is numbered from the bottom up.
  const events = added
    .slice()
    .reverse()
    .map((d) => ({ ...d, id: id++ }))
    .reverse();
  const kept: Partial<Record<FeedKind, number>> = {};
  return {
    events: [...events, ...memory.events].filter((e) => (kept[e.kind] = (kept[e.kind] ?? 0) + 1) <= FEED.keep),
    spoke,
    seeded,
    marks,
    poolArrived,
    turn,
    next: id,
    readAt: read ? read.readAt : memory.readAt,
    history,
  };
}

/** The events the screen shows: the kinds switched on, newest first, at most `limit`. */
export function visibleEvents(events: readonly FeedEvent[], shown: ReadonlySet<FeedKind>, limit: number): FeedEvent[] {
  return events.filter((e) => shown.has(e.kind)).slice(0, Math.max(0, limit));
}
