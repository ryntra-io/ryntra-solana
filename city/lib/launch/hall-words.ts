import { digits, wordsNow } from '../i18n/dict.ts';
import type { HallBoardId, HallFigure, HallPeriod, HallSpan, HallTally, HallView } from './hall.ts';
import { HALL_BOARDS, rawToMicros } from './hall.ts';
import { HALL_WORDS } from './words.ts';

/**
 * How the Hall says its numbers: short, in the language on screen (`./words.ts`), every figure rounded down so it never
 * reads as more than it is, and every one with the word for what it is.
 */

type Key = keyof (typeof HALL_WORDS)['en'];

/** A table by board whose words are read in the language of the moment they are read (CITY-79). */
function byBoard(keys: Readonly<Record<HallBoardId, Key>>): Readonly<Record<HallBoardId, string>> {
  const out = {} as Record<HallBoardId, string>;
  for (const id of HALL_BOARDS) Object.defineProperty(out, id, { enumerable: true, get: () => wordsNow(HALL_WORDS)[keys[id]] as string });
  return out;
}

export const BOARD_NAMES = byBoard({ catch: 'nameCatch', hunters: 'nameHunters', creators: 'nameCreators', scouts: 'nameScouts' });

export const BOARD_TABS = byBoard({ catch: 'tabCatch', hunters: 'tabHunters', creators: 'tabCreators', scouts: 'tabScouts' });

/** The boards people see: one without a public source is not shown at all until it has one. */
export function shownBoards(view: Pick<HallView, 'boards'>): HallBoardId[] {
  return HALL_BOARDS.filter((id) => view.boards[id].state !== 'no_source');
}

/** One word for what a billboard's number is. */
export const BOARD_WORDS = byBoard({ catch: 'wordMultiple', hunters: 'wordMultiple', creators: 'wordFee', scouts: 'wordFee' });

/**
 * A board nobody is on even over all time, said short where its one action cannot open here; the reason is behind the
 * panel's «i» (`emptyText`). English; `emptyShort()` is the language on screen.
 */
export const EMPTY_SHORT = HALL_WORDS.en.emptyShort;
export const emptyShort = (): string => wordsNow(HALL_WORDS).emptyShort;

/** An empty board's one action: launch your own coin from the city. */
export const launchYours = (): string => wordsNow(HALL_WORDS).launchYours;

/** The span a board's rows are of, as its sign says it: «This week», «This month», «All time». */
export function spanText(span: HallSpan): string {
  const w = wordsNow(HALL_WORDS);
  return span === 'week' ? w.spanWeek : span === 'month' ? w.spanMonth : w.spanAll;
}

const KINDS = byBoard({ catch: 'kindCatch', hunters: 'kindHunters', creators: 'kindCreators', scouts: 'kindScouts' });

/** What a board's number is, in one line — behind the panel's «i». The creators' all time is the chain's counters, not seven days. */
export function boardKind(board: HallBoardId, span: HallSpan = 'week'): string {
  return board === 'creators' && span === 'all' ? wordsNow(HALL_WORDS).kindCreatorsAll : KINDS[board];
}
/** What each board's number is over its week. */
export const BOARD_KINDS = KINDS;

/** A multiple from tenths: 34 → ×3.4, 1250 → ×125. */
export function multipleText(tenths: number): string {
  const whole = Math.floor(tenths / 10);
  return tenths >= 1000 ? `×${whole}` : `×${whole}.${tenths % 10}`;
}

/** Dollars from micros, rounded down: $4.21, $4,210, $42.1K, $1.24M. */
export function dollarsText(micros: bigint): string {
  const cents = micros / 10_000n;
  const dollars = cents / 100n;
  const group = (n: bigint) => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (dollars < 10n) return `$${dollars}.${(cents % 100n).toString().padStart(2, '0')}`;
  if (dollars < 10_000n) return `$${group(dollars)}`;
  if (dollars < 1_000_000n) return `$${dollars / 1000n}.${(dollars % 1000n) / 100n}K`;
  return `$${dollars / 1_000_000n}.${((dollars % 1_000_000n) / 10_000n).toString().padStart(2, '0')}M`;
}

/** A figure as the billboard says it: the number (in the language's own digits, for the eye), and the word for what it is. */
export function figureText(figure: HallFigure): Readonly<{ value: string; word: string }> {
  const w = wordsNow(HALL_WORDS);
  if (figure.kind === 'multiple') return { value: digits(multipleText(figure.tenths)), word: w.sinceBuy };
  const amount = figure.pair.dollar ? dollarsText(rawToMicros(figure.raw, figure.pair.decimals)) : `${rawToMicros(figure.raw, figure.pair.decimals) / 1_000_000n} ${figure.pair.symbol}`;
  return { value: digits(`${figure.atLeast ? '≥' : ''}${amount}`), word: w.creatorFee };
}

const day = (at: string) => wordsNow(HALL_WORDS).day(at);
const clock = (at: string) => {
  const d = new Date(at);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};

/** A period: «Oct 20 – Oct 27». */
export function periodText(period: HallPeriod): string {
  const from = day(period.from);
  const to = day(period.to);
  return from === to ? from : `${from} – ${to}`;
}

/** When the engine read it: «read 14:05 UTC», with the day when it is not today's. */
export function readText(at: string, now: number): string {
  const w = wordsNow(HALL_WORDS);
  return day(at) === day(new Date(now).toISOString()) ? w.readToday(clock(at)) : w.readOn(day(at), clock(at));
}

/** A share in basis points, rounded down: 333 → 3.3%. */
function share(bps: number): string {
  return digits(`${Math.floor(bps / 100)}.${Math.floor((bps % 100) / 10)}%`);
}

/** A span's trades and what was left out — the line the Hall always carries. */
export function tallyText(tally: HallTally, span: HallSpan = 'week'): string {
  const w = wordsNow(HALL_WORDS);
  if (!tally.trades) return span === 'week' ? w.noTrades : span === 'month' ? w.noTradesMonth : w.noTradesAll;
  const parts = [w.trades(tally.trades)];
  if (tally.insideBps !== null) parts.push(w.inside(share(tally.insideBps)));
  if (tally.uncheckedBps) parts.push(w.unchecked(share(tally.uncheckedBps)));
  return parts.join(' · ');
}

/** Why a board is empty even over all time — behind the panel's «i»: what was read and why nothing stands, never a made-up figure. */
export function emptyText(view: Pick<HallView, 'boards' | 'trades' | 'markets'> & Partial<Pick<HallView, 'tallies'>>, board: HallBoardId): string {
  const w = wordsNow(HALL_WORDS);
  if (view.boards[board].state === 'no_source') return w.noSource;
  if (!view.markets.read) return w.noLaunch;
  if (board === 'creators') {
    const left = Object.values(view.boards.creators.left).reduce((total, n) => total + n, 0);
    return left ? w.creatorWeeksLeft(left) : w.noCreatorFee;
  }
  return (view.tallies?.all ?? view.trades).counted ? w.noCoinUp : w.noTradeCounted;
}
