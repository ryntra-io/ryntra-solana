import type { Tower } from '../../market/types.ts';

/**
 * Which towers are «yours» to the garage agent: the coins your wallet holds, the coin your quarter's coin tower shows,
 * and the towers you set a beacon on. Each is one the city stands now; nothing is guessed, and SOL itself — the gas in
 * every wallet — counts only when a beacon names it.
 */

export type Why = 'held' | 'quarter' | 'beacon';

export type MyTower = Readonly<{ tower: Tower; why: readonly Why[] }>;

/** The most towers a report reads: more and it is a market list, not yours. */
export const MINE_MAX = 12;

export type MineInput = Readonly<{
  towers: readonly Tower[];
  /** Mints the connected wallet holds, SOL left out (`ownedMints`). */
  held: ReadonlySet<string>;
  /** Mints the quarter's buildings show (a coin tower's link). */
  quarter: readonly string[];
  /** Mints of the beacons that are on. */
  beacons: readonly string[];
}>;

/** Your towers in the city now: the quarter's coin first, then beacons, then holdings; each with why it is yours. */
export function myTowers({ towers, held, quarter, beacons }: MineInput, limit = MINE_MAX): MyTower[] {
  const byId = new Map(towers.map((t) => [t.id, t]));
  const out = new Map<string, Why[]>();
  const add = (mint: string, why: Why) => {
    if (!byId.has(mint)) return;
    const list = out.get(mint) ?? [];
    if (!list.includes(why)) list.push(why);
    out.set(mint, list);
  };
  quarter.forEach((m) => add(m, 'quarter'));
  beacons.forEach((m) => add(m, 'beacon'));
  // Holdings by the deeper pool first: a dust coin the wallet was sent is not what the person watches, and a coin
  // nobody vetted that landed in the wallet unasked is not reported by name.
  [...held]
    .map((m) => byId.get(m))
    .filter((t): t is Tower => !!t && t.verified)
    .sort((a, b) => b.liquidity - a.liquidity || a.id.localeCompare(b.id))
    .forEach((t) => add(t.id, 'held'));
  return [...out.entries()].slice(0, limit).map(([mint, why]) => ({ tower: byId.get(mint)!, why }));
}
