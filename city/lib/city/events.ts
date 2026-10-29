import type { Tower } from '../market/types.ts';
import type { CityEvent } from './store.ts';

export type EventDraft = Omit<CityEvent, 'id' | 'at'>;

const pct = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}%`;

/**
 * The Market Weather data contract. A small coin can fake a pump with one trade, so:
 * a moment needs real liquidity behind it, a tower speaks at most once per cooldown, and a 5-minute move fires
 * only when two reads a minute apart agree on its direction. Stale data fires nothing (the top bar says DELAYED).
 */
export const WEATHER = {
  /** Liquidity a tower needs before its 5-minute move becomes a moment. */
  minLiquidity5m: 250_000,
  /** Liquidity for the 1-hour and 24-hour moments. */
  minLiquidity: 100_000,
  /** One moment per tower per this many milliseconds. */
  cooldownMs: 10 * 60_000,
  /** A read older than this is stale. */
  staleMs: 5 * 60_000,
} as const;

const lastMoment = new Map<string, number>();

/** Forget every tower's last moment (tests). */
export function resetWeather() {
  lastMoment.clear();
}

/** True if the tower may speak now; marks it as having spoken. */
function allow(id: string, now: number): boolean {
  const last = lastMoment.get(id) ?? 0;
  if (now - last < WEATHER.cooldownMs) return false;
  lastMoment.set(id, now);
  return true;
}

export const pump = (t: Tower, change: number, window: string): EventDraft => ({
  kind: 'pump',
  towerId: t.id,
  symbol: t.symbol,
  value: `${pct(change)} · ${window}`,
  title: 'PUMP',
});

export const flare = (t: Tower, change: number, window: string): EventDraft => ({
  kind: 'flare',
  towerId: t.id,
  symbol: t.symbol,
  value: `${pct(change)} · ${window}`,
  title: 'SOLAR FLARE',
});

/** A launch is shown without its name: new pools are unverified and the city does not advertise them. */
export const launch = (t: Tower): EventDraft => ({
  kind: 'launch',
  towerId: t.id,
  symbol: '',
  value: 'UNVERIFIED',
  title: 'NEW TOWER',
});

/** The opening show: the day's biggest riser, the biggest drop and the newest launch, each with its real figure. */
export function showcase(towers: readonly Tower[], now = Date.now()): EventDraft[] {
  const listed = towers.filter((t) => t.district !== 'docks' && t.verified && t.liquidity >= WEATHER.minLiquidity);
  const riser = [...listed].sort((a, b) => b.change24h - a.change24h)[0];
  const faller = [...listed].sort((a, b) => a.change24h - b.change24h)[0];
  const newest = [...towers.filter((t) => t.district === 'docks')].sort((a, b) => (b.launchedAt ?? '').localeCompare(a.launchedAt ?? ''))[0];
  const show: EventDraft[] = [];
  if (riser && riser.change24h >= 4 && allow(riser.id, now)) show.push(pump(riser, riser.change24h, '24H'));
  if (faller && faller.change24h <= -6 && allow(faller.id, now)) show.push(flare(faller, faller.change24h, '24H'));
  if (newest && allow(newest.id, now)) show.push(launch(newest));
  return show;
}

/**
 * What changed between two reads a minute apart: sharp 5-minute moves and towers that appeared in the docks.
 * At most two moments per read, the biggest first, so the city never turns into a strobe.
 */
export function diff(prev: readonly Tower[], next: readonly Tower[], now = Date.now()): EventDraft[] {
  const before = new Map(prev.map((t) => [t.id, t]));
  const moves: { draft: EventDraft; weight: number; id: string }[] = [];
  for (const t of next) {
    const old = before.get(t.id);
    if (!old) {
      if (t.district === 'docks') moves.push({ draft: launch(t), weight: 3, id: t.id });
      continue;
    }
    if (!t.verified || t.liquidity < WEATHER.minLiquidity5m) continue;
    // Two reads must agree: the previous read already leaned the same way.
    if (t.change5m >= 3 && old.change5m >= 1.5 && t.change5m > old.change5m + 1) moves.push({ draft: pump(t, t.change5m, '5M'), weight: t.change5m, id: t.id });
    else if (t.change5m <= -5 && old.change5m <= -2.5 && t.change5m < old.change5m - 1) moves.push({ draft: flare(t, t.change5m, '5M'), weight: -t.change5m, id: t.id });
  }
  const chosen: EventDraft[] = [];
  for (const m of moves.sort((a, b) => b.weight - a.weight)) {
    if (chosen.length === 2) break;
    if (allow(m.id, now)) chosen.push(m.draft);
  }
  return chosen;
}

/**
 * When the market is quiet the city still breathes: replay one of the hour's movers, labelled with its window.
 * `turn` rotates through them so the same tower does not repeat.
 */
export function ambient(towers: readonly Tower[], turn: number, now = Date.now()): EventDraft | null {
  const movers = towers
    .filter((t) => t.district !== 'docks' && t.verified && t.liquidity >= WEATHER.minLiquidity && Math.abs(t.change1h) >= 1.5)
    .sort((a, b) => Math.abs(b.change1h) - Math.abs(a.change1h))
    .slice(0, 8);
  for (let k = 0; k < movers.length; k += 1) {
    const t = movers[(turn + k) % movers.length]!;
    if (!allow(t.id, now)) continue;
    return t.change1h >= 0 ? pump(t, t.change1h, '1H') : flare(t, t.change1h, '1H');
  }
  return null;
}

/** True when the newest read is too old to drive the city. */
export function isStale(fetchedAt: string, now = Date.now()): boolean {
  return now - new Date(fetchedAt).getTime() > WEATHER.staleMs;
}
