'use client';

import { create } from 'zustand';
import { useMarket } from '../shell/useMarket.ts';

/**
 * A coin's move over the day, one figure on every screen (QA 19.11: MET's day said +0.21 % in one place,
 * +0.37 % in the Market's list, +1.03 % on the Grid and +1.26 % on its own page). Every figure is Jupiter's, read by
 * different reads at different moments: the city's market read, the Market's lists, the coin's own market. Each read
 * notes what it measured and when; every screen says the newest of them — so two screens never disagree for longer
 * than a read takes.
 */

export type DayMove = Readonly<{ change: number; at: number }>;

type State = { moves: Readonly<Record<string, DayMove>> };

export const useDayMoves = create<State>(() => ({ moves: {} }));

/** The most coins kept: the newest notes stay. */
const MAX_COINS = 2_000;

/** Pure: the moves after a read at `at` — each coin's newest; the same object when nothing changed. */
export function keepMoves(moves: Readonly<Record<string, DayMove>>, rows: readonly Readonly<{ mint: string; change: number | null | undefined }>[], at: number): Readonly<Record<string, DayMove>> {
  let next: Record<string, DayMove> | null = null;
  for (const row of rows) {
    if (typeof row.change !== 'number' || !Number.isFinite(row.change) || !Number.isFinite(at)) continue;
    const held = (next ?? moves)[row.mint];
    if (held && (held.at > at || (held.at === at && held.change === row.change))) continue;
    next ??= { ...moves };
    next[row.mint] = { change: row.change, at };
  }
  if (!next) return moves;
  const mints = Object.keys(next);
  if (mints.length > MAX_COINS) for (const mint of mints.sort((a, b) => next![a]!.at - next![b]!.at).slice(0, mints.length - MAX_COINS)) delete next[mint];
  return next;
}

/** A read's moves, noted with the moment they were read. */
export function noteDayMoves(rows: readonly Readonly<{ mint: string; change: number | null | undefined }>[], at: number): void {
  const before = useDayMoves.getState().moves;
  const after = keepMoves(before, rows, at);
  if (after !== before) useDayMoves.setState({ moves: after });
}

/** The newest of the moves known; null when none was measured. */
export function newestMove(...moves: readonly (DayMove | null | undefined)[]): number | null {
  let best: DayMove | null = null;
  for (const move of moves) if (move && Number.isFinite(move.change) && (!best || move.at > best.at)) best = move;
  return best ? best.change : null;
}

/**
 * The day's move of a coin as every screen says it: the newest of what the reads noted and of the city's market read
 * (its towers, as of the snapshot's time). `own` — the screen's own read, when it has one not noted yet.
 */
export function useDayMove(mint: string | null, own: DayMove | null = null): number | null {
  const noted = useDayMoves((st) => (mint ? st.moves[mint] : undefined));
  const snapshot = useMarket();
  const tower = mint ? snapshot.towers.find((one) => one.id === mint) : undefined;
  const city = tower && !tower.unread?.includes('change24h') && Number.isFinite(tower.change24h) ? { change: tower.change24h, at: Date.parse(snapshot.fetchedAt) } : null;
  return newestMove(noted, own, city);
}
