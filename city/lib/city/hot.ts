import type { CityLayout, PlacedTower } from './layout.ts';
import { isNamed } from '../market/types.ts';

/** How many of the hottest towers the card takes turns with, and how long each one stays. */
const ROTATION = 5;
const TURN_MS = 90_000;

/** A rise in the last hour, weighted by how many people traded it: a move that people made, not one wallet. */
const heat = (t: PlacedTower): number => t.tower.change1h * Math.log10(10 + t.tower.traders1h);

/**
 * The tower the home offers: what is hot right now. The strongest rise of the last hour among verified coins with
 * real liquidity and real traders, taking turns among the top few so the card is never one coin all day. With no
 * such rise, the day's best mover among named coins. `?coin=` picks one by symbol.
 */
export function hotTower(layout: CityLayout, now: number = Date.now()): PlacedTower | null {
  const asked = typeof window === 'undefined' ? null : new URLSearchParams(location.search).get('coin');
  const named = layout.towers.filter((t) => isNamed(t.tower) && t.tower.district !== 'docks' && t.tower.district !== 'avenue');
  if (asked) {
    const hit = named.find((t) => t.tower.symbol.replace(/^\$/, '').toUpperCase() === asked.toUpperCase());
    if (hit) return hit;
  }
  const rising = named
    .filter((t) => t.tower.liquidity >= 250_000 && t.tower.traders1h >= 25 && t.tower.change1h > 0)
    .sort((a, b) => heat(b) - heat(a))
    .slice(0, ROTATION);
  if (rising.length) return rising[Math.floor(now / TURN_MS) % rising.length]!;
  return [...named].sort((a, b) => b.tower.change24h - a.tower.change24h)[0] ?? null;
}
