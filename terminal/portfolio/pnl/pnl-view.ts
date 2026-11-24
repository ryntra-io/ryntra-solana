import { digits } from '../../../city/lib/i18n/dict.ts';
import type { Lang } from '../../../city/lib/i18n/langs.ts';
import type { PnlCoin, PnlCoverage, PnlDay, PnlDayVerdict, PnlFigures, PnlGap, PnlPeriod, PnlPeriodDays, PortfolioPnl } from '../../../lib/portfolio/pnl.ts';
import { changeText, placedFigure, placesFor, usdText } from '../../ui/figures.ts';

/**
 * «Result» on the Portfolio — its rules without React: the read of `GET /api/portfolio/pnl` (lenient — a
 * field that is not what it should be is not known, never a zero), the figures in SOL as the eye reads them, what one
 * line says when the result is not known, the calendar's cells, and the sale a card is made of.
 */

export const PERIODS: readonly PnlPeriodDays[] = [7, 30, 90];
export const STANDARD = 'ryntra.portfolio-pnl/1';
/** Coins shown before «All coins». */
export const COINS_SHOWN = 6;

const VERDICTS: ReadonlySet<string> = new Set(['PLUS', 'MINUS', 'FLAT', 'UNKNOWN', 'EMPTY']);
const GAPS: ReadonlySet<string> = new Set(['older', 'skipped', 'transfers', 'unpriced', 'unquoted']);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const text = (value: unknown, max = 64): string | null => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);
const verdictOf = (value: unknown): PnlFigures['verdict'] => (typeof value === 'string' && VERDICTS.has(value) ? (value as PnlFigures['verdict']) : 'UNKNOWN');

function figuresOf(value: unknown): PnlFigures {
  const row = isObject(value) ? value : {};
  const result = num(row.result);
  return {
    result,
    realized: num(row.realized),
    unrealized: num(row.unrealized),
    known: num(row.known),
    fees: num(row.fees) ?? 0,
    pct: result === null ? null : num(row.pct),
    completenessPct: num(row.completenessPct),
    /* A result not given is never a plus or a minus, whatever the answer says. */
    verdict: result === null && verdictOf(row.verdict) !== 'EMPTY' ? 'UNKNOWN' : verdictOf(row.verdict),
    covered: row.covered === true,
    trades: num(row.trades) ?? 0,
  };
}

function coinOf(value: unknown): PnlCoin | null {
  if (!isObject(value) || typeof value.mint !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.mint)) return null;
  const result = num(value.result);
  const icon = text(value.icon, 512);
  return {
    mint: value.mint,
    symbol: text(value.symbol, 16),
    name: text(value.name),
    icon: icon && /^https:\/\//.test(icon) ? icon : null,
    held: Math.max(0, num(value.held) ?? 0),
    entry: num(value.entry),
    now: num(value.now),
    value: num(value.value),
    realized: num(value.realized),
    unrealized: num(value.unrealized),
    result,
    pct: result === null ? null : num(value.pct),
    completenessPct: num(value.completenessPct),
    verdict: result === null ? 'UNKNOWN' : verdictOf(value.verdict),
    arrived: value.arrived === true,
    sent: value.sent === true,
  };
}

function dayOf(value: unknown): PnlDay | null {
  if (!isObject(value) || typeof value.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.day)) return null;
  const from = num(value.from);
  if (from === null) return null;
  const result = num(value.result);
  const said = value.verdict === 'UNREAD' ? 'UNREAD' : verdictOf(value.verdict);
  const verdict: PnlDayVerdict = said === 'PLUS' || said === 'MINUS' || said === 'FLAT' ? (result === null ? 'UNKNOWN' : said) : said;
  return { day: value.day, from, result, verdict, trades: num(value.trades) ?? 0 };
}

/** The answer of `GET /api/portfolio/pnl`, read leniently; null when it is not one. */
export function readAnswer(body: unknown): PortfolioPnl | null {
  if (!isObject(body) || body.ok !== true || !isObject(body.pnl)) return null;
  const pnl = body.pnl;
  if (pnl.standard !== STANDARD || pnl.unit !== 'SOL' || !isObject(pnl.periods) || !Array.isArray(pnl.coins) || !Array.isArray(pnl.days)) return null;
  const periods = {} as Record<PnlPeriodDays, PnlPeriod>;
  for (const days of PERIODS) periods[days] = { ...figuresOf(pnl.periods[String(days)]), days };
  const coverage = isObject(pnl.coverage) ? pnl.coverage : {};
  const gaps = Array.isArray(coverage.gaps) ? coverage.gaps.filter((gap): gap is PnlGap => typeof gap === 'string' && GAPS.has(gap)) : [];
  const solUsd = num(pnl.solUsd);
  return {
    standard: STANDARD,
    unit: 'SOL',
    asOf: num(pnl.asOf) ?? 0,
    solUsd: solUsd !== null && solUsd > 0 ? solUsd : null,
    whole: figuresOf(pnl.whole),
    periods,
    coins: pnl.coins.map(coinOf).filter((coin): coin is PnlCoin => coin !== null),
    days: pnl.days.map(dayOf).filter((day): day is PnlDay => day !== null),
    coverage: {
      source: 'chain',
      since: num(coverage.since),
      gaps,
      untraded: Math.max(0, Math.round(num(coverage.untraded) ?? 0)),
      approx: coverage.approx === true,
      feesEstimated: coverage.feesEstimated === true,
    },
  };
}

/* ------------------------------------------------------------- figures */

const MINUS = '−';

/** An amount of SOL as the eye reads it: three places from 1, four below, three figures for a dust of one. */
export function solText(value: number | null, lang: Lang, signed = false): string {
  if (value === null || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  const places = abs >= 100 ? 2 : abs >= 1 ? 3 : abs >= 0.0001 ? 4 : placesFor(abs, 2);
  const rounded = Number(abs.toFixed(places));
  if (rounded === 0) return digits(places ? `0.${'0'.repeat(Math.min(places, 4))}` : '0', lang);
  const body = rounded >= 1000 ? rounded.toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places }) : placedFigure(rounded, places);
  const sign = value < 0 ? MINUS : signed ? '+' : '';
  return digits(`${sign}${body}`, lang);
}

/** A coin's price in SOL: four figures, a run of zeros folded (0.0₅4123). */
export function solPrice(value: number | null, lang: Lang): string {
  if (value === null || !Number.isFinite(value) || value <= 0) return '—';
  return digits(placedFigure(value, placesFor(value, 4)), lang);
}

/** A result's share of the capital it was made on, signed. */
export function pctText(value: number | null, lang: Lang): string {
  return value === null ? '—' : changeText(value, lang);
}

/** The dollars a result in SOL is worth at SOL's price now, signed, for the «≈» beside it. */
export function usdAbout(sol: number | null, solUsd: number | null, lang: Lang): string | null {
  if (sol === null || solUsd === null || !Number.isFinite(sol)) return null;
  const usd = sol * solUsd;
  if (Math.abs(usd) < 0.5) return null;
  /* Whole dollars, grouped — «$1,029», never the short «$1K» of a market's size; a million on, the short form. */
  const abs = Math.abs(usd);
  const body = abs >= 1_000_000 ? usdText(abs, lang) : digits(`$${Math.round(abs).toLocaleString('en-US')}`, lang);
  return `${usd < 0 ? MINUS : '+'}${body}`;
}

/** A result's colour: mint for a plus that shows, flare for a minus that shows, none for a zero or nothing. */
export function toneOf(value: number | null): 'up' | 'down' | undefined {
  if (value === null || !Number.isFinite(value)) return undefined;
  if (Math.abs(value) < 0.00005) return undefined;
  return value > 0 ? 'up' : 'down';
}

/* ------------------------------------------------------------- the line */

/**
 * What the head of the block says under its figure: `known` — the result, nothing more; `empty` — no trade in the
 * period; `older` — the read does not reach back to the period's start; `skipped` — some transactions were never read;
 * `partial` — too little of the turnover is known. With `known` the part that is known, said beside, never as the result.
 */
export type PeriodState =
  | Readonly<{ kind: 'known' }>
  | Readonly<{ kind: 'empty' }>
  | Readonly<{ kind: 'older'; since: number; known: number | null }>
  | Readonly<{ kind: 'skipped' }>
  | Readonly<{ kind: 'partial'; pct: number; known: number | null }>;

export function periodState(period: PnlPeriod, coverage: PnlCoverage): PeriodState {
  if (period.result !== null) return { kind: 'known' };
  if (coverage.gaps.includes('skipped')) return { kind: 'skipped' };
  if (!period.covered && coverage.since !== null) return { kind: 'older', since: coverage.since, known: period.known };
  if (period.verdict === 'EMPTY' || period.trades === 0) return { kind: 'empty' };
  return { kind: 'partial', pct: period.completenessPct ?? 0, known: period.known };
}

/** No trade read at all: the block says so in one line, with the way to a first trade on the person's own wallet. */
export function nothingTraded(pnl: PortfolioPnl): boolean {
  return pnl.coins.length === 0 && PERIODS.every((days) => pnl.periods[days].trades === 0) && !pnl.coverage.gaps.includes('skipped');
}

/* ------------------------------------------------------------- what the block shows */

/**
 * What «Result» takes room for (release check 20.11: with the history of trades read only from 20.11, nearly every
 * Portfolio opened on a big dash, an empty calendar and rows of dashes — a placeholder on the first screen):
 * - `quiet` — no period has a counted result: one quiet line saying why (the period's own state, or nothing traded),
 *   with «i»; no figure, no calendar, no periods, no table;
 * - `full` — the period on screen (the one asked for when it has a result, else the nearest that has), the periods to
 *   switch between (only those with a result; one alone needs no switch), the calendar only when a day of the period
 *   has a result, and the coins whose entry or result is known — never a row of dashes alone.
 */
export type PnlShown =
  | Readonly<{ kind: 'quiet'; state: PeriodState | Readonly<{ kind: 'nothing' }> }>
  | Readonly<{ kind: 'full'; days: PnlPeriodDays; periods: readonly PnlPeriodDays[]; calendar: boolean; coins: readonly PnlCoin[] }>;

export function pnlShown(pnl: PortfolioPnl, wanted: PnlPeriodDays): PnlShown {
  const periods = PERIODS.filter((days) => pnl.periods[days].result !== null);
  if (!periods.length) return { kind: 'quiet', state: nothingTraded(pnl) ? { kind: 'nothing' } : periodState(pnl.periods[wanted], pnl.coverage) };
  const days = periods.includes(wanted) ? wanted : periods.reduce((best, one) => (Math.abs(one - wanted) < Math.abs(best - wanted) ? one : best));
  const calendar = calendarOf(pnl.days, days).cells.some((cell) => cell.result !== null);
  const coins = pnl.coins.filter((coin) => coin.entry !== null || coin.result !== null);
  return { kind: 'full', days, periods, calendar, coins };
}

/* ------------------------------------------------------------- the calendar */

export type CalendarCell = Readonly<{
  day: string;
  from: number;
  verdict: PnlDayVerdict;
  result: number | null;
  /** 1 … 3: how deep the day's colour is, against the period's largest day. 0 — no colour. */
  level: 0 | 1 | 2 | 3;
  /** The week's column and the weekday's row (Monday 0), UTC. */
  col: number;
  row: number;
}>;

/** `strip` — a week or less: the days in one row, oldest first, rather than a grid of weeks. */
export type Calendar = Readonly<{ cells: readonly CalendarCell[]; cols: number; strip: boolean; plus: number; minus: number; unknown: number }>;

const weekday = (from: number) => (new Date(from * 1000).getUTCDay() + 6) % 7;

/** The period's days as a calendar: weeks in columns, Monday on top, the last day today; a week — one row. */
export function calendarOf(days: readonly PnlDay[], count: number): Calendar {
  const shown = days.slice(-count);
  const strip = shown.length <= 7;
  const largest = Math.max(0, ...shown.map((day) => (day.result !== null ? Math.abs(day.result) : 0)));
  const first = shown[0];
  const start = first ? first.from - weekday(first.from) * 86_400 : 0;
  let plus = 0;
  let minus = 0;
  let unknown = 0;
  const cells = shown.map((day, at): CalendarCell => {
    if (day.verdict === 'PLUS') plus += 1;
    if (day.verdict === 'MINUS') minus += 1;
    if (day.verdict === 'UNKNOWN') unknown += 1;
    const share = largest > 0 && day.result !== null ? Math.abs(day.result) / largest : 0;
    const level = day.verdict === 'PLUS' || day.verdict === 'MINUS' ? (share > 2 / 3 ? 3 : share > 1 / 3 ? 2 : 1) : 0;
    const col = strip ? at : Math.floor((day.from - start) / (7 * 86_400));
    return { day: day.day, from: day.from, verdict: day.verdict, result: day.result, level, col, row: strip ? 0 : weekday(day.from) };
  });
  return { cells, cols: cells.length ? cells.at(-1)!.col + 1 : 0, strip, plus, minus, unknown };
}

/* ------------------------------------------------------------- the card */

/** One trade of the wallet's Ryntra record, as `/api/growth/cards` lists it. */
export type CardTrade = Readonly<{ key: string; kind: 'SELL' | 'BUY'; symbol: string; at: string; resultBps: number | null }>;

/** The list of `/api/growth/cards`, read leniently: the trades a card can be made of. */
export function cardTrades(body: unknown): CardTrade[] {
  if (!isObject(body) || !Array.isArray(body.trades)) return [];
  return body.trades.flatMap((row): CardTrade[] => {
    if (!isObject(row) || typeof row.key !== 'string' || (row.kind !== 'SELL' && row.kind !== 'BUY') || typeof row.at !== 'string') return [];
    return [{ key: row.key, kind: row.kind, symbol: text(row.symbol, 16) ?? '', at: row.at, resultBps: num(row.resultBps) }];
  });
}

/**
 * The sale a result card is made of: the best-made sale within the period, by its own measured result. Null when the
 * period has no measured sale — a buy is no result.
 */
export function bestSale(trades: readonly CardTrade[], fromMs: number): CardTrade | null {
  let best: CardTrade | null = null;
  for (const trade of trades) {
    if (trade.kind !== 'SELL' || trade.resultBps === null) continue;
    const at = Date.parse(trade.at);
    if (!Number.isFinite(at) || at < fromMs) continue;
    if (!best || trade.resultBps > best.resultBps!) best = trade;
  }
  return best;
}
