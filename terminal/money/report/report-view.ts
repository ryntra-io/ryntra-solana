import type { CsvWords, Period, ReportRow, Totals, Unit } from '../../../lib/privacy/report/report.ts';
import type { ReceiptWords } from '../../../lib/privacy/report/receipt.ts';
import type { REPORT_WORDS } from './words.ts';

/**
 * «Report» and «Accountant access» as data: the file's and the receipt's words in the language on screen, the periods'
 * names, the figure the panel leads with. Pure — the tests read it as it is.
 */

type Words = (typeof REPORT_WORDS)['en'];

export function csvWords(w: Words): CsvWords {
  return {
    head: [w.cDate, w.cKind, w.cName, w.cAddress, w.cAmount, w.cCoin, w.cFor, w.cHow, w.cState, w.cTx],
    kind: { payout: w.kSent, fee: w.kFee, invoice: w.kReceived },
    how: { private: w.hPrivate, link: w.hLink, open: w.hOpen },
    state: { paid: w.sPaid, failed: w.sFailed, waiting: w.sWaiting },
  };
}

export function receiptWords(w: Words): ReceiptWords {
  return { title: w.rcTitle, date: w.rcDate, from: w.rcFrom, to: w.rcTo, amount: w.rcAmount, forWhat: w.rcFor, tx: w.rcTx, shows: w.rcShows, hides: w.rcHides };
}

export function unitNames(w: Words): Readonly<Record<Unit, string>> {
  return { month: w.uMonth, quarter: w.uQuarter, year: w.uYear, all: w.pAll };
}

/**
 * A period's name as the person reads it: the month by the screen's own month name (handed in, so this stays pure),
 * «Q4 2026», «2026», «All». The period is taken in local time, as `periodOf` made it.
 */
export function periodName(unit: Unit, period: Period, w: Words, monthName: (at: number) => string): string {
  if (unit === 'all') return w.pAll;
  const d = new Date(period.from);
  if (unit === 'year') return String(d.getFullYear());
  if (unit === 'quarter') return w.quarterName(String(Math.floor(d.getMonth() / 3) + 1), String(d.getFullYear()));
  return monthName(period.from);
}

/** «Payouts» leads with what went out; «Invoices» with what came in. */
export type Focus = 'out' | 'in';

/** The figure the panel leads with: one coin's sum (SOL first), and the other side as one short line, if any. */
export function leadOf(totals: Totals, focus: Focus): Readonly<{ coin: string; sum: string; count: number; other: Readonly<{ coin: string; sum: string }> | null }> {
  const main = focus === 'out' ? totals.out : totals.in;
  const side = focus === 'out' ? totals.in : totals.out;
  const pick = (byCoin: ReadonlyMap<string, string>) => (byCoin.has('SOL') ? 'SOL' : ([...byCoin.keys()][0] ?? 'SOL'));
  const coin = pick(main.byCoin);
  const otherCoin = pick(side.byCoin);
  return { coin, sum: main.byCoin.get(coin) ?? '0', count: main.count, other: side.count ? { coin: otherCoin, sum: side.byCoin.get(otherCoin) ?? '0' } : null };
}

/** What a payment row on screen is called: the name, else the invoice's «for what», else the address shortened. */
export function rowName(row: Pick<ReportRow, 'kind' | 'name' | 'to' | 'note'>, invoiceWord: string): string {
  if (row.name) return row.name;
  if (row.kind === 'invoice') return row.note ?? invoiceWord;
  return row.to.length > 12 ? `${row.to.slice(0, 4)}…${row.to.slice(-4)}` : row.to || '—';
}

/** How many payments of the period the panel lists; the file holds them all. */
export const SHOWN_ROWS = 30;
