import type { CityEvent } from '../../city/store.ts';
import type { Tower } from '../../market/types.ts';
import type { PostEvent } from './events.ts';

/**
 * The city's own feed as post events: the launches of Ryntra the city reads from the engine (`city/lib/launch/moments.ts`
 * plays a launch as "LAUNCHED ON RYNTRA" and the move into the skyline as "Into the skyline"). A new pool elsewhere on
 * Solana, a pump or a flare is weather and never a post. The source time is when the engine's read showed it, at most
 * one read (30 s) after it happened. The coin is named only when the city has verified its tower, as everywhere else.
 */

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const LAUNCH_VALUE = 'LAUNCHED ON RYNTRA';
export const SKYLINE_TITLE = 'Into the skyline';

export function postFromCityEvent(e: CityEvent, tower: Tower | undefined): PostEvent | null {
  if (!MINT.test(e.towerId)) return null;
  const symbol = e.symbol.replace(/^\$/, '').trim();
  const named = tower?.verified === true && /^[A-Za-z0-9]{1,12}$/.test(symbol);
  const base = { mint: e.towerId, symbol: named ? symbol : '', named, district: tower?.district ?? 'docks', sourceAt: new Date(e.at).toISOString() };
  if (e.kind === 'launch' && e.value === LAUNCH_VALUE) return { ...base, kind: 'launch', id: e.towerId };
  if (e.kind === 'pump' && e.title === SKYLINE_TITLE) return { ...base, kind: 'graduate', id: e.towerId };
  return null;
}
