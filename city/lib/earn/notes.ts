import { readAction } from './corporate.ts';
import type { ScaledConfig } from './stocks.ts';

/**
 * Earn's notes (CITY-100, spec E9 — `docs/research/ryntra-earn-2026-10-29/SPEC.md`): the four things Earn tells a
 * person, judged the same way in the city (a banner, the computer) and on Ryntra's server (the phone's push and
 * Telegram, through the engine's own inbox and delivery):
 *
 * - **range** — a pool position went out of its range and stopped earning fees;
 * - **weekend** — the stock exchange's weekend stands ahead of a stock the wallet holds or pools: the price on Solana
 *   keeps moving while the exchange is shut and can jump when it opens on Monday;
 * - **dividend** — a dividend date of a held stock is near (the Scaled UI multiplier's change the chain already states),
 *   and the day it was added;
 * - **loan** — a loan's health against half of the live maximum (and a buffer on the exchange's weekend for stock
 *   collateral), the spec's validator rule. Guard's: never off, like the liquidation risk.
 *
 * Pure and dependency-free past the corporate reader: the page, the server's watch and the engine's delivery import it
 * alike. A note is never permission to act — every step stays the person's signature.
 */

export const EARN_NOTE_KINDS = ['range', 'weekend', 'dividend', 'loan'] as const;
export type EarnNoteKind = (typeof EARN_NOTE_KINDS)[number];

export function isEarnNoteKind(value: unknown): value is EarnNoteKind {
  return typeof value === 'string' && (EARN_NOTE_KINDS as readonly string[]).includes(value);
}

export type Locale = 'en' | 'uk';

/** Where every Earn note opens: the city with the Earn window on «Mine». */
export const EARN_HREF = '/?open=earn&tab=mine';

/** The trigger every Earn note carries in the engine's inbox, so the delivery says it in its own words. */
export const EARN_TRIGGER_PREFIX = 'city-earn:';

export function isEarnNote(note: Readonly<{ triggerId: string }>): boolean {
  return typeof note.triggerId === 'string' && note.triggerId.startsWith(EARN_TRIGGER_PREFIX);
}

/** The Telegram message of an Earn note: its line and its reason; the button under it opens Earn. */
export function earnTelegramText(words: Readonly<{ title: string; reason: string }>): string {
  return words.reason ? `Ryntra\n${words.title}\n${words.reason}` : `Ryntra\n${words.title}`;
}

/* ------------------------------------------------------------------------------------------------ the events */

export type EarnEvent =
  | Readonly<{ kind: 'range'; id: string; pair: string }>
  | Readonly<{ kind: 'weekend'; id: string; tickers: readonly string[] }>
  | Readonly<{ kind: 'dividend'; id: string; stage: 'ahead'; ticker: string; inMs: number }>
  | Readonly<{ kind: 'dividend'; id: string; stage: 'added'; ticker: string; units: number | null }>
  | Readonly<{ kind: 'loan'; id: string; grade: 'watch' | 'danger'; coin: string }>;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/* -------------------------------------------------------------------------------------------- out of range */

export type RangeRead = Readonly<{ address: string; pair: string; inRange: boolean }>;

/**
 * Positions out of range now and the ones to tell: out now and not among `known`. A position back in range leaves the
 * set, so its next exit is told again. The city passes what it told on this device; the server what it last read.
 */
export function rangeTells(known: ReadonlySet<string>, reads: readonly RangeRead[]): Readonly<{ out: string[]; tell: EarnEvent[] }> {
  const out: string[] = [];
  const tell: EarnEvent[] = [];
  for (const read of reads) {
    if (read.inRange) continue;
    out.push(read.address);
    if (!known.has(read.address)) tell.push({ kind: 'range', id: `range:${read.address}`, pair: read.pair });
  }
  return { out, tell };
}

/* -------------------------------------------------------------------------------------------- the weekend */

const NY = 'America/New_York';
/** From this hour of New York's Friday the weekend counts as ahead: the last session's afternoon. */
export const WEEKEND_FROM_HOUR = 12;

function nyParts(nowMs: number): Readonly<{ y: number; m: number; d: number; weekday: string; hour: number }> {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: NY, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(nowMs);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { y: Number(get('year')), m: Number(get('month')), d: Number(get('day')), weekday: get('weekday'), hour: Number(get('hour')) % 24 };
}

/**
 * The weekend the stock exchange closes for, named by New York's date of its Friday — from Friday noon in New York
 * until Sunday ends there; null at any other time. One weekend, one note. Holidays are not in it: the exchange's
 * calendar is not data Ryntra reads yet, and a note that is not sure says nothing.
 */
export function weekendKey(nowMs: number): string | null {
  if (!Number.isFinite(nowMs)) return null;
  const p = nyParts(nowMs);
  const back = p.weekday === 'Fri' ? (p.hour >= WEEKEND_FROM_HOUR ? 0 : -1) : p.weekday === 'Sat' ? 1 : p.weekday === 'Sun' ? 2 : -1;
  if (back < 0) return null;
  return new Date(Date.UTC(p.y, p.m - 1, p.d - back)).toISOString().slice(0, 10);
}

/** The weekend note for the stocks a wallet holds or pools, once per weekend; none without a stock. */
export function weekendTell(nowMs: number, tickers: readonly string[]): EarnEvent | null {
  const key = weekendKey(nowMs);
  const list = [...new Set(tickers.filter(Boolean))].sort();
  if (!key || !list.length) return null;
  return { kind: 'weekend', id: `weekend:${key}`, tickers: list };
}

/* ---------------------------------------------------------------------------------------------- dividends */

/** How far ahead a dividend date is told. */
export const DIVIDEND_AHEAD_MS = 7 * DAY;
/** How long after its time a dividend counts as just added. */
export const DIVIDEND_ADDED_MS = 3 * DAY;

export type StockHeld = Readonly<{ mint: string; ticker: string; raw: bigint; decimals: number }>;

const stepOf = (config: ScaledConfig, at: number) => ({ mint: config.mint, at: new Date(at).toISOString(), from: config.multiplier, to: config.newMultiplier });

/**
 * The dividend notes of the stocks held: a change the chain already schedules that reads as a dividend (never a
 * split — `corporate.ts`) and stands within a week — and the day it was added, with what it added to the balance
 * held now. Keyed by the mint and the change's time, so each is told once.
 */
export function dividendTells(configs: readonly ScaledConfig[], held: readonly StockHeld[], nowMs: number): EarnEvent[] {
  const out: EarnEvent[] = [];
  for (const config of configs) {
    const holding = held.find((h) => h.mint === config.mint);
    if (!holding || holding.raw <= 0n) continue;
    const at = config.newMultiplierEffectiveAt === null ? Number.NaN : Date.parse(config.newMultiplierEffectiveAt);
    if (!Number.isFinite(at) || !(config.multiplier > 0) || !(config.newMultiplier > 0) || config.multiplier === config.newMultiplier) continue;
    const action = readAction(stepOf(config, at));
    if (action.kind !== 'dividend') continue;
    const iso = new Date(at).toISOString();
    if (at > nowMs && at - nowMs <= DIVIDEND_AHEAD_MS) {
      out.push({ kind: 'dividend', id: `dividend:${config.mint}:${iso}`, stage: 'ahead', ticker: holding.ticker, inMs: at - nowMs });
    } else if (at <= nowMs && nowMs - at <= DIVIDEND_ADDED_MS) {
      // The balance held now, in its base amount, times the multiplier's rise: what the payout added.
      const base = Number(holding.raw) / 10 ** holding.decimals;
      const units = Number.isFinite(base) ? base * (config.newMultiplier - config.multiplier) : null;
      out.push({ kind: 'dividend', id: `paid:${config.mint}:${iso}`, stage: 'added', ticker: holding.ticker, units: units !== null && units > 0 ? units : null });
    }
  }
  return out;
}

/* -------------------------------------------------------------------------------------------- loan health */

/** The spec's rule: a loan stays at most half of the live maximum… */
export const LOAN_SAFE_SHARE = 0.5;
/** …and on the exchange's weekend, stock collateral keeps a buffer below that. */
export const LOAN_WEEKEND_SHARE = 0.4;
/** Past this share of the live maximum the loan is at risk. */
export const LOAN_DANGER_SHARE = 0.8;

export type LoanRead = Readonly<{
  id: string;
  /** The collateral as people read it: «TSLAx», «SOL». */
  coin: string;
  /** The loan against the collateral now, 0–1. */
  ltv: number;
  /** The live maximum the protocol allows, 0–1. */
  maxLtv: number;
  /** The collateral is a stock: the exchange's weekend tightens the rule. */
  stocks: boolean;
}>;

export type LoanGrade = 'ok' | 'watch' | 'danger';
const RANK: Readonly<Record<LoanGrade, number>> = { ok: 0, watch: 1, danger: 2 };

/** A loan's grade by the spec's rule; null when its figures cannot be read. */
export function loanGrade(loan: LoanRead, weekend: boolean): LoanGrade | null {
  if (!Number.isFinite(loan.ltv) || !Number.isFinite(loan.maxLtv) || loan.ltv < 0 || !(loan.maxLtv > 0) || loan.maxLtv > 1) return null;
  const share = loan.ltv / loan.maxLtv;
  if (share > LOAN_DANGER_SHARE) return 'danger';
  if (share > (weekend && loan.stocks ? LOAN_WEEKEND_SHARE : LOAN_SAFE_SHARE)) return 'watch';
  return 'ok';
}

/**
 * The loans' grades now and the ones to tell: a grade worse than the one known (a loan seen for the first time counts
 * from «ok», so a loan first read at risk is told). A loan that recovers keeps its new grade, and its next fall is
 * told again.
 */
export function loanTells(known: Readonly<Record<string, LoanGrade>>, loans: readonly LoanRead[], weekend: boolean): Readonly<{ grades: Record<string, LoanGrade>; tell: EarnEvent[] }> {
  const grades: Record<string, LoanGrade> = {};
  const tell: EarnEvent[] = [];
  for (const loan of loans) {
    const grade = loanGrade(loan, weekend);
    if (grade === null) {
      if (known[loan.id]) grades[loan.id] = known[loan.id]!;
      continue;
    }
    grades[loan.id] = grade;
    const before = known[loan.id] ?? 'ok';
    if (grade !== 'ok' && RANK[grade] > RANK[before]) tell.push({ kind: 'loan', id: `loan:${loan.id}:${grade}`, grade, coin: loan.coin });
  }
  return { grades, tell };
}

/* -------------------------------------------------------------------------------------------- the words */

type Words = Readonly<{
  range: (pair: string) => string;
  rangeLine: string;
  weekend: string;
  weekendLine: (tickers: string) => string;
  dividend: (ticker: string) => string;
  dividendIn: (ms: number) => string;
  added: (ticker: string) => string;
  addedLine: (units: string, ticker: string) => string;
  loanWatch: (coin: string) => string;
  loanWatchLine: string;
  loanDanger: (coin: string) => string;
  loanDangerLine: string;
  cta: string;
}>;

const ukPlural = (n: number, one: string, few: string, many: string): string => {
  const ten = n % 10;
  const hundred = n % 100;
  if (ten === 1 && hundred !== 11) return one;
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return few;
  return many;
};

const hoursOf = (ms: number) => Math.max(1, Math.round(ms / HOUR));
const daysOf = (ms: number) => Math.max(1, Math.round(ms / DAY));

export const EARN_NOTE_WORDS: Readonly<Record<Locale, Words>> = {
  en: {
    range: (pair) => `Out of range · ${pair}`,
    rangeLine: 'No fees until the price comes back.',
    weekend: 'Stock exchange weekend',
    weekendLine: (tickers) => `${tickers} can jump when it opens on Monday.`,
    dividend: (ticker) => `Dividend date · ${ticker}`,
    dividendIn: (ms) => (ms < DAY - HOUR / 2 ? `In ${hoursOf(ms)} h` : daysOf(ms) === 1 ? 'In a day' : `In ${daysOf(ms)} days`),
    added: (ticker) => `Dividend added · ${ticker}`,
    addedLine: (units, ticker) => `+${units} ${ticker}`,
    loanWatch: (coin) => `Loan near its limit · ${coin}`,
    loanWatchLine: 'Safer to add collateral or repay a part.',
    loanDanger: (coin) => `Loan at risk · ${coin}`,
    loanDangerLine: 'Add collateral or repay now.',
    cta: 'Open Earn',
  },
  uk: {
    range: (pair) => `Поза діапазоном · ${pair}`,
    rangeLine: 'Комісії не йдуть, доки ціна не повернеться.',
    weekend: 'Вихідні на біржі',
    weekendLine: (tickers) => `${tickers} можуть стрибнути на відкритті в понеділок.`,
    dividend: (ticker) => `Дата дивідендів · ${ticker}`,
    dividendIn: (ms) => (ms < DAY - HOUR / 2 ? `Через ${hoursOf(ms)} год` : daysOf(ms) === 1 ? 'Через день' : `Через ${daysOf(ms)} ${ukPlural(daysOf(ms), 'день', 'дні', 'днів')}`),
    added: (ticker) => `Дивіденд нараховано · ${ticker}`,
    addedLine: (units, ticker) => `+${units} ${ticker}`,
    loanWatch: (coin) => `Позика біля межі · ${coin}`,
    loanWatchLine: 'Безпечніше додати заставу або повернути частину.',
    loanDanger: (coin) => `Позика під загрозою · ${coin}`,
    loanDangerLine: 'Додай заставу або поверни зараз.',
    cta: 'Відкрити Заробіток',
  },
};

/** At most three tickers, then «+N». */
export function tickerList(tickers: readonly string[]): string {
  const shown = tickers.slice(0, 3).join(', ');
  return tickers.length > 3 ? `${shown} +${tickers.length - 3}` : shown;
}

/** Token units as people read them: four significant digits, the decimal comma in Ukrainian. */
export function unitsWords(units: number, locale: Locale): string {
  if (!Number.isFinite(units) || units <= 0) return '0';
  const text = units < 0.000001 ? '0.000001' : units >= 1000 ? String(Math.round(units)) : String(Number(units.toPrecision(4)));
  const plain = text.includes('e') ? units.toFixed(6).replace(/0+$/, '').replace(/\.$/, '') : text;
  return locale === 'uk' ? plain.replace('.', ',') : plain;
}

export type EarnNoteText = Readonly<{ title: string; line: string }>;

/** What one event says, in one language. */
export function earnNoteText(event: EarnEvent, locale: Locale): EarnNoteText {
  const w = EARN_NOTE_WORDS[locale];
  switch (event.kind) {
    case 'range':
      return { title: w.range(event.pair), line: w.rangeLine };
    case 'weekend':
      return { title: w.weekend, line: w.weekendLine(tickerList(event.tickers)) };
    case 'dividend':
      return event.stage === 'ahead'
        ? { title: w.dividend(event.ticker), line: w.dividendIn(event.inMs) }
        : { title: w.added(event.ticker), line: event.units === null ? '' : w.addedLine(unitsWords(event.units, locale), event.ticker) };
    case 'loan':
      return event.grade === 'danger' ? { title: w.loanDanger(event.coin), line: w.loanDangerLine } : { title: w.loanWatch(event.coin), line: w.loanWatchLine };
  }
}

/** The subject of a note in a word: the pair, the ticker, the collateral — the engine's inbox keeps it as the context. */
export function earnSubject(event: EarnEvent): string {
  switch (event.kind) {
    case 'range':
      return event.pair;
    case 'weekend':
      return tickerList(event.tickers);
    case 'dividend':
      return event.ticker;
    case 'loan':
      return event.coin;
  }
}
