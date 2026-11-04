import { shownText } from '../../../lib/world/text-safety/clean.ts';
import { lookalikeOf } from '../../../lib/world/text-safety/lookalike.ts';
import { sameOriginImage } from '../launch/towers.ts';
import type { CitySnapshot, Tower, TowerFigure } from '../market/types.ts';
import { spotIcon } from '../search/rank.ts';
import type { NewStage } from './lens.ts';

/**
 * «New» over the whole of Solana (CITY-142, launch strategy §7): every new launch of the network — pump.fun, Bags,
 * Meteora, LaunchLab, bonk.fun and the rest, Ryntra's own among them — read from the engine's Pulse, the same public
 * read Markets uses (`GET /api/spot/pulse`, no wallet, no key on this side). Its three feeds are the three rings: «Нові»
 * (first pool within the hour), «Майже на DEX» (a curve a quarter of the way or further, read from the curve's own
 * account) and «Вийшли на DEX» (left the curve within the day). Pure: an answer in, the launches by ring out, and the few
 * of them that stand as towers in the Docks. Every figure is the engine's; nothing here is guessed, and a coin is never
 * called safe. Born on Ryntra is the engine's own mark (`ryntra`), never a guess from the launchpad's name.
 */

/** The engine's feed behind each ring. */
export const RING_FEEDS: Readonly<Record<NewStage, 'new' | 'soon' | 'dex'>> = { fresh: 'new', near: 'soon', graduated: 'dex' };
export const STAGES: readonly NewStage[] = ['fresh', 'near', 'graduated'];

/** One feed of the engine's Pulse, every launch of the network (`mode=all`): Bags and the newer pads are not cut out. */
export const pulseUrl = (stage: NewStage): string => `/api/spot/pulse?feed=${RING_FEEDS[stage]}`;

/** A ring's list keeps at most this many launches; the engine answers sixty a feed. */
export const RING_MAX = 30;
/**
 * «Майже на DEX» for every coin alike: a quarter of the curve, the engine's own line (`SOON_MIN_PCT`). The engine's feed
 * also lists Ryntra's own curves at any point; on the ring they keep the same line as everyone's.
 */
export const NEAR_MIN_PCT = 25;

export type NewLaunch = Readonly<{
  mint: string;
  /** The ticker as the city may show it; null when held (CITY-73) or passing for a famous coin it is not. */
  symbol: string | null;
  name: string | null;
  /** Same-origin only: Ryntra's checked picture, or the coin's logo through the engine's icon route. */
  icon: string | null;
  /** The launchpad as people know it, as the engine names it; null where it names none. */
  launchpad: string | null;
  /** Launched through Ryntra, by the engine's own records. */
  ryntra: boolean;
  /** One of Ryntra's own technical launches: never demand, never the beacon. */
  test: boolean;
  stage: NewStage;
  /** The curve's way to the DEX, 0…100, read from the curve's own account; null where not read. */
  progress: number | null;
  price: number | null;
  marketCapUsd: number | null;
  liquidityUsd: number | null;
  holders: number | null;
  /** The engine counted at least this many holders, not exactly. */
  holdersAtLeast: boolean;
  change5m: number | null;
  change1h: number | null;
  change24h: number | null;
  volume5m: number | null;
  volume1h: number | null;
  volume24h: number | null;
  /** The ten largest holders' share, 0…100, as the engine states it; null where not read. */
  top10Pct: number | null;
  /** First pool (ms) — the coin's age on the market. */
  bornAt: number | null;
  /** When it left its curve (ms). */
  graduatedAt: number | null;
  verified: boolean;
}>;

/** The launchpads by the short names people say, for a row's small tag; any other as the engine names it. */
const PADS: Readonly<Record<string, string>> = {
  'pump.fun': 'Pump',
  'bags.fun': 'Bags',
  bags: 'Bags',
  'bonk.fun': 'Bonk',
  'letsbonk.fun': 'Bonk',
  'Jupiter Studio': 'Jup Studio',
  'boop.fun': 'Boop',
};

export function padLabel(pad: string | null): string | null {
  if (!pad) return null;
  return PADS[pad] ?? PADS[pad.toLowerCase()] ?? (pad.length > 14 ? `${pad.slice(0, 13)}…` : pad);
}

export type Rings = Readonly<Record<NewStage, readonly NewLaunch[]>>;
export const EMPTY_RINGS: Rings = { fresh: [], near: [], graduated: [] };

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const record = (value: unknown): Record<string, unknown> | null => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const stamp = (value: unknown): number | null => {
  const at = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(at) ? at : null;
};

/** One row of a Pulse answer as a launch of a ring; anything out of shape is left out. */
export function launchOf(raw: unknown, stage: NewStage): NewLaunch | null {
  const row = record(raw);
  if (!row || typeof row.mint !== 'string' || !MINT.test(row.mint)) return null;
  const mint = row.mint;
  const ryntra = record(row.ryntra);
  const verified = row.verified === true;
  const cleaned = shownText(row.symbol, 'symbol', 32);
  /* A ticker that passes for a famous coin it is not is not said: the row stands as a new pool. */
  const symbol = cleaned && (verified || ryntra || lookalikeOf(cleaned, mint) === null) ? cleaned.replace(/^\$+/, '') : null;
  const name = symbol ? (shownText(row.name, 'name', 64) ?? symbol) : null;
  const curve = record(row.curve);
  const windows = record(row.windows);
  const window = (key: string) => record(windows?.[key]);
  const pad = typeof row.launchpad === 'string' && row.launchpad.length <= 48 ? row.launchpad : null;
  const iconUrl = typeof row.icon === 'string' && row.icon.length <= 512 ? row.icon : null;
  return {
    mint,
    symbol,
    name,
    icon: symbol ? (sameOriginImage(iconUrl) ?? spotIcon(mint, iconUrl)) : null,
    launchpad: ryntra ? 'Ryntra' : pad,
    ryntra: ryntra !== null,
    test: ryntra?.technicalValidation === true,
    stage,
    progress: curve ? finite(curve.progressPct) : null,
    price: finite(row.price),
    marketCapUsd: finite(row.marketCapUsd),
    liquidityUsd: finite(row.liquidityUsd),
    holders: finite(row.holders),
    holdersAtLeast: row.holdersAtLeast === true,
    change5m: finite(window('m5')?.changePct),
    change1h: finite(window('h1')?.changePct),
    change24h: finite(window('h24')?.changePct),
    volume5m: finite(window('m5')?.volumeUsd),
    volume1h: finite(window('h1')?.volumeUsd),
    volume24h: finite(window('h24')?.volumeUsd),
    top10Pct: finite(row.top10Pct),
    bornAt: stamp(row.firstPoolAt) ?? stamp(ryntra?.launchedAt),
    graduatedAt: stamp(row.graduatedAt),
    verified: verified && symbol !== null && lookalikeOf(symbol, mint) === null,
  };
}

/** A feed's launches in the engine's own order (no hand-picked top), each mint once. */
export function feedLaunches(body: unknown, stage: NewStage): NewLaunch[] {
  const rows = record(body)?.rows;
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  const out: NewLaunch[] = [];
  for (const raw of rows) {
    const launch = launchOf(raw, stage);
    if (!launch || seen.has(launch.mint)) continue;
    seen.add(launch.mint);
    out.push(launch);
  }
  return out;
}

const RANK: Readonly<Record<NewStage, number>> = { fresh: 0, near: 1, graduated: 2 };

/**
 * The three feeds as three rings: a coin in more than one stands on the furthest — a fresh coin already near its DEX is
 * near, one that left its curve has left — so each coin is on one ring only. A feed that did not answer leaves its ring
 * as the last read had it (`kept`).
 */
export function ringsOf(answers: Readonly<Partial<Record<NewStage, unknown>>>, kept: Rings = EMPTY_RINGS): Rings {
  const lists: Record<NewStage, NewLaunch[]> = {
    fresh: answers.fresh === undefined ? [...kept.fresh] : feedLaunches(answers.fresh, 'fresh'),
    near: (answers.near === undefined ? [...kept.near] : feedLaunches(answers.near, 'near')).filter((launch) => launch.progress === null || launch.progress >= NEAR_MIN_PCT),
    graduated: answers.graduated === undefined ? [...kept.graduated] : feedLaunches(answers.graduated, 'graduated'),
  };
  const furthest = new Map<string, NewStage>();
  for (const stage of STAGES) for (const launch of lists[stage]) {
    const was = furthest.get(launch.mint);
    if (!was || RANK[stage] > RANK[was]) furthest.set(launch.mint, stage);
  }
  const ring = (stage: NewStage) => lists[stage].filter((launch) => furthest.get(launch.mint) === stage).slice(0, RING_MAX);
  return { fresh: ring('fresh'), near: ring('near'), graduated: ring('graduated') };
}

/** Every launch of the rings by mint, and the ring it stands on — what the Lens reads for «New». */
export function stagesOf(rings: Rings): Map<string, NewStage> {
  const out = new Map<string, NewStage>();
  for (const stage of STAGES) for (const launch of rings[stage]) out.set(launch.mint, stage);
  return out;
}

/* ---------------------------------------------------------------- the window's order and filter (CITY-191) */

/** How a ring's list is ordered: as the engine gives it (newest, furthest, latest out), or by one figure, largest first. */
export type LaunchSort = 'feed' | 'cap' | 'volume' | 'holders';
export const SORTS: readonly LaunchSort[] = ['feed', 'cap', 'volume', 'holders'];

/** The volume a row shows: the window each ring is read over — five minutes for the newest, the hour, the day. */
export function volumeOf(launch: NewLaunch): number | null {
  if (launch.stage === 'fresh') return launch.volume5m ?? launch.volume1h;
  if (launch.stage === 'near') return launch.volume1h ?? launch.volume24h;
  return launch.volume24h;
}

/** The change a row shows, over the same window as its volume. */
export function changeOf(launch: NewLaunch): number | null {
  if (launch.stage === 'fresh') return launch.change5m ?? launch.change1h;
  if (launch.stage === 'near') return launch.change1h ?? launch.change24h;
  return launch.change24h;
}

const FIGURE: Readonly<Record<Exclude<LaunchSort, 'feed'>, (launch: NewLaunch) => number | null>> = {
  cap: (launch) => launch.marketCapUsd,
  volume: volumeOf,
  holders: (launch) => launch.holders,
};

/**
 * A ring's launches in the order asked for, cut to one launchpad (by its short name, `padLabel`) when one is picked.
 * Unread figures go last; ties keep the engine's order. The engine's own list is never changed.
 */
export function shownLaunches(list: readonly NewLaunch[], sort: LaunchSort, pad: string | null): NewLaunch[] {
  const kept = pad ? list.filter((launch) => padLabel(launch.launchpad) === pad) : [...list];
  if (sort === 'feed') return kept;
  const figure = FIGURE[sort];
  return kept
    .map((launch, at) => ({ launch, at, value: figure(launch) }))
    .sort((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity) || a.at - b.at)
    .map((one) => one.launch);
}

/** The launchpads on the rings by their short names, the busiest first: what the filter offers. */
export function padsOf(rings: Rings): string[] {
  const count = new Map<string, number>();
  for (const stage of STAGES) for (const launch of rings[stage]) {
    const label = padLabel(launch.launchpad);
    if (label) count.set(label, (count.get(label) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([label]) => label);
}

/** The tickers more than one coin on the rings goes by ($DJT ×3): their rows say the coin's name and its address's end. */
export function twinsOf(rings: Rings): Set<string> {
  const mints = new Map<string, Set<string>>();
  for (const stage of STAGES) for (const launch of rings[stage]) {
    if (!launch.symbol) continue;
    const key = launch.symbol.toLowerCase();
    mints.set(key, (mints.get(key) ?? new Set()).add(launch.mint));
  }
  return new Set([...mints.entries()].filter(([, set]) => set.size > 1).map(([key]) => key));
}

/** The end of a coin's address, for telling two coins of one ticker apart in a hint: «…k9Pz». */
export const mintTail = (mint: string): string => `…${mint.slice(-4)}`;

/* ---------------------------------------------------------------- towers in the Docks */

/**
 * How many launches of the network stand as towers at most, by ring: the ones near their DEX first, then the ones that
 * left it today, then the freshest. A handful, so the Docks fill without crowding the skyline or the phone's frame.
 */
export const DOCK_QUOTA: Readonly<Record<NewStage, number>> = { near: 5, graduated: 3, fresh: 6 };
/** A fresh coin stands a tower from this market cap, as the city's own newest pools do (`buildTowers`). */
export const FRESH_MIN_CAP_USD = 5_000;

/**
 * The launches that stand as towers, beside the towers the city already has (`present`): Ryntra's own are the Launch
 * district's (it lays them out), a held ticker stands no tower, and Ryntra's technical launches stand none either.
 */
export function dockLaunches(rings: Rings, present: ReadonlySet<string>): NewLaunch[] {
  const out: NewLaunch[] = [];
  for (const stage of ['near', 'graduated', 'fresh'] as const) {
    let left = DOCK_QUOTA[stage];
    for (const launch of rings[stage]) {
      if (left <= 0) break;
      if (present.has(launch.mint) || launch.ryntra || launch.symbol === null) continue;
      if (stage === 'fresh' && (launch.marketCapUsd ?? 0) < FRESH_MIN_CAP_USD) continue;
      out.push(launch);
      left -= 1;
    }
  }
  return out;
}

/**
 * A launch as a tower of the Docks: the engine's figures, zero for the ones it did not read — and those named in
 * `unread`, so a screen writes «Not measured» for them, never the zero (CITY-73). It stands in the Docks whatever its
 * ring: the skyline is the city's own rule (CITY-144), not a launchpad's. Unverified, it stands as an anonymous pool.
 */
export function towerOfLaunch(launch: NewLaunch): Tower {
  const read: Record<TowerFigure, number | null> = {
    price: launch.price,
    mcap: launch.marketCapUsd,
    liquidity: launch.liquidityUsd,
    holders: launch.holders,
    change5m: launch.change5m,
    change1h: launch.change1h,
    change24h: launch.change24h,
    volume24h: launch.volume24h,
    traders1h: null,
    organic: null,
  };
  const unread = (Object.keys(read) as TowerFigure[]).filter((figure) => read[figure] === null);
  return {
    id: launch.mint,
    symbol: launch.symbol ?? '',
    name: launch.name ?? launch.symbol ?? '',
    icon: null,
    district: 'docks',
    price: launch.price ?? 0,
    mcap: launch.marketCapUsd ?? 0,
    liquidity: launch.liquidityUsd ?? 0,
    holders: launch.holders ?? 0,
    change5m: launch.change5m ?? 0,
    change1h: launch.change1h ?? 0,
    change24h: launch.change24h ?? 0,
    volume24h: launch.volume24h ?? 0,
    traders1h: 0,
    organic: 0,
    verified: launch.verified,
    launchedAt: launch.bornAt === null ? null : new Date(launch.bornAt).toISOString(),
    ...(unread.length ? { unread } : {}),
  };
}

/** What of a Docks tower changes the city's look: where it stands and how tall — as the Launch district keys its own. */
const lookKey = (tower: Pick<Tower, 'id' | 'mcap'>) => `${tower.id}:${Math.round(Math.log10(Math.max(tower.mcap, 1)) * 4)}`;

/**
 * The city with the network's launches in its Docks. `ours` tells the towers this laid in before (they are let go or
 * renewed); every other tower is the city's own and stays as it is. The same snapshot comes back when nothing of the
 * look would change, so the skyline is not laid out again for nothing.
 */
export function withDockLaunches(base: CitySnapshot, rings: Rings, ours: (tower: Tower) => boolean, make: (launch: NewLaunch) => Tower = towerOfLaunch): CitySnapshot {
  const own = base.towers.filter((tower) => !ours(tower));
  const present = new Set(own.map((tower) => tower.id));
  const wanted = dockLaunches(rings, present);
  const before = base.towers.filter(ours).map(lookKey).sort().join('|');
  const after = wanted
    .map((launch) => lookKey({ id: launch.mint, mcap: launch.marketCapUsd ?? 0 }))
    .sort()
    .join('|');
  if (before === after) return base;
  return { ...base, towers: [...own, ...wanted.map(make)] };
}
