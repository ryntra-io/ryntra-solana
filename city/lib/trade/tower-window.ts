import { isNamed, type Tower } from '../market/types.ts';
import { wordsNow } from '../i18n/dict.ts';
import type { Balance, Side } from './tiles.ts';
import { SELL_LINE } from './words.ts';

/**
 * The tower's one window: a tap on a tower opens the trade window straight away —
 * the coin, its price and its key figures on top, Buy and Sell under them — and no card of its own stands beside it.
 * These are the window's rules without React, so the tests read them.
 */

type Placed = Readonly<{ tower: Pick<Tower, 'id' | 'verified'>; height: number }>;

/**
 * The tower a picked id opens the window for: a named tower of the city, or a launch's tower — never verified by
 * Jupiter, traded on its own curve or pool through the Launch engine (CITY-138). A pool without a name has nothing to
 * buy here and keeps its own small card.
 */
export function windowTower<T extends Placed>(towers: readonly T[], selectedId: string | null, launchTower: boolean): T | null {
  if (!selectedId) return null;
  const placed = towers.find((t) => t.tower.id === selectedId) ?? null;
  return placed && (launchTower || isNamed(placed.tower)) ? placed : null;
}

/** The tower's place in the skyline by height, 1 the tallest; 0 when it does not stand in the city. */
export function towerRank(towers: readonly Placed[], id: string): number {
  const placed = towers.find((t) => t.tower.id === id);
  if (!placed) return 0;
  return towers.filter((t) => t.height > placed.height).length + 1;
}

/**
 * What the Sell tab says instead of the ticket when there is nothing to sell: `connect` — no wallet yet; `reading` —
 * the wallet's balances are on their way; `none` — the wallet holds none of the coin. Null: the ticket.
 */
export type SellLine = 'connect' | 'reading' | 'none';

export function sellLine(side: Side, connected: boolean, holdingsRead: boolean, owned: Balance | null): SellLine | null {
  if (side !== 'sell') return null;
  if (!connected) return 'connect';
  if (!holdingsRead) return 'reading';
  return !owned || owned.spendableRaw === '0' ? 'none' : null;
}

/**
 * What one Escape closes while the window is open: `none` — another panel took the key already (or the beacon's
 * editor, which hears it first, stands in the window's place); `chart` — the chart standing in the window's place
 * (its own layer leaves the key to an open window, so the window closes it and comes back); `window` — the window
 * itself. Under a signature the window stays in front of everything and Escape asks it to close, which it refuses.
 */
export function escapeTarget(on: Readonly<{ prevented: boolean; busy: boolean; chart: boolean; beacon: boolean }>): 'none' | 'chart' | 'window' {
  if (on.prevented) return 'none';
  if (on.busy) return 'window';
  if (on.beacon) return 'none';
  return on.chart ? 'chart' : 'window';
}

/** The one line itself. */
export function sellWords(line: SellLine, coin: string): string {
  const w = wordsNow(SELL_LINE);
  if (line === 'connect') return w.connect(coin);
  if (line === 'reading') return w.reading;
  return w.none(coin);
}
