import type { HallBoardId, HallFigure, HallPeriod, HallTally, HallView } from './hall.ts';
import { HALL_BOARDS, rawToMicros } from './hall.ts';

/**
 * How the Hall says its numbers: short, in English as the city speaks, every figure rounded down so it never reads as
 * more than it is, and every one with the word for what it is.
 */

export const BOARD_NAMES: Readonly<Record<HallBoardId, string>> = {
  catch: 'Biggest × of the week',
  hunters: 'Top hunters',
  creators: 'Top creators',
  scouts: 'Top scouts',
};

export const BOARD_TABS: Readonly<Record<HallBoardId, string>> = { catch: 'Biggest ×', hunters: 'Hunters', creators: 'Creators', scouts: 'Scouts' };

/** The boards people see: one without a public source is not shown at all until it has one. */
export function shownBoards(view: Pick<HallView, 'boards'>): HallBoardId[] {
  return HALL_BOARDS.filter((id) => view.boards[id].state !== 'no_source');
}

/** One word for what a billboard's number is. */
export const BOARD_WORDS: Readonly<Record<HallBoardId, string>> = { catch: 'multiple', hunters: 'multiple', creators: 'fee', scouts: 'fee' };

/** An empty board, said short; the reason is behind the panel's «i» (`emptyText`). */
export const EMPTY_SHORT = 'None this week';

/** What a board's number is, in one line — behind the panel's «i». */
export const BOARD_KINDS: Readonly<Record<HallBoardId, string>> = {
  catch: 'Market cap now ÷ the cap the buy left · not a profit',
  hunters: 'Each hunter’s biggest catch · not a profit',
  creators: 'Creator fee · the engine’s 7 days · before costs',
  scouts: 'Scout fee per trade',
};

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

/** A figure as the billboard says it: the number, and the word for what it is. */
export function figureText(figure: HallFigure): Readonly<{ value: string; word: string }> {
  if (figure.kind === 'multiple') return { value: multipleText(figure.tenths), word: 'since the buy' };
  const amount = figure.pair.dollar ? dollarsText(rawToMicros(figure.raw, figure.pair.decimals)) : `${rawToMicros(figure.raw, figure.pair.decimals) / 1_000_000n} ${figure.pair.symbol}`;
  return { value: `${figure.atLeast ? '≥' : ''}${amount}`, word: 'creator fee' };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (at: string) => {
  const d = new Date(at);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
};
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
  return day(at) === day(new Date(now).toISOString()) ? `read ${clock(at)} UTC` : `read ${day(at)} ${clock(at)} UTC`;
}

/** A share in basis points, rounded down: 333 → 3.3%. */
function share(bps: number): string {
  return `${Math.floor(bps / 100)}.${Math.floor((bps % 100) / 10)}%`;
}

/** The week's trades and what was left out — the line the Hall always carries. */
export function tallyText(tally: HallTally): string {
  if (!tally.trades) return 'No trades on Ryntra launches read this week';
  const parts = [`${tally.trades.toLocaleString('en-US')} trades`];
  if (tally.insideBps !== null) parts.push(`${share(tally.insideBps)} inside one wallet cluster`);
  if (tally.uncheckedBps) parts.push(`${share(tally.uncheckedBps)} not checked yet`);
  return parts.join(' · ');
}

/** Why a board is empty — behind the panel's «i»: what was read and why nothing stands, never a made-up figure. */
export function emptyText(view: Pick<HallView, 'boards' | 'trades' | 'markets'>, board: HallBoardId): string {
  if (view.boards[board].state === 'no_source') return 'No public record of scout fees per trade yet';
  if (!view.markets.read) return 'No Ryntra launch traded this week';
  if (board === 'creators') {
    const left = Object.values(view.boards.creators.left).reduce((total, n) => total + n, 0);
    return left ? `${left} creator week${left === 1 ? '' : 's'} left out — not counted whole` : 'No creator fee counted this week';
  }
  return view.trades.counted ? 'No coin is up since a counted buy' : 'No trade counted this week yet';
}
