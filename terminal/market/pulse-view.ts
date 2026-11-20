import type { PulseRow } from '../../lib/spot/pulse.ts';
import { rudeName } from '../launch/rude.ts';

/**
 * The Market's Pulse on screen: three live columns — New · Almost on a DEX · Out on a DEX — from
 * the engine's own feeds (`/api/spot/pulse`, meme mode: the coins born on pump.fun, Meteora DBC and Raydium LaunchLab,
 * and Ryntra's own launches). The engine orders each feed and puts Ryntra's launches first; the screen keeps only what
 * a person can act on: no coin twice, no coin nobody holds or trades, no launch of Ryntra's that stopped trading.
 *
 * Pure: the screen and the tests read it as it is.
 */

export const PULSE_COLUMNS = ['new', 'soon', 'dex'] as const;
export type PulseColumn = (typeof PULSE_COLUMNS)[number];

/** Cards a column shows. */
export const PULSE_SHOWN = 5;

/** The window a card's move is read over: a new coin's first minutes, the others' hour. */
export const PULSE_MOVE: Readonly<Record<PulseColumn, 'm5' | 'h1'>> = { new: 'm5', soon: 'h1', dex: 'h1' };

/** A launch of Ryntra's that lives: it traded within the day and has a price. */
export function ourLive(row: Pick<PulseRow, 'ryntra' | 'marketCapUsd'>): boolean {
  return row.ryntra !== null && row.ryntra.traded24h === true && (row.marketCapUsd ?? 0) > 0;
}

/**
 * «менше ~10 власників і майже нульовий обіг» — fewer than
 * {@link NEW_MIN_HOLDERS} holders and under {@link NEW_MIN_VOLUME_USD} traded in its first hour, both. A coin nobody holds
 * at all, or whose holders nobody counted, is empty whatever it traded.
 */
export const NEW_MIN_HOLDERS = 10;
export const NEW_MIN_VOLUME_USD = 500;

function alive(row: Pick<PulseRow, 'holders' | 'windows'>): boolean {
  if (row.holders === null || row.holders <= 0) return false;
  const volume = Math.max(row.windows.m5.volumeUsd ?? 0, row.windows.h1.volumeUsd ?? 0);
  return volume > 0 && (row.holders >= NEW_MIN_HOLDERS || volume >= NEW_MIN_VOLUME_USD);
}

/**
 * When fewer than a column's worth of new coins pass, «New» fills up with coins that do trade — at least
 * {@link NEW_FILL_HOLDERS} holders and {@link NEW_FILL_VOLUME_USD} traded, both — so the column is never an empty box at
 * a quiet hour, and still never «3 holders, $7».
 */
export const NEW_FILL_HOLDERS = 5;
export const NEW_FILL_VOLUME_USD = 100;

function fills(row: Pick<PulseRow, 'holders' | 'windows'>): boolean {
  if (row.holders === null || row.holders < NEW_FILL_HOLDERS) return false;
  return Math.max(row.windows.m5.volumeUsd ?? 0, row.windows.h1.volumeUsd ?? 0) >= NEW_FILL_VOLUME_USD;
}

const nameKey = (row: Pick<PulseRow, 'symbol' | 'name'>) => `${row.symbol.trim().toLowerCase()}\u0000${row.name.trim().toLowerCase()}`;

/** Of two coins with one ticker and name, the one more people hold, then the one more traded. */
function busier(a: PulseRow, b: PulseRow): boolean {
  const held = (a.holders ?? 0) - (b.holders ?? 0);
  if (held) return held > 0;
  return (a.windows.h1.volumeUsd ?? 0) > (b.windows.h1.volumeUsd ?? 0);
}

/**
 * A column's cards, in the engine's order: Ryntra's launches only while they live; in «New» only a coin someone holds
 * and traded; a ticker and name that stand twice — once, the busier coin in the first one's place. A crude name is not
 * shown (`rudeName`, the Launch showcase's own list; release check 19.11: «ASSHOLE» came in live) — the coin stays
 * reachable by its address.
 */
export function pulseCards(column: PulseColumn, all: readonly PulseRow[]): PulseRow[] {
  const rows = all.filter((row) => !rudeName(row.symbol, row.name));
  const firm = rows.filter((row) => (row.ryntra ? ourLive(row) : column === 'new' ? alive(row) : (row.holders ?? 0) > 0));
  // A quiet hour: «New» adds the coins that do trade, in the engine's order, so the column is not an empty box.
  const kept =
    column === 'new' && new Set(firm.map(nameKey)).size < PULSE_SHOWN
      ? rows.filter((row) => (row.ryntra ? ourLive(row) : alive(row) || fills(row)))
      : firm;
  const best = new Map<string, PulseRow>();
  for (const row of kept) {
    const key = nameKey(row);
    const had = best.get(key);
    // A launch of Ryntra's keeps its name: a copy with more holders never takes its place.
    if (!had || (!had.ryntra && (row.ryntra || busier(row, had)))) best.set(key, row);
  }
  const seen = new Set<string>();
  const out: PulseRow[] = [];
  for (const row of kept) {
    const key = nameKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(best.get(key)!);
  }
  return out;
}

/**
 * The three columns at once, each coin in one of them: a coin out on a DEX stands only there, a coin almost there only
 * in its column, and «New» keeps what the other two do not name (by mint, and by ticker and name).
 */
export function pulseBoard(rows: Readonly<Record<PulseColumn, readonly PulseRow[]>>): Record<PulseColumn, PulseRow[]> {
  const dex = pulseCards('dex', rows.dex);
  const taken = new Set<string>([...dex.map((row) => row.mint), ...dex.map(nameKey)]);
  const soon = pulseCards('soon', rows.soon).filter((row) => !taken.has(row.mint) && !taken.has(nameKey(row)));
  for (const row of soon) {
    taken.add(row.mint);
    taken.add(nameKey(row));
  }
  const fresh = pulseCards('new', rows.new).filter((row) => !taken.has(row.mint) && !taken.has(nameKey(row)));
  return { new: fresh, soon, dex };
}

/** The launchpad as a card names it, short: «pump», «Meteora», «LaunchLab», «Ryntra». */
export function padWord(row: Pick<PulseRow, 'launchpad' | 'ryntra' | 'venue'>): string | null {
  if (row.ryntra) return 'Ryntra';
  const pad = row.launchpad;
  if (!pad) return row.venue === 'pump' ? 'pump' : row.venue === 'meteora-dbc' ? 'Meteora' : row.venue === 'launchlab' ? 'LaunchLab' : null;
  if (pad === 'pump.fun') return 'pump';
  if (pad === 'bonk.fun') return 'bonk';
  return pad.length > 12 ? null : pad;
}

/** When a card's coin was born: its first pool, or the launch on Ryntra. */
export function bornAt(row: Pick<PulseRow, 'firstPoolAt' | 'ryntra'>): number | null {
  const at = Date.parse(row.firstPoolAt ?? row.ryntra?.launchedAt ?? '');
  return Number.isFinite(at) ? at : null;
}

/** How far a curve is to the DEX, a whole percent 0–100; null — not on a curve. */
export function curvePct(row: Pick<PulseRow, 'curve'>): number | null {
  if (!row.curve) return null;
  return Math.max(0, Math.min(100, Math.floor(row.curve.progressPct)));
}

/** The mints of Ryntra's own launches among the rows: «Launched on: Ryntra» keeps these. */
export function ryntraMints(rows: readonly Pick<PulseRow, 'mint' | 'ryntra'>[]): string[] {
  return [...new Set(rows.filter((row) => row.ryntra !== null).map((row) => row.mint))];
}

/**
 * A card's logo through the engine's own icon proxies, never the address a coin's creator wrote: a launch of Ryntra's
 * by the picture it was made with (`/api/icon`), every other coin by the logo Jupiter lists (`/api/spot/icon`).
 */
export function cardLogo(row: Pick<PulseRow, 'mint' | 'icon' | 'ryntra'>): string | null {
  if (row.ryntra) return `/api/icon/${encodeURIComponent(row.mint)}`;
  if (!row.icon || row.icon.length > 512 || !row.icon.startsWith('https://')) return null;
  return `/api/spot/icon?mint=${encodeURIComponent(row.mint)}&u=${encodeURIComponent(row.icon)}`;
}
