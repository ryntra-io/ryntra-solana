import type { PulseRow } from '../../lib/spot/pulse.ts';
import { rudeName } from '../launch/rude.ts';
import { RISK_TOP_PCT, logoAlso, logoOf, oneTapOk } from './depth-view.ts';

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

/** Cards a column shows at once; the column scrolls on to {@link PULSE_LIST}. */
export const PULSE_SHOWN = 5;
/** Cards a column holds: it scrolls past the first five. */
export const PULSE_LIST = 30;

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

/**
 * A card's logo and where it is tried next (flaw 116: «SI · Short Inu» stood as a letter in the Pulse while the
 * Launch's «New on the market» showed its logo): the feed's own picture first, then the logo the market's list already
 * knows for that mint (`known`, the towers' icon), then the engine's routes by mint. Every address is the engine's own.
 */
export function pulseLogo(row: Pick<PulseRow, 'mint' | 'icon' | 'ryntra'>, known: string | null | undefined): Readonly<{ src: string | null; also: string[] }> {
  const own = cardLogo(row);
  const listed = known ? logoOf({ id: row.mint, icon: known }) : null;
  const chain = [own, listed, ...logoAlso(row.mint, row.icon ?? known ?? null), ...(row.icon && known ? logoAlso(row.mint, known) : [])].filter((src): src is string => Boolean(src));
  const unique = [...new Set(chain)];
  return { src: unique[0] ?? null, also: unique.slice(1) };
}

/* ------------------------------------------------------------ the column's state */

/** A feed as the screen holds it: read or not yet, answered or not, its last read missed or not. */
export type FeedState = Readonly<{ status: 'reading' | 'ready' | 'failed'; missed: boolean }>;

/**
 * Whether the Pulse is live (flaw 10: «● live» stood green over three empty columns while nothing answered):
 * `live` — at least one feed answered on its last read; `reading` — none has yet and one still reads; `down` — none
 * answered.
 */
export function pulseLive(feeds: Readonly<Record<PulseColumn, FeedState>>): 'live' | 'reading' | 'down' {
  const all = PULSE_COLUMNS.map((id) => feeds[id]);
  if (all.some((feed) => feed.status === 'ready' && !feed.missed)) return 'live';
  if (all.some((feed) => feed.status === 'reading')) return 'reading';
  return 'down';
}

/**
 * What a column shows: its cards; the bones while its first read flies; `down` — the feed did not answer and there is
 * nothing to show from before (a failure, said so, with «Try again»); `filtered` — the feed has coins and the person's
 * filter passes none; `quiet` — the feed answered and the market has nothing for it this minute.
 */
export function columnState(feed: FeedState, shown: number, inFeed: number): 'cards' | 'reading' | 'down' | 'filtered' | 'quiet' {
  if (shown > 0) return 'cards';
  if (feed.status === 'reading') return 'reading';
  if (feed.status === 'failed' || feed.missed) return 'down';
  return inFeed > 0 ? 'filtered' : 'quiet';
}

/** The cards that came into a column after it was first drawn: a quiet flash marks them, the rest stand as they were. */
export function freshMints(seen: ReadonlySet<string>, cards: readonly Pick<PulseRow, 'mint'>[]): Set<string> {
  if (!seen.size) return new Set();
  return new Set(cards.filter((row) => !seen.has(row.mint)).map((row) => row.mint));
}

/* ------------------------------------------------------------ the card's risk line */

/**
 * The card's one line of risk (BENCH 1.6: what every top terminal shows on a new coin): the top ten holders' share, the
 * creator's share, and how many coins the creator launched and how many of them reached a DEX — each as the engine read
 * it from Jupiter. A figure nobody stated is left out; with none of them the card has no line at all.
 */
export type RiskLine = Readonly<{ top10: number | null; dev: number | null; launched: number | null; out: number | null }>;

export function riskLineOf(row: Pick<PulseRow, 'top10Pct' | 'devPct' | 'creatorLaunches' | 'creatorGraduated'>): RiskLine | null {
  const pct = (value: number | null) => (value === null || !Number.isFinite(value) || value < 0 ? null : Math.min(100, value));
  const count = (value: number | null) => (value === null || !Number.isFinite(value) || value < 0 ? null : Math.floor(value));
  const launched = count(row.creatorLaunches);
  const line: RiskLine = {
    top10: pct(row.top10Pct),
    dev: pct(row.devPct),
    launched,
    // How many reached a DEX is said only beside how many were launched.
    out: launched === null ? null : count(row.creatorGraduated),
  };
  return line.top10 === null && line.dev === null && line.launched === null ? null : line;
}

/** The creator keeps at least this share of the supply, percent. */
export const CARD_DEV_PCT = 10;
/** The creator launched at least this many coins (the engine's own threshold, `FLAG_CREATOR_LAUNCHES`). */
export const CARD_CREATOR_LAUNCHES = 10;

/** A fact against a new coin, as its card tells it: concentration, the creator, a right kept, Jupiter's flag. */
export type CardRisk = 'top' | 'dev' | 'serial' | 'mint' | 'freeze' | 'flagged';

/** The facts against a card's coin, as read — a figure nobody stated is not counted. Facts, never a score. */
export function cardRisks(row: Pick<PulseRow, 'top10Pct' | 'devPct' | 'creatorLaunches' | 'creatorGraduated' | 'notices'>): CardRisk[] {
  const line = riskLineOf(row);
  const out: CardRisk[] = [];
  if (row.notices.includes('MINT_AUTHORITY')) out.push('mint');
  if (row.notices.includes('FREEZE_AUTHORITY')) out.push('freeze');
  if (row.notices.includes('FLAGGED')) out.push('flagged');
  if (line?.top10 != null && line.top10 >= RISK_TOP_PCT) out.push('top');
  if (line?.dev != null && line.dev >= CARD_DEV_PCT) out.push('dev');
  if (line?.launched != null && line.launched >= CARD_CREATOR_LAUNCHES) out.push('serial');
  return out;
}

/** A share as the card writes it: whole above one per cent, a tenth below it, «<0.1» for a trace. */
export function shareText(pct: number): string {
  if (pct <= 0) return '0%';
  if (pct < 0.1) return '<0.1%';
  if (pct < 1) return `${(Math.round(pct * 10) / 10).toFixed(1)}%`;
  return `${Math.round(pct)}%`;
}

/** One tap buys a card's coin only when it passes for no stock and its name is not crude (the Market's own rules). */
export function cardOneTap(row: Pick<PulseRow, 'symbol' | 'name' | 'passesFor'>): boolean {
  return oneTapOk({ symbol: row.symbol, name: row.name, copyOf: row.passesFor ? row.passesFor.ticker : null });
}

/** The name a card shows beside its ticker: none when it only repeats the ticker. */
export function cardName(row: Pick<PulseRow, 'symbol' | 'name'>): string | null {
  const name = row.name.trim();
  const bare = (text: string) => text.replace(/^\$+/, '').trim().toLowerCase();
  return !name || bare(name) === bare(row.symbol) ? null : name;
}

/* ------------------------------------------------------------ a column's own filter */

/** Younger than: any, ten minutes, an hour, a day. */
export type PulseAge = 'any' | '10m' | '1h' | '24h';
export const PULSE_AGES: readonly PulseAge[] = ['any', '10m', '1h', '24h'];
const AGE_MS: Readonly<Record<Exclude<PulseAge, 'any'>, number>> = { '10m': 10 * 60_000, '1h': 3_600_000, '24h': 86_400_000 };

/** The pool holds at least: any, $1K, $10K, $50K. */
export const PULSE_LIQUIDITY: readonly (number | null)[] = [null, 1_000, 10_000, 50_000];

/** A column's own filter: the pool from, the age under, and no coin with a fact against it. */
export type ColumnFilter = Readonly<{ liquidity: number | null; age: PulseAge; safe: boolean }>;
export const COLUMN_FILTER_NONE: ColumnFilter = { liquidity: null, age: 'any', safe: false };

/** How many of a column's filters are set — the number on its button. */
export function columnFilterOn(filter: ColumnFilter): number {
  return Number(filter.liquidity !== null) + Number(filter.age !== 'any') + Number(filter.safe);
}

/** A column's filter as kept on the device, or none for anything that is not one. */
export function readColumnFilter(raw: unknown): ColumnFilter {
  if (!raw || typeof raw !== 'object') return COLUMN_FILTER_NONE;
  const value = raw as Record<string, unknown>;
  const liquidity = PULSE_LIQUIDITY.includes(value.liquidity as number) ? (value.liquidity as number | null) : null;
  const age = (PULSE_AGES as readonly unknown[]).includes(value.age) ? (value.age as PulseAge) : 'any';
  return { liquidity, age, safe: value.safe === true };
}

/**
 * Whether a card passes its column's filter. A figure nobody stated never passes a bound set on it; a launch of
 * Ryntra's still on its curve has its curve for a pool and passes a pool bound by that.
 */
export function passesColumn(row: PulseRow, filter: ColumnFilter, now: number): boolean {
  if (filter.safe && cardRisks(row).length > 0) return false;
  if (filter.liquidity !== null) {
    const curvePool = row.ryntra !== null && row.curve !== null && !row.curve.complete;
    if (!curvePool && (row.liquidityUsd === null || row.liquidityUsd < filter.liquidity)) return false;
  }
  if (filter.age !== 'any') {
    const born = bornAt(row);
    if (born === null || now - born > AGE_MS[filter.age]) return false;
  }
  return true;
}

/**
 * What a column shows while the person rests on it (BENCH 1.6: a column holds still under the pointer or the finger):
 * the cards already on screen stay where they are, in their order, with their newest figures; a new coin waits above
 * them until the column is let go. A card that left the feed stays until then too — nothing moves under the finger.
 */
export function heldCards(shown: readonly PulseRow[], fresh: readonly PulseRow[]): { cards: PulseRow[]; waiting: number } {
  const byMint = new Map(fresh.map((row) => [row.mint, row]));
  const kept = new Set(shown.map((row) => row.mint));
  return { cards: shown.map((row) => byMint.get(row.mint) ?? row), waiting: fresh.filter((row) => !kept.has(row.mint)).length };
}
